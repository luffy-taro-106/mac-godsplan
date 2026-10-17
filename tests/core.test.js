'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateSettings, validateQuestion, inspectImage, clampBounds, boundedContext, diskHistory, validateHistory } = require('../overlay/core');

test('preferences reject unsafe input and do not mutate defaults', () => {
  assert.throws(() => validateSettings({ provider: 'other' }));
  assert.throws(() => validateSettings({ opacity: NaN }));
  assert.throws(() => validateSettings({ models: { gemini: '../key?x=secret' } }));
  assert.throws(() => validateSettings({ launchAtLogin: 'true' }));
  assert.throws(() => validateSettings({ hideFromCapture: 'true' }));
  assert.throws(() => validateSettings({ protectFromQuit: 'true' }));
  assert.equal(validateSettings({}).protectFromQuit, true, 'Existing profiles gain close protection');
  assert.equal(validateSettings({ protectFromQuit: false }).protectFromQuit, false);
  assert.equal(validateSettings({}).hideFromCapture, true, 'Existing profiles gain capture protection by default');
  assert.equal(validateSettings({ hideFromCapture: false }).hideFromCapture, false);
  const result = validateSettings({ provider: 'gemini', models: { gemini: 'gemini-custom' }, opacity: .7 });
  assert.equal(result.models.gemini, 'gemini-custom'); assert.equal(DEFAULTS.models.gemini, 'gemini-3.8-flash');
  assert.equal(validateSettings({provider:'openai'}).models.openai,'gpt-6.1-sol');
  assert.equal(validateSettings({}, {...DEFAULTS,models:{anthropic:'my-existing-model',gemini:'gemini-custom'}}).models.openai,'gpt-6.1-sol');
});
test('image-only questions receive a clear default prompt; empty and oversized inputs fail', () => {
  assert.throws(() => validateQuestion({ text: '  ' }));
  assert.throws(() => validateQuestion({ text: 'x'.repeat(12001) }));
  assert.throws(() => validateQuestion({ text: 'hi', imageId: 'file:///secret' }));
  assert.match(validateQuestion({ imageId: '12345678-1234-1234-1234-123456789012' }).text, /Read the question/);
});
test('geometry recovers detached monitors and clamps to small/negative-position displays', () => {
  assert.deepEqual(clampBounds({ x: 9000, y: 9000, width: 500, height: 800 }, { x: 0, y: 0, width: 1920, height: 1040 }), { x: 1420, y: 240, width: 500, height: 800 });
  assert.deepEqual(clampBounds({ x: 0, y: -999, width: 800, height: 1000 }, { x: -800, y: -100, width: 700, height: 500 }), { x: -800, y: -100, width: 700, height: 500 });
  assert.equal(clampBounds(null, { x: 0, y: 0, width: 1920, height: 1080 }, true).height, 122);
});
function pngHeader(width, height) { const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write('IHDR',12); bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20); return bytes; }
test('image validation checks actual format and dimensions before decoding', () => {
  assert.deepEqual(inspectImage(pngHeader(800, 600)), { width: 800, height: 600, mime: 'image/png' });
  assert.throws(() => inspectImage(pngHeader(16000,16000)));
  assert.throws(() => inspectImage(pngHeader(0,600)));
  assert.throws(() => inspectImage(Buffer.from('<svg width="200">test</svg>')));
  assert.throws(() => inspectImage(Buffer.alloc(11 * 1024 * 1024)));
  const jpeg = Buffer.alloc(32); jpeg.set([255,216,255,192,0,17,8,2,88,3,32],0);
  assert.deepEqual(inspectImage(jpeg), { width: 800, height: 600, mime: 'image/jpeg' });
});
test('follow-ups include bounded complete pairs and recent images', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(2000), imageId: i % 2 ? null : `image${i}` }));
  const context = boundedContext(history, { text: 'follow up', imageId: 'current' }, id => ({ id }));
  assert.equal(context.length, 17); assert.equal(context.filter(message => message.image).length, 3);
  assert.equal(context.at(-1).image.id, 'current'); assert.equal(context[0].role, 'user');
});
test('disk history contains no image pixels or API keys and rejects malformed pairs', () => {
  const history = [{ id: '1', role: 'user', text: 'hello', imageId: 'secret', data: 'pixel' }, { id: '2', role: 'assistant', text: 'hi', apiKey: 'private' }];
  const disk = JSON.stringify(diskHistory(history)); assert.ok(!disk.includes('secret') && !disk.includes('private') && !disk.includes('pixel'));
  assert.equal(validateHistory(history).length,2); assert.throws(() => validateHistory([history[1]]));
});
test('restored or evicted image context explicitly tells the model pixels are unavailable', () => {
  const messages = [{role:'user',text:'Answer the image',imageName:'question.png'}, {role:'assistant',text:'42'}];
  const context = boundedContext(messages,{text:'Explain the diagram'},()=>null);
  assert.match(context[0].text,/pixels are not available/);
  assert.equal(context[0].image,null);
});
