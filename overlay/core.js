'use strict';

const MAX_TEXT = 12000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const { PROVIDERS } = require('./models');
const DEFAULTS = Object.freeze({
  provider: 'anthropic',
  models: { anthropic: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash', openai: 'gpt-6.1-sol' },
  opacity: 0.98, launchAtLogin: false, rememberHistory: true, hideFromCapture: true, protectFromQuit: true,
  bounds: null, compact: false
});

function validateSettings(input, current = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings.');
  const next = { ...DEFAULTS, ...current, models: { ...DEFAULTS.models, ...current.models } };
  if ('provider' in input) {
    if (!PROVIDERS.includes(input.provider)) throw new Error('Choose Claude, Gemini, or OpenAI / ChatGPT.');
    next.provider = input.provider;
  }
  for (const provider of PROVIDERS) {
    if (input.models && provider in input.models) {
      const model = input.models[provider];
      if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,99}$/.test(model)) throw new Error('Enter a valid model ID.');
      next.models[provider] = model;
    }
  }
  if ('opacity' in input) {
    if (!Number.isFinite(input.opacity) || input.opacity < 0.65 || input.opacity > 1) throw new Error('Opacity must be between 65% and 100%.');
    next.opacity = input.opacity;
  }
  for (const key of ['launchAtLogin', 'rememberHistory', 'compact', 'hideFromCapture', 'protectFromQuit']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error('Invalid preference.');
      next[key] = input[key];
    }
  }
  return next;
}

function validateQuestion(input) {
  if (!input || typeof input !== 'object') throw new Error('Enter a question.');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > MAX_TEXT) throw new Error('Question is too long (12,000 characters maximum).');
  const imageId = input.imageId || null;
  if (imageId && (typeof imageId !== 'string' || !/^[0-9a-f-]{36}$/.test(imageId))) throw new Error('Invalid attachment.');
  if (!text && !imageId) throw new Error('Type a question or attach an image.');
  return { text: text || 'Read the question in this image and answer it. If any part is unclear, say so.', imageId };
}

// Inspect dimensions before invoking a native decoder, including JPEG SOF markers.
function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Choose a PNG or JPEG up to 10 MB.');
  let width, height, mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = 'image/png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); mime = 'image/jpeg'; break;
      }
      offset += length;
    }
  }
  if (!mime || !width || !height || width > 16000 || height > 16000 || width * height > 32_000_000) {
    throw new Error('Image is invalid or too large. Use PNG/JPEG with at most 32 megapixels.');
  }
  return { width, height, mime };
}

function clampBounds(saved, workArea, compact = false) {
  const width = Math.round(Math.min(workArea.width, Math.max(360, Number(saved?.width) || 460)));
  const height = Math.round(Math.min(workArea.height, compact ? 122 : Math.max(440, Number(saved?.height) || 700)));
  const proposedX = Number.isFinite(saved?.x) ? saved.x : workArea.x + workArea.width - width - 28;
  const proposedY = Number.isFinite(saved?.y) ? saved.y : workArea.y + 40;
  return {
    x: Math.round(Math.max(workArea.x, Math.min(proposedX, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(proposedY, workArea.y + workArea.height - height))),
    width, height
  };
}

function boundedContext(history, current, imageLookup) {
  const pairs = [];
  let chars = current.text.length;
  let images = current.imageId ? 1 : 0;
  for (let i = history.length - 2; i >= 0 && pairs.length < 8; i -= 2) {
    const user = history[i], answer = history[i + 1];
    if (user?.role !== 'user' || answer?.role !== 'assistant') continue;
    if (chars + user.text.length + answer.text.length > 48000) break;
    chars += user.text.length + answer.text.length;
    const image = images < 3 && user.imageId ? imageLookup(user.imageId) : null;
    if (image) images++;
    const text = user.imageName && !image ? `${user.text}\n[An image named "${user.imageName}" was attached earlier. Its pixels are not available in this request.]` : user.text;
    pairs.unshift([{ role: 'user', text, image }, { role: 'assistant', text: answer.text }]);
  }
  return [...pairs.flat(), { role: 'user', text: current.text, image: current.imageId ? imageLookup(current.imageId) : null }];
}

function diskHistory(history) {
  return history.slice(-40).map(({ id, role, text, imageName, model, provider, createdAt }) => ({ id, role, text, imageName, model, provider, createdAt }));
}

function validateHistory(value) {
  if (!Array.isArray(value)) throw new Error('Invalid conversation data.');
  const clean = value.slice(-40);
  if (clean.length % 2 || clean.some((message, i) => !message || message.role !== (i % 2 ? 'assistant' : 'user') ||
    typeof message.text !== 'string' || message.text.length > 80000 || typeof message.id !== 'string')) throw new Error('Invalid conversation data.');
  return diskHistory(clean);
}

module.exports = { DEFAULTS, MAX_TEXT, MAX_IMAGE_BYTES, validateSettings, validateQuestion, inspectImage, clampBounds, boundedContext, diskHistory, validateHistory };
