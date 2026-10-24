'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'darwin') process.exit(0);

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'overlay/native/macos-panel.mm');
const output = path.join(root, 'overlay/native/bin');
const args = process.argv.slice(2);
const archs = args.includes('--all') ? ['arm64', 'x64'] : args.length ? args : [process.arch];
if (archs.some(arch => !['arm64', 'x64'].includes(arch))) throw new Error('Usage: node scripts/build-panel.js [arm64|x64|--all]');
const candidates = [process.env.OPENCLUELY_NODE_HEADERS, path.resolve(path.dirname(process.execPath), '../include/node'), '/opt/homebrew/include/node', '/usr/local/include/node'];
const cache = path.join(os.homedir(), 'Library/Caches/node-gyp');
if (fs.existsSync(cache)) for (const version of fs.readdirSync(cache).sort().reverse()) candidates.push(path.join(cache, version, 'include/node'));
const headers = candidates.find(folder => folder && fs.existsSync(path.join(folder, 'node_api.h')));
if (!headers) throw new Error('Node-API headers are missing. Install Node.js development headers or set OPENCLUELY_NODE_HEADERS to their include/node directory.');
fs.mkdirSync(output, { recursive: true });
for (const arch of archs) {
  const binary = path.join(output, `macos-panel-${arch}.node`);
  const temporary = `${binary}.${process.pid}.tmp`;
  const built = spawnSync('xcrun', ['clang++', '-std=c++17', '-bundle', '-undefined', 'dynamic_lookup', '-fobjc-arc',
    '-mmacosx-version-min=13.0', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-DNAPI_VERSION=8', '-I', headers,
    source, '-framework', 'AppKit', '-o', temporary], { stdio: 'inherit', timeout: 120000 });
  if (built.error || built.status !== 0) { fs.rmSync(temporary, { force: true }); throw new Error('Mac panel helper compilation failed.'); }
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', temporary], { stdio: 'inherit', timeout: 30000 });
  if (signed.error || signed.status !== 0) { fs.rmSync(temporary, { force: true }); throw new Error('Mac panel helper signing failed.'); }
  fs.renameSync(temporary, binary);
  console.log(`Built native nonactivating panel support (${arch}, Node-API).`);
}
