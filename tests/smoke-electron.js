'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, nativeImage, desktopCapturer, screen, safeStorage, systemPreferences, dialog, clipboard, ClipboardItem, globalShortcut } = require('electron');
const { Store } = require('../overlay/storage');
const { setTimeout: delay } = require('node:timers/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

async function until(predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (!(await predicate())) { if (Date.now() - started > timeoutMs) throw new Error('Desktop test timed out'); await delay(25); }
}
exports.run = async runtime => {
  const results = [], consoleErrors = [];
  const skip = (name, reason) => { results.push({ name, skipped: true, reason }); console.log(`SKIP ${name}: ${reason}`); };
  const test = async (name, action) => {
    try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  };
  const work = path.resolve(__dirname, '..', '.test-output');
  fs.mkdirSync(work, { recursive: true });
  const win = runtime.getWindow();
  win.webContents.on('console-message', details => { if (details.level === 'error') consoleErrors.push(details.message); });
  const js = code => Promise.race([win.webContents.executeJavaScript(code), delay(2000).then(() => { throw new Error('Renderer evaluation timed out'); })]);
  const watchdog = setTimeout(() => { console.error('Desktop suite timed out'); runtime.app.exit(1); }, 60000);
  const key = 'test-only-not-a-real-api-key';
  runtime.setKeyValidator(async () => true);
  try {
    await until(async () => await js('!!window.overlay && !!document.getElementById("provider") && document.getElementById("provider").value === "anthropic"'));
    await delay(120);
    await test('sandboxed renderer loads the interface and safe Markdown libraries', async () => {
      assert.deepEqual(await js('[typeof require, typeof window.overlay.ask, typeof marked.parse, typeof DOMPurify.sanitize]'), ['undefined','function','function','function']);
      assert.equal(win.webContents.session.isPersistent(),false, 'Renderer drafts and caches must stay in memory');
      const result = await js('window.overlay.state()'); assert.equal(result.ok,true); assert.equal(result.value.keyStatus.anthropic,false);
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
      assert.equal(await js('document.getElementById("welcome").hidden'),false);
      // Chromium can refuse renderer snapshots for a capture-protected window.
      win.setContentProtection(false); runtime.showOverlay(false); win.setContentProtection(false);
      try {
        await delay(200);
        const capture = await win.webContents.capturePage();
        fs.writeFileSync(path.join(work,'Overlay-preview.png'), capture.toPNG());
      } finally { win.setContentProtection(true); runtime.hideOverlay(); }
    });
    await test('native topmost, close-to-tray, click-through and compact restoration', async () => {
      assert.equal(win.isAlwaysOnTop(),true);
      const other = new BrowserWindow({show:false,width:500,height:400});
      other.destroy(); assert.equal(win.isDestroyed(),false);
      runtime.showOverlay(false); assert.equal(win.isVisible(),true);
      win.close(); assert.equal(win.isDestroyed(),false); assert.equal(win.isVisible(),false);
      runtime.showOverlay(true);
      await until(() => win.isFocused());
      runtime.togglePassThrough(); assert.equal(runtime.currentState().passThrough,true); assert.equal(win.isFocusable(),false);
      if (process.platform === 'darwin') assert.equal(win.isFocused(), false, 'Click-through must release keyboard focus on macOS');
      runtime.togglePassThrough(); assert.equal(win.isFocusable(),true);
      const height = win.getBounds().height;
      runtime.toggleCompact(); assert.ok(Math.abs(win.getBounds().height - 122) <= 2, 'Native border may add two pixels');
      runtime.toggleCompact(); assert.equal(win.getBounds().height,height);
      runtime.hideOverlay();
    });
    if (process.platform === 'win32') await test('capture protection excludes a visible overlay from native screen capture', async () => {
      assert.equal(win.isContentProtected(), true); assert.equal(runtime.currentState().captureProtectionActive, true);
      const display = screen.getPrimaryDisplay(), previous = win.getBounds();
      const bounds = { x: display.workArea.x + 50, y: display.workArea.y + 50, width: 460, height: Math.min(600,display.workArea.height-80) };
      const backdrop = new BrowserWindow({ ...bounds, frame:false, show:false, backgroundColor:'#20eb40', webPreferences:{sandbox:true} });
      try {
        await backdrop.loadURL('data:text/html,<body style="margin:0;background:%2320eb40;height:100vh"></body>');
        // Keep the fixture above unrelated desktop apps and the overlay above it.
        backdrop.setAlwaysOnTop(true, 'screen-saver');
        win.setBounds(bounds); backdrop.showInactive(); runtime.showOverlay(false); win.moveTop();
        const isGreen = async () => {
          const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor) } });
          const shot = sources.find(source => source.display_id === String(display.id)).thumbnail;
          const size = shot.getSize(), actual = win.getBounds();
          const pixel = shot.crop({ x:Math.round((actual.x+80-display.bounds.x)*size.width/display.bounds.width), y:Math.round((actual.y+220-display.bounds.y)*size.height/display.bounds.height), width:1,height:1 }).toBitmap();
          return pixel[1] > 170 && pixel[0] < 110 && pixel[2] < 110;
        };
        await runtime.saveSettings({hideFromCapture:false}); assert.equal(win.isContentProtected(), false);
        await delay(300); await until(async () => !(await isGreen()));
        await runtime.saveSettings({hideFromCapture:true}); assert.equal(win.isContentProtected(), true);
        await delay(300); await until(isGreen);
        assert.equal(runtime.store.read('preferences.json',{}).hideFromCapture,true);
        runtime.togglePassThrough(); assert.equal(win.isContentProtected(), true); runtime.togglePassThrough();
        await js('document.getElementById("settingsButton").click()');
        assert.equal(await js('document.getElementById("hideFromCapture").checked'), true);
        await until(isGreen); await js('document.getElementById("closeSettings").click()');
      } finally { backdrop.destroy(); win.setBounds(previous); runtime.hideOverlay(); }
    });
    if (process.platform === 'darwin') await test('Mac workspaces, shortcut labels, capture limitation and permission recovery', async () => {
      assert.equal(win.isVisibleOnAllWorkspaces(), true);
      assert.equal(win.isContentProtected(), true);
      assert.equal(runtime.currentState().platform.trayName, 'menu bar');
      assert.ok(runtime.currentState().shortcuts.every(item => item.display.startsWith('⌘+⌥+')));
      await js('document.getElementById("settingsButton").click()');
      assert.equal(await js('document.getElementById("screenPermission").hidden'), false);
      assert.match(await js('document.getElementById("captureNote").textContent'), /ScreenCaptureKit can still record/);
      await js('document.getElementById("closeSettings").click()');
      try {
        for (const permission of ['denied', 'restricted']) {
          runtime.setScreenPermissionFunction(() => permission);
          await assert.rejects(runtime.capture(), /System Settings/);
          assert.equal(runtime.currentState().captureBusy, false);
        }
      } finally { runtime.setScreenPermissionFunction(() => systemPreferences.getMediaAccessStatus('screen')); }
    });
    await test('native encryption protects saved keys and IPC state omits secrets', async () => {
      assert.equal(runtime.store.available(),true);
      await runtime.saveSettings({provider:'anthropic',apiKey:key});
      const disk = fs.readFileSync(path.join(runtime.app.getPath('userData'),'credentials.enc'));
      assert.equal(disk.includes(Buffer.from(key)),false);
      assert.equal(runtime.store.read('credentials.enc',{},true).anthropic,key);
      assert.equal(JSON.stringify(runtime.currentState()).includes(key),false);
      await assert.rejects(runtime.ask({text:''}),/Type a question/);
    });
    await test('verified key replacement persists, preserves the other provider, and failed saves retain the old key', async () => {
      await runtime.saveSettings({provider:'gemini',apiKey:'first-gemini-test-key'});
      runtime.setKeyValidator(async (provider, candidate) => {
        assert.equal(provider,'gemini'); assert.equal(candidate,'rejected-gemini-test-key');
        throw new Error('The new API key was rejected.');
      });
      const before = fs.readFileSync(path.join(runtime.store.directory,'credentials.enc'));
      await assert.rejects(runtime.saveSettings({provider:'gemini',apiKey:'rejected-gemini-test-key',opacity:0.7}),/rejected/);
      assert.deepEqual(fs.readFileSync(path.join(runtime.store.directory,'credentials.enc')),before);
      assert.equal(runtime.currentState().settings.opacity,0.98);
      await runtime.saveSettings({apiKey:'  '});
      assert.equal(runtime.store.read('credentials.enc',{},true).gemini,'first-gemini-test-key');
      runtime.setKeyValidator(async () => { await delay(60); return true; });
      await js('document.getElementById("settingsButton").click();document.getElementById("apiKey").value="replacement-gemini-test-key";document.getElementById("settingsForm").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))');
      await until(async()=>await js('document.getElementById("saveButton").disabled'));
      await assert.rejects(runtime.saveSettings({provider:'anthropic'}),/already being saved/);
      await until(async()=>await js('!document.getElementById("settingsDialog").open'));
      const reopened = new Store(runtime.store.directory,safeStorage);
      assert.deepEqual(reopened.read('credentials.enc',{},true),{anthropic:key,gemini:'replacement-gemini-test-key'});
      assert.equal(await js('document.getElementById("apiKey").value'),'');
      assert.ok(!JSON.stringify(runtime.currentState()).includes('replacement-gemini-test-key'));
      const originalWrite = runtime.store.write.bind(runtime.store);
      runtime.store.write = (name,...args) => { if (name === 'preferences.json') throw new Error('Simulated disk failure'); return originalWrite(name,...args); };
      try { await assert.rejects(runtime.saveSettings({apiKey:'another-verified-test-key'}),/disk failure/); }
      finally { runtime.store.write = originalWrite; }
      assert.equal(reopened.read('credentials.enc',{},true).gemini,'replacement-gemini-test-key');
      assert.equal(reopened.read('credentials.enc',{},true).anthropic,key);
      await runtime.saveSettings({provider:'anthropic'});
    });
    const imageBytes = fs.readFileSync(path.resolve(__dirname,'..','overlay','assets','icon.png'));
    let received;
    runtime.setAnswerFunction(async options => {
      received = options;
      await delay(30); options.onDelta('The answer is **42**.\n\n');
      await delay(40); options.onDelta('```python\nprint(42)\n```\n\n<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>');
      return { text:'The answer is **42**.\n\n```python\nprint(42)\n```\n\n<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>', truncated:false };
    });
    await test('image paste, preview and question submission work through the real UI and IPC', async () => {
      await js(`(() => { const bytes=Uint8Array.from(atob(${JSON.stringify(imageBytes.toString('base64'))}), char=>char.charCodeAt(0)); const data=new DataTransfer(); data.items.add(new File([bytes], 'question.png', {type:'image/png'})); document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); })()`);
      await until(async()=>await js('!document.getElementById("attachment").hidden'));
      await js('document.getElementById("question").value="Read and answer the question in this image";document.getElementById("question").dispatchEvent(new Event("input"));document.getElementById("questionForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
      await until(()=>runtime.getHistory().length===2 && !runtime.currentState().busy);
      assert.equal(received.messages.at(-1).image.mime,'image/jpeg'); assert.ok(received.messages.at(-1).image.data.length>100);
      assert.equal(await js('document.getElementById("attachment").hidden'),true);
      await until(async()=>await js('document.querySelectorAll(".message").length===2'));
      assert.equal(await js('!!document.querySelector(".message-body strong")'),true);
      assert.equal(await js('!!document.querySelector(".message-body pre code")'),true);
      assert.equal(await js('!!window.pwned || !!document.querySelector(".message-body img") || !!document.querySelector(".message-body script")'),false);
      assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
      await js('document.querySelector(".copy-code").click()');
    });
    await test('successful history is encrypted and follow-ups keep image context in memory', async () => {
      const disk=fs.readFileSync(path.join(runtime.app.getPath('userData'),'conversation.enc'));
      assert.equal(disk.includes(Buffer.from('answer is')),false);
      const decoded=runtime.store.read('conversation.enc',[],true); assert.equal(decoded.length,2); assert.ok(!JSON.stringify(decoded).includes('base64'));
      await runtime.ask({text:'Explain why'}); await until(()=>runtime.getHistory().length===4 && !runtime.currentState().busy);
      assert.equal(received.messages.length,3); assert.ok(received.messages[0].image);
    });
    await test('duplicate requests are blocked and cancellation does not commit incomplete turns', async () => {
      runtime.setAnswerFunction(async ({signal,onDelta})=>{onDelta('Partial answer');await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));});
      await runtime.ask({text:'long request'});
      await assert.rejects(runtime.ask({text:'duplicate'}),/already running/);
      await assert.rejects(runtime.saveSettings({provider:'gemini'}),/Stop the current/);
      runtime.cancel(); await until(()=>!runtime.currentState().busy);
      assert.equal(runtime.getHistory().length,4); assert.match(runtime.currentState().lastAttempt.error,/stopped/i);
    });
    await test('normal Quit attempts and cancelled explicit Quit preserve the running answer', async () => {
      assert.equal(runtime.currentState().settings.protectFromQuit, true);
      runtime.showOverlay(false);
      const visible = win.isVisible(), processId = process.pid;
      let confirmations = 0;
      runtime.setQuitConfirmationFunction(async () => { confirmations++; return false; });
      await runtime.ask({ text: 'Keep this unfinished answer running during a normal Quit request' });
      runtime.app.quit();
      await delay(120);
      assert.equal(runtime.currentState().busy, true, 'Blocked Quit must not cancel a running answer');
      assert.equal(win.isVisible(), visible, 'Blocked Quit must not hide, show or refocus the window');
      assert.equal(await js('window.overlay.quit().then(result => result.value)'), false);
      assert.equal(confirmations, 1);
      assert.equal(runtime.currentState().busy, true);
      assert.equal(process.pid, processId);
      assert.equal(runtime.getHistory().length, 4);
      assert.equal(await js('window.overlay.state().then(result => result.ok)'), true);
      runtime.cancel(); await until(() => !runtime.currentState().busy);
      runtime.hideOverlay();
    });
    await test('automatic reopening can be paused during an answer and rearmed by an explicit app open', async () => {
      const fake = {
        available: true, enabled: true, busy: false,
        status() { return { available: this.available, enabled: this.enabled, busy: false, error: '' }; },
        async enable() { this.enabled = true; }, async disable() { this.enabled = false; }
      };
      const original = runtime.setRecoveryController(fake);
      try {
        await runtime.ask({ text: 'Keep answering while reopening is paused' });
        await js('document.getElementById("settingsButton").click()');
        assert.equal(await js('typeof window.overlay.setRecoveryEnabled'), 'function');
        assert.equal(await js('document.getElementById("recoveryEnabled").checked'), true);
        assert.equal(await js('document.getElementById("recoveryEnabled").disabled'), false);
        await js('document.getElementById("recoveryEnabled").click()');
        await until(() => !fake.enabled);
        await until(async () => await js('document.getElementById("recoveryStatus").textContent.includes("paused")'));
        assert.equal(runtime.currentState().busy, true, 'Pausing recovery must not stop an active answer');
        assert.equal(runtime.store.read('preferences.json', {}).recoveryEnabled, undefined, 'Recovery is a session control');
        await js('document.getElementById("closeSettings").click()');
        runtime.app.emit('activate');
        await until(() => fake.enabled);
        const bad = await js('window.overlay.setRecoveryEnabled("yes")');
        assert.equal(bad.ok, false);
      } finally {
        runtime.cancel(); await until(() => !runtime.currentState().busy);
        runtime.setRecoveryController(original); runtime.hideOverlay();
      }
      assert.equal(runtime.currentState().recovery.available, false, 'Development must not register a production service');
    });
    if (process.platform === 'darwin') {
      const helper = path.join(work, 'normal-quit-request');
      if (fs.existsSync(helper)) await test('a separate native Mac process cannot close the protected app with normal terminate()', async () => {
        runtime.hideOverlay();
        const { stdout } = await runFile(helper, [String(process.pid)], { timeout: 5000 });
        assert.match(stdout, /Normal native quit request sent/);
        await delay(250);
        assert.equal(win.isDestroyed(), false);
        assert.equal(win.isVisible(), false, 'An external quit must not bring the hidden app to the foreground');
        assert.equal(await js('window.overlay.state().then(result => result.ok)'), true);
        assert.equal(runtime.getHistory().length, 4);
      });
      else skip('a separate native Mac process cannot close the protected app with normal terminate()', 'Native fixture needs Xcode Command Line Tools');
    }
    await test('close protection is visible in Settings and persists when toggled', async () => {
      await js('document.getElementById("settingsButton").click()');
      assert.equal(await js('document.getElementById("protectFromQuit").checked'), true);
      await js('document.getElementById("closeSettings").click()');
      await runtime.saveSettings({ protectFromQuit: false });
      assert.equal(runtime.store.read('preferences.json', {}).protectFromQuit, false);
      await runtime.saveSettings({ protectFromQuit: true });
      assert.equal(runtime.store.read('preferences.json', {}).protectFromQuit, true);
    });
    await test('main frame IPC rejects a different window', async () => {
      const stranger = new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'..','overlay','preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await stranger.loadFile(path.resolve(__dirname,'..','overlay','ui','index.html'));
      const result=await stranger.webContents.executeJavaScript('window.overlay.state()'); assert.equal(result.ok,false); assert.match(result.error,/Unauthorized/);
      stranger.destroy();
    });
    await test('renderer crash recovers without losing completed conversation', async () => {
      win.webContents.forcefullyCrashRenderer();
      await until(async()=>{try{return await js('document.querySelectorAll(".message").length>=4');}catch{return false;}},12000);
      assert.equal(runtime.getHistory().length,4); assert.equal(win.isAlwaysOnTop(),true); assert.equal(win.isContentProtected(),true);
      assert.equal(await js('document.getElementById("provider").value'),'anthropic');
    });
    if (runtime.currentState().screenPermission === 'granted') await test('native display capture returns a bounded JPEG preview', async () => {
      const displays=runtime.currentState().displays;
      const image=await runtime.capture(displays.find(display=>display.primary).id);
      assert.ok(image.width<=2560 && image.height<=2560); assert.ok(image.preview.startsWith('data:image/'));
      assert.equal(nativeImage.createFromDataURL(image.preview).isEmpty(),false);
    });
    else skip('native display capture returns a bounded JPEG preview', 'Screen Recording permission has not been granted to this test app');
    await test('all providers have model dropdowns, per-provider defaults, and a working custom model option', async () => {
      const initial = runtime.currentState().settings;
      for (const provider of ['openai','gemini','anthropic']) {
        await runtime.saveSettings({ provider });
        await until(async () => await js('document.getElementById("provider").value') === provider);
        const options = await js('[...document.getElementById("quickModel").options].map(option=>option.value)');
        assert.ok(options.length >= 4);
        for (const model of runtime.currentState().modelCatalog[provider]) assert.ok(options.includes(model.id));
        await js(`document.getElementById("quickModel").value=${JSON.stringify(options[1])};document.getElementById("quickModel").dispatchEvent(new Event("change"))`);
        await until(() => runtime.currentState().settings.models[provider] === options[1]);
        await runtime.saveSettings({ models: { [provider]: initial.models[provider] } });
      }
      await js('document.getElementById("settingsButton").click();document.getElementById("modelPreset").value="__custom__";document.getElementById("modelPreset").dispatchEvent(new Event("change"));document.getElementById("model").value="claude-custom-test";document.getElementById("settingsForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
      await until(() => runtime.currentState().settings.models.anthropic === 'claude-custom-test');
      await until(async () => await js('!document.getElementById("settingsDialog").open'));
      assert.equal(await js('document.getElementById("quickModel").value'),'claude-custom-test');
      await runtime.saveSettings({ provider:'anthropic', models: initial.models });
      assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
    });
    await test('OpenAI key is encrypted and text plus image follow-ups route to the selected provider', async () => {
      runtime.setKeyValidator(async () => true);
      await runtime.saveSettings({provider:'openai',apiKey:'test-openai-not-a-real-api-key'});
      assert.equal(runtime.currentState().keyStatus.openai,true);
      assert.equal(JSON.stringify(runtime.currentState()).includes('test-openai-not-a-real-api-key'),false);
      assert.equal(fs.readFileSync(path.join(runtime.app.getPath('userData'),'credentials.enc')).includes(Buffer.from('test-openai')),false);
      runtime.setAnswerFunction(async options => {
        assert.equal(options.provider,'openai'); assert.equal(options.model,'gpt-6.1-sol');
        assert.ok(options.messages.at(-1).image); options.onDelta('OpenAI test answer');
        return {text:'OpenAI test answer',truncated:false};
      });
      const image=runtime.importImage({name:'openai-vision.png',data:imageBytes.toString('base64')});
      await runtime.ask({text:'OpenAI image test',imageId:image.id});
      await until(()=>!runtime.currentState().busy);
      await until(async()=>await js('document.querySelector(".message:last-child .message-header").textContent.includes("CHATGPT")'));
      assert.equal(runtime.getHistory().at(-1).provider,'openai');
      await runtime.saveSettings({provider:'anthropic'});
    });
    await test('file upload, drag and drop, copy, export and rejected files use the real renderer bridge', async () => {
      const imageFile=path.join(work,'upload-fixture.png'); fs.writeFileSync(imageFile,imageBytes);
      const originalOpen=dialog.showOpenDialog, originalSave=dialog.showSaveDialog;
      try {
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[imageFile]});
        await js('document.getElementById("uploadButton").click()');
        await until(async()=>await js('document.getElementById("imageName").textContent === "upload-fixture.png"'));
        await js('document.getElementById("removeImage").click()');
        assert.equal(await js('document.getElementById("attachment").hidden'),true);
        await js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(imageBytes.toString('base64'))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'drop.png',{type:'image/png'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
        await until(async()=>await js('document.getElementById("imageName").textContent === "drop.png"'));
        await js('document.getElementById("removeImage").click()');
        const invalid=await js('window.overlay.importImage({name:"bad.png",data:btoa("not an image")})');
        assert.equal(invalid.ok,false);
        await js('document.querySelector(".message:last-child .message-actions button").click()');
        await until(async()=>await clipboard.readText()==='OpenAI test answer');
        await clipboard.write([new ClipboardItem({'image/png':new Blob([imageBytes],{type:'image/png'})})]);
        assert.ok((await js('window.overlay.pasteImage()')).value.preview.startsWith('data:image/'));
        const exportFile=path.join(work,'export-fixture.md');
        dialog.showSaveDialog=async()=>({canceled:false,filePath:exportFile});
        const exported=await js('window.overlay.export()'); assert.equal(exported.value,true);
        assert.match(fs.readFileSync(exportFile,'utf8'),/OpenAI test answer/);
        dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
        assert.equal((await js('window.overlay.upload()')).value,null);
      } finally {dialog.showOpenDialog=originalOpen;dialog.showSaveDialog=originalSave;}
    });
    await test('New chat archives encrypted history, resets draft and context, and restores previous chats', async () => {
      const original=runtime.getHistory().map(message=>message.text);
      await js('document.getElementById("question").value="unsent draft";document.getElementById("question").dispatchEvent(new Event("input"));document.getElementById("newChatButton").click()');
      await until(()=>runtime.getHistory().length===0);
      await until(async()=>await js('document.getElementById("question").value === ""'));
      assert.equal(runtime.currentState().archivedChats.length,1);
      assert.equal(runtime.currentState().lastAttempt,null); assert.equal(runtime.images.size,0);
      assert.equal(fs.readFileSync(path.join(runtime.app.getPath('userData'),'chats.enc')).includes(Buffer.from('OpenAI test answer')),false);
      const id=runtime.currentState().archivedChats[0].id;
      runtime.setAnswerFunction(async options=>{assert.equal(options.messages.length,1,'New chat must not send old context');options.onDelta('Fresh answer');return{text:'Fresh answer',truncated:false};});
      await runtime.ask({text:'Fresh question'});await until(()=>!runtime.currentState().busy);
      await js('document.getElementById("settingsButton").click()');
      await js(`document.getElementById("chatSelect").value=${JSON.stringify(id)};document.getElementById("chatSelect").dispatchEvent(new Event("change"));document.getElementById("openChatButton").click()`);
      await until(()=>runtime.getHistory().length===original.length);
      assert.deepEqual(runtime.getHistory().map(message=>message.text),original);
      const saved=runtime.store.read('chats.enc',null,true);assert.deepEqual(saved.current.map(message=>message.text),original);
      assert.equal(saved.archive[0].history[0].text,'Fresh question');
      const savedState=JSON.stringify(runtime.currentState());
      const write=runtime.store.write.bind(runtime.store);runtime.store.write=()=>{throw new Error('simulated archive disk failure');};
      try {assert.throws(()=>runtime.changeConversation(),/disk failure/);}
      finally{runtime.store.write=write;}
      assert.equal(JSON.stringify(runtime.currentState()),savedState,'A failed New chat must preserve the conversation');
      await js('document.getElementById("settingsButton").click()');
      const archived=runtime.currentState().archivedChats[0].id;
      await js(`document.getElementById("chatSelect").value=${JSON.stringify(archived)};document.getElementById("chatSelect").dispatchEvent(new Event("change"));document.getElementById("deleteChatButton").click();document.getElementById("cancelDeleteChat").click()`);
      assert.equal(runtime.currentState().archivedChats.length,1);
      await js('document.getElementById("deleteChatButton").click();document.getElementById("confirmDeleteChat").click()');
      await until(()=>runtime.currentState().archivedChats.length===0);
      await js('document.getElementById("closeSettings").click()');
    });
    await test('New chat rejects active answers; retry, cancel, clear and history opt-out behave consistently', async () => {
      let calls=0;
      runtime.setAnswerFunction(async({onDelta})=>{calls++;if(calls===1)throw new Error('Temporary test failure');onDelta('Retried answer');return{text:'Retried answer',truncated:false};});
      await runtime.ask({text:'Retry me'});await until(()=>!runtime.currentState().busy);
      await until(async()=>await js('!!document.querySelector(".retry-button")'));
      await js('document.querySelector(".retry-button").click()');await until(()=>!runtime.currentState().busy&&calls===2);
      runtime.setAnswerFunction(async({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
      await runtime.ask({text:'Hold answer'});
      assert.throws(()=>runtime.changeConversation(),/Stop the current answer/);
      assert.equal(await js('document.getElementById("newChatButton").disabled'),true);
      await js('document.getElementById("stopButton").click()');await until(()=>!runtime.currentState().busy);
      await runtime.saveSettings({opacity:0.67});assert.ok(Math.abs(win.getOpacity()-0.67)<0.01);
      await runtime.saveSettings({opacity:0.98,rememberHistory:false});
      assert.equal(fs.existsSync(path.join(runtime.app.getPath('userData'),'chats.enc')),false);
      assert.equal(fs.existsSync(path.join(runtime.app.getPath('userData'),'conversation.enc')),false);
      await runtime.saveSettings({rememberHistory:true});
      await js('document.getElementById("settingsButton").click();document.getElementById("clearButton").click();document.getElementById("cancelClear").click()');
      assert.ok(runtime.getHistory().length>0);
      await js('document.getElementById("clearButton").click();document.getElementById("confirmClear").click()');
      await until(()=>runtime.getHistory().length===0);
      assert.equal(runtime.store.read('chats.enc',null,true).current.length,0);
      assert.ok(runtime.currentState().shortcuts.every(shortcut=>globalShortcut.isRegistered(shortcut.accelerator)));
    });
    await test('deleting a key takes effect and image cache is bounded', async () => {
      runtime.setAnswerFunction(async({onDelta})=>{onDelta('Persisted test answer');return{text:'Persisted test answer',truncated:false};});
      await runtime.ask({text:'Archived chat after restart'});await until(()=>!runtime.currentState().busy);
      runtime.changeConversation();
      await runtime.ask({text:'Current chat after restart'});await until(()=>!runtime.currentState().busy);
      for(let i=0;i<13;i++) runtime.importImage({name:`image${i}.png`,data:imageBytes.toString('base64')});
      assert.ok(runtime.images.size<=10);
      await runtime.saveSettings({provider:'anthropic',removeKey:true}); assert.equal(runtime.currentState().keyStatus.anthropic,false);
      await assert.rejects(runtime.ask({text:'hello'}),/API key/);
    });
    console.log(`Desktop tests passed: ${results.filter(result => result.passed).length}; skipped: ${results.filter(result => result.skipped).length}`);
  } catch (error) { if (!results.some(result=>!result.passed)) results.push({name:'desktop suite setup or completion',passed:false,error:error.message}); console.error(error.stack); }
  finally {
    clearTimeout(watchdog);
    fs.writeFileSync(path.join(work,'desktop-test-results.json'),JSON.stringify({results,consoleErrors,profile:runtime.app.getPath('userData')},null,2));
    runtime.app.exit(results.some(result=>!result.passed && !result.skipped)?1:0);
  }
};
