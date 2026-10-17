'use strict';
const $ = id => document.getElementById(id);
const api = window.overlay;
let state, attachment = null, sending = false, importing = false, streamTimer, toastTimer, streamView, renderedSignature = '', autoScroll = true, dragDepth = 0;
const models = {};
let deletingChatId = null;
const question = $('question');
const messageContainer = $('messages');
const content = $('content');
let selectedDisplay = sessionStorage.getItem('display') || '';
let recoveryRequested = null, recoveryActionError = '';

async function call(method, ...args) {
  const result = await api[method](...args);
  if (!result?.ok) throw new Error(result?.error || 'This action could not be completed.');
  return result.value;
}
function notify(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function guard(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { notify(error.message); } }; }
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#${name}`); svg.append(use); return svg; }
function scrollToLatest(force = false) { if (autoScroll || force) { content.scrollTop = content.scrollHeight; $('jumpButton').hidden = true; } else $('jumpButton').hidden = false; }
function richText(element, text) {
  element.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }), {
    FORBID_TAGS: ['img', 'svg', 'style', 'input', 'button', 'form', 'iframe', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name', 'target'], ALLOW_DATA_ATTR: false
  });
  element.querySelectorAll('pre').forEach(pre => {
    const copy = document.createElement('button'); copy.className = 'copy-code'; copy.type = 'button'; copy.textContent = 'Copy';
    copy.addEventListener('click', guard(async () => { await call('copy', pre.querySelector('code')?.textContent || pre.textContent); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1300); }));
    pre.prepend(copy);
  });
  element.querySelectorAll('a').forEach(link => link.addEventListener('click', guard(async event => {
    event.preventDefault(); const url = link.getAttribute('href');
    if (url && /^https?:\/\//i.test(url)) { await call('copy', url); notify('Link copied. Paste it into your browser to open it.'); }
  })));
}
function createMessage(role, text, metadata = {}) {
  const card = document.createElement('article'); card.className = `message ${role}`;
  const header = document.createElement('div'); header.className = 'message-header';
  if (role === 'assistant') header.append(icon('spark'));
  const label = document.createElement('span'); label.textContent = role === 'user' ? 'YOU' : metadata.provider === 'openai' ? 'CHATGPT' : metadata.provider === 'gemini' ? 'GEMINI' : 'CLAUDE'; header.append(label);
  if (role === 'assistant' && metadata.model) { const model = document.createElement('span'); model.className = 'model-label'; model.textContent = metadata.model; header.append(model); }
  card.append(header);
  if (metadata.imageName || metadata.image?.name) {
    const reference = document.createElement('div'); reference.className = 'image-reference'; reference.append(icon('image'), document.createTextNode(metadata.imageName || metadata.image.name)); card.append(reference);
  }
  const body = document.createElement('div'); body.className = 'message-body';
  if (role === 'user') body.textContent = text;
  else if (text) richText(body, text);
  card.append(body); messageContainer.append(card);
  if (role === 'assistant' && text && !metadata.streaming) addCopy(card, text);
  return { card, body, text, id: metadata.id };
}
function addCopy(card, text) {
  if (card.querySelector('.message-actions')) return;
  const actions = document.createElement('div'); actions.className = 'message-actions';
  const copy = document.createElement('button'); copy.type = 'button'; copy.append(icon('copy'), document.createTextNode('Copy answer'));
  copy.addEventListener('click', guard(async () => { await call('copy', text); notify('Answer copied.'); }));
  actions.append(copy); card.append(actions);
}
function showFailure(view, attempt) {
  if (attempt.text) richText(view.body, attempt.text); else view.body.textContent = '';
  const error = document.createElement('div'); error.className = 'message-error'; error.textContent = attempt.error; view.card.append(error);
  const retry = document.createElement('button'); retry.className = 'retry-button'; retry.type = 'button'; retry.textContent = 'Retry question';
  retry.addEventListener('click', guard(() => submit(attempt.question))); view.card.append(retry);
  if (attempt.text) addCopy(view.card, attempt.text);
}
function renderTimeline() {
  if (!state) return;
  const signature = state.history.map(message => message.id).join('|') + `/${state.active?.id || ''}/${state.lastAttempt?.id || ''}`;
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  clearTimeout(streamTimer); messageContainer.replaceChildren(); streamView = null;
  for (const message of state.history) createMessage(message.role, message.text, message);
  if (state.active) {
    createMessage('user', state.active.question.text, { image: state.active.image });
    streamView = createMessage('assistant', state.active.text, { ...state.active, streaming: true });
    if (!state.active.text) streamView.body.innerHTML = '<div class="streaming-indicator"><span></span><span></span><span></span></div>';
  } else if (state.lastAttempt) {
    createMessage('user', state.lastAttempt.question.text, { image: state.lastAttempt.image });
    const view = createMessage('assistant', '', state.lastAttempt); showFailure(view, state.lastAttempt);
  }
  $('welcome').hidden = !!(state.history.length || state.active || state.lastAttempt);
  scrollToLatest();
}
function updateControls() {
  const busy = sending || !!state?.busy;
  $('sendButton').disabled = busy || importing || !(question.value.trim() || attachment);
  $('provider').disabled = busy;
  $('quickModel').disabled = busy;
  $('newChatButton').disabled = busy || importing || !!state?.captureBusy;
  $('newChatButton').title = busy ? 'Stop the answer before starting a new chat' : 'Save this conversation and start a new one';
  $('openChatButton').disabled = busy || !$('chatSelect').value;
  $('deleteChatButton').disabled = !$('chatSelect').value;
  $('captureButton').disabled = !!state?.captureBusy || importing;
  $('uploadButton').disabled = importing;
  $('requestStatus').hidden = !busy;
  $('footerStatus').textContent = busy ? 'Answering your question' : state?.passThrough ? 'Click-through enabled' : `Runs in your ${state?.platform.trayName || 'tray'}`;
}
function renderRecovery() {
  const recovery = state?.recovery;
  $('recoveryControl').hidden = !state?.platform.mac;
  $('recoveryEnabled').checked = !!recovery?.enabled;
  $('recoveryEnabled').disabled = !recovery?.available || !!recovery.busy || recoveryRequested !== null;
  $('recoveryStatus').textContent = recoveryRequested !== null
    ? recoveryRequested ? 'Starting automatic reopening…' : 'Pausing automatic reopening…'
    : recovery?.busy ? 'Updating automatic reopening…'
      : !recovery?.available ? 'Available in the installed macOS app.'
        : recovery.enabled ? 'Automatic reopening is on.' : 'Automatic reopening is paused until the next launch.';
  const error = recoveryActionError || recovery?.error || '';
  $('recoveryError').textContent = error;
  $('recoveryError').hidden = !error;
}
function applyState(value) {
  state = value;
  recoveryActionError = '';
  for (const shortcut of state.shortcuts) {
    document.querySelectorAll('[data-shortcut]').forEach(element => { if (element.dataset.shortcut === shortcut.label) element.textContent = shortcut.display; });
  }
  const shortcut = label => state.shortcuts.find(item => item.label === label)?.display || '';
  $('hideButton').title = `Hide to ${state.platform.trayName} · ${shortcut('Show / hide')}`;
  $('hideButton').setAttribute('aria-label', `Hide to ${state.platform.trayName}`);
  $('captureButton').title = `Capture selected display · ${shortcut('Screenshot')}`;
  $('passButton').title = `Click-through · ${shortcut('Click-through')}`;
  $('captureNote').textContent = state.platform.captureNote;
  $('hideFromCapture').nextElementSibling.textContent = state.platform.mac ? 'Request capture protection (best effort)' : 'Hide overlay from screen sharing and recordings';
  $('screenPermission').hidden = !state.platform.mac;
  $('screenPermissionText').textContent = state.screenPermission === 'granted'
    ? 'Screen Recording permission is enabled. Screenshots are previewed before sending.'
    : 'To take screenshots, allow OpenCluely in Privacy & Security → Screen & System Audio Recording, then quit and reopen the app. Uploading and pasting images work without this permission.';
  Object.assign(models, state.settings.models);
  document.body.classList.toggle('compact', state.settings.compact);
  document.body.classList.toggle('pass-through', state.passThrough);
  $('passBanner').hidden = !state.passThrough;
  $('passButton').setAttribute('aria-pressed', String(state.passThrough));
  $('provider').value = state.settings.provider;
  fillModelOptions($('quickModel'), state.settings.provider, models[state.settings.provider]);
  const selectedChat = $('chatSelect').value;
  $('chatSelect').replaceChildren(new Option('Choose a previous chat…', ''));
  for (const chat of state.archivedChats || []) $('chatSelect').append(new Option(chat.title, chat.id));
  if ((state.archivedChats || []).some(chat => chat.id === selectedChat)) $('chatSelect').value = selectedChat;
  $('setupNote').hidden = state.keyStatus[state.settings.provider];
  $('settingsWarnings').textContent = state.warnings.join('\n'); $('settingsWarnings').hidden = !state.warnings.length;
  renderTimeline(); updateControls(); renderRecovery();
}
function setAttachment(image) {
  if (attachment && attachment.id !== image?.id) void call('releaseImage', attachment.id).catch(() => {});
  attachment = image;
  $('attachment').hidden = !image;
  if (image) { $('imagePreview').src = image.preview; $('imageName').textContent = image.name; $('imageSize').textContent = `${image.width} × ${image.height} · ready to send`; }
  else { $('imagePreview').removeAttribute('src'); }
  updateControls();
}
async function loadAttachment(action) {
  if (importing) return;
  importing = true; updateControls();
  try { const image = await action(); if (image) { setAttachment(image); question.focus(); } }
  finally { importing = false; updateControls(); }
}
async function submit(input = { text: question.value, imageId: attachment?.id }) {
  if (sending || state?.busy) return;
  if (!state?.keyStatus[state.settings.provider]) { openSettings(); notify('Add your API key to start answering questions.'); return; }
  if (!input.text?.trim() && !input.imageId) return;
  sending = true; updateControls(); autoScroll = true;
  try {
    await call('ask', input);
    question.value = ''; sessionStorage.removeItem('draft'); resizeQuestion(); setAttachment(null);
  } finally { sending = false; updateControls(); }
}
function resizeQuestion() { question.style.height = 'auto'; question.style.height = `${Math.min(140, Math.max(40, question.scrollHeight))}px`; }
function populateKeyFields() {
  const provider = $('settingsProvider').value;
  fillModelOptions($('modelPreset'), provider, models[provider], true);
  $('model').value = models[provider]; $('apiKey').value = '';
  updateCustomModel();
  $('openaiNote').hidden = provider !== 'openai';
  $('apiKey').placeholder = state?.keyStatus[provider] ? 'Leave blank to keep your saved key' : 'Paste your API key';
  $('keyBadge').textContent = state?.keyStatus[provider] ? 'Key saved' : 'No key yet';
  $('removeKey').hidden = !state?.keyStatus[provider];
}
function fillModelOptions(select, provider, current, settingsMenu = false) {
  const options = (state?.modelCatalog?.[provider] || []).map(model => new Option(model.name, model.id));
  const known = options.some(option => option.value === current);
  if (current && !known && !settingsMenu) options.unshift(new Option(`${current} · custom`, current));
  if (settingsMenu) options.push(new Option('Custom model ID…', '__custom__'));
  select.replaceChildren(...options);
  select.value = settingsMenu && !known ? '__custom__' : current;
}
function updateCustomModel() {
  const custom = $('modelPreset').value === '__custom__';
  $('customModelLabel').hidden = !custom;
  $('model').required = custom;
  if (!custom) $('model').value = $('modelPreset').value;
}
function resetComposer() {
  question.value = ''; sessionStorage.removeItem('draft'); setAttachment(null); resizeQuestion();
  autoScroll = true; $('settingsDialog').close(); question.focus();
}
function openSettings() {
  if (!state) return;
  if (state.settings.compact) { void call('compact').then(() => openSettings()).catch(error => notify(error.message)); return; }
  $('settingsProvider').value = state.settings.provider; populateKeyFields();
  $('opacity').value = Math.round(state.settings.opacity * 100); $('opacityValue').textContent = `${$('opacity').value}%`;
  $('launchAtLogin').checked = state.settings.launchAtLogin; $('rememberHistory').checked = state.settings.rememberHistory;
  $('protectFromQuit').checked = state.settings.protectFromQuit;
  $('hideFromCapture').checked = state.settings.hideFromCapture;
  $('launchAtLogin').disabled = !state.startupAvailable;
  $('launchAtLogin').parentElement.title = state.startupAvailable ? '' : state.platform.startupHint;
  $('launchAtLogin').nextElementSibling.textContent = `Start in ${state.platform.trayName} when I sign in`;
  $('displaySelect').replaceChildren(new Option('Display under the pointer', ''));
  for (const display of state.displays) $('displaySelect').append(new Option(`${display.name}${display.primary ? ' (primary)' : ''}`, display.id));
  if (selectedDisplay && !state.displays.some(display => display.id === selectedDisplay)) selectedDisplay = '';
  $('displaySelect').value = selectedDisplay;
  $('settingsError').hidden = true;
  if (state.startupStatus === 'requires-approval') { $('settingsError').textContent = 'Approve OpenCluely in System Settings → General → Login Items to finish enabling startup.'; $('settingsError').hidden = false; }
  if (!$('settingsDialog').open) $('settingsDialog').showModal();
}

api.onEvent(event => {
  if (event.type === 'state') applyState(event.value);
  else if (event.type === 'start') {
    state.busy = true; state.active = { ...event, text: '' }; state.lastAttempt = null;
    $('statusText').textContent = event.image ? 'Reading the image and your question…' : 'Thinking through your question…';
    renderTimeline(); updateControls();
  } else if (event.type === 'delta' && streamView?.id === event.id) {
    streamView.text += event.text;
    if (state.active?.id === event.id) state.active.text = streamView.text;
    if (!streamTimer) streamTimer = setTimeout(() => { streamTimer = null; if (streamView) { richText(streamView.body, streamView.text); scrollToLatest(); } }, 90);
    $('statusText').textContent = 'Answer is arriving…';
  } else if (event.type === 'done' && streamView?.id === event.id) {
    clearTimeout(streamTimer); streamTimer = null; richText(streamView.body, event.text); addCopy(streamView.card, event.text);
    if (event.truncated) notify('The answer reached the model output limit. Ask it to continue.');
    scrollToLatest();
  } else if (event.type === 'error' && streamView?.id === event.id) {
    clearTimeout(streamTimer); streamTimer = null; showFailure(streamView, event); scrollToLatest();
  } else if (event.type === 'status') $('statusText').textContent = event.text;
  else if (event.type === 'attach') { setAttachment(event.image); if (state?.settings.compact) void call('compact').catch(error => notify(error.message)); }
  else if (event.type === 'notice') notify(event.text);
  else if (event.type === 'open-settings') openSettings();
  else if (event.type === 'focus-input') { if (!state?.settings.compact) question.focus(); }
});

$('questionForm').addEventListener('submit', guard(async event => { event.preventDefault(); await submit(); }));
question.addEventListener('input', () => { sessionStorage.setItem('draft', question.value); resizeQuestion(); updateControls(); });
question.addEventListener('keydown', guard(async event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); await submit(); } }));
$('uploadButton').addEventListener('click', guard(() => loadAttachment(() => call('upload'))));
$('welcomeUpload').addEventListener('click', guard(() => loadAttachment(() => call('upload'))));
$('captureButton').addEventListener('click', guard(() => loadAttachment(() => call('capture', selectedDisplay || undefined))));
$('removeImage').addEventListener('click', () => setAttachment(null));
$('hideButton').addEventListener('click', guard(() => call('hide')));
$('compactButton').addEventListener('click', guard(() => call('compact')));
$('passButton').addEventListener('click', guard(() => call('passThrough')));
$('stopButton').addEventListener('click', guard(async () => { await call('cancel'); $('statusText').textContent = 'Stopping…'; }));
$('provider').addEventListener('change', guard(async () => { try { applyState(await call('saveSettings', { provider: $('provider').value })); } finally { $('provider').value = state.settings.provider; } }));
$('quickModel').addEventListener('change', guard(async () => {
  try { applyState(await call('saveSettings', { models: { [state.settings.provider]: $('quickModel').value } })); }
  finally { fillModelOptions($('quickModel'), state.settings.provider, models[state.settings.provider]); }
}));
$('newChatButton').addEventListener('click', guard(async () => { applyState(await call('newChat')); resetComposer(); notify('New chat started. Previous conversation is in Settings → Previous chats.'); }));
$('chatSelect').addEventListener('change', updateControls);
$('openChatButton').addEventListener('click', guard(async () => { applyState(await call('openChat', $('chatSelect').value)); resetComposer(); }));
$('deleteChatButton').addEventListener('click', () => {
  deletingChatId = $('chatSelect').value;
  $('deleteChatTitle').textContent = (state.archivedChats || []).find(chat => chat.id === deletingChatId)?.title || '';
  $('deleteChatDialog').showModal();
});
$('cancelDeleteChat').addEventListener('click', () => { deletingChatId = null; $('deleteChatDialog').close(); });
$('confirmDeleteChat').addEventListener('click', guard(async () => { applyState(await call('deleteChat', deletingChatId)); deletingChatId = null; $('deleteChatDialog').close(); notify('Saved chat deleted.'); }));
$('settingsButton').addEventListener('click', openSettings); $('setupButton').addEventListener('click', openSettings);
$('screenSettingsButton').addEventListener('click', guard(() => call('openScreenSettings')));
$('closeSettings').addEventListener('click', () => { $('apiKey').value = ''; $('settingsDialog').close(); });
$('settingsDialog').addEventListener('close', () => { $('apiKey').value = ''; });
$('settingsProvider').addEventListener('change', populateKeyFields);
$('modelPreset').addEventListener('change', updateCustomModel);
$('opacity').addEventListener('input', () => { $('opacityValue').textContent = `${$('opacity').value}%`; });
$('recoveryEnabled').addEventListener('change', async () => {
  if (recoveryRequested !== null || !state?.recovery?.available || state.recovery.busy) { renderRecovery(); return; }
  recoveryRequested = $('recoveryEnabled').checked;
  recoveryActionError = '';
  renderRecovery();
  try { applyState(await call('setRecoveryEnabled', recoveryRequested)); }
  catch (error) {
    try { applyState(await call('state')); } catch { /* Keep the last known recovery state if the refresh fails. */ }
    recoveryActionError = error.message;
  } finally { recoveryRequested = null; renderRecovery(); }
});
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('saveButton').disabled) return;
  $('settingsError').hidden = true;
  const controls = [...$('settingsForm').querySelectorAll('input, select, button')].map(control => [control, control.disabled]);
  try {
    const provider = $('settingsProvider').value;
    const input = { provider, models: { [provider]: $('model').value.trim() }, opacity: Number($('opacity').value) / 100, launchAtLogin: $('launchAtLogin').checked, rememberHistory: $('rememberHistory').checked, hideFromCapture: $('hideFromCapture').checked, protectFromQuit: $('protectFromQuit').checked };
    if ($('apiKey').value.trim()) input.apiKey = $('apiKey').value.trim();
    controls.forEach(([control]) => { control.disabled = true; });
    $('saveButton').textContent = input.apiKey ? 'Verifying and saving key…' : 'Saving…';
    applyState(await call('saveSettings', input));
    selectedDisplay = $('displaySelect').value; sessionStorage.setItem('display', selectedDisplay);
    $('apiKey').value = ''; $('settingsDialog').close(); notify(input.apiKey ? 'Key verified and saved on this device.' : 'Settings saved.');
  } catch (error) { $('settingsError').textContent = error.message; $('settingsError').hidden = false; }
  finally { controls.forEach(([control, disabled]) => { control.disabled = disabled; }); $('saveButton').textContent = 'Save settings'; }
});
$('removeKey').addEventListener('click', guard(async () => { applyState(await call('saveSettings', { provider: $('settingsProvider').value, removeKey: true })); populateKeyFields(); notify('Saved key removed.'); }));
$('exportButton').addEventListener('click', guard(async () => { if (await call('export')) notify('Conversation exported.'); }));
$('clearButton').addEventListener('click', () => { $('clearDialog').showModal(); });
$('cancelClear').addEventListener('click', () => $('clearDialog').close());
$('confirmClear').addEventListener('click', guard(async () => { await call('clear'); setAttachment(null); $('clearDialog').close(); $('settingsDialog').close(); notify('Conversation cleared.'); }));
$('quitButton').addEventListener('click', guard(() => call('quit')));
content.addEventListener('scroll', () => { autoScroll = content.scrollHeight - content.scrollTop - content.clientHeight < 65; $('jumpButton').hidden = autoScroll || !(state?.history.length || state?.active); });
$('jumpButton').addEventListener('click', () => { autoScroll = true; scrollToLatest(true); });

async function attachFile(file) {
  if (!file || !['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG or JPEG up to 10 MB.');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(file); });
  return call('importImage', { name: file.name || 'Pasted image', data });
}
document.addEventListener('paste', guard(async event => {
  if ($('settingsDialog').open) return;
  const image = [...event.clipboardData.items].find(item => item.type.startsWith('image/'));
  if (image) { event.preventDefault(); await loadAttachment(() => attachFile(image.getAsFile())); }
}));
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); dragDepth++; $('dropZone').hidden = false; } });
document.addEventListener('dragover', event => { event.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropZone').hidden = true; });
document.addEventListener('drop', guard(async event => { event.preventDefault(); dragDepth = 0; $('dropZone').hidden = true; await loadAttachment(() => attachFile(event.dataTransfer.files[0])); }));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('settingsDialog').open && !$('clearDialog').open) void call('hide').catch(error => notify(error.message)); });
window.addEventListener('error', () => notify('A display error occurred. Reopen the overlay from the tray.'));
window.addEventListener('unhandledrejection', () => notify('An action could not finish. Please try again.'));
question.value = sessionStorage.getItem('draft') || ''; resizeQuestion();
void call('state').then(applyState).catch(error => notify(error.message));
