'use strict';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const root = path.join(__dirname, '..');
const smoke = process.argv.includes('--smoke-test');
if (smoke && process.platform === 'darwin') {
  const helper = path.join(root, '.test-output', 'normal-quit-request');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.rmSync(helper, { force: true });
  const compiled = spawnSync('xcrun', ['swiftc', path.join(root, 'tests', 'request-quit.swift'), '-o', helper], { env, stdio: 'inherit', timeout: 30000 });
  if (compiled.status !== 0) console.warn('Native quit helper unavailable; its desktop check will be skipped (Xcode Command Line Tools required).');
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
}
void (async () => {
  let code = await run([root, ...process.argv.slice(2)]);
  if (code === 0 && smoke) code = await run([path.join(root, 'tests', 'reopen-electron.cjs')]);
  if (code === 0 && smoke) code = await run([root, '--quit-smoke-test']);
  process.exitCode = code;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
