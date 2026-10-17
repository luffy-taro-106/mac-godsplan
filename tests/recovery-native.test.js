'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const helper = path.join(root, 'overlay', 'native', 'bin', `recovery-helper-${process.arch}`);
const mac = process.platform === 'darwin';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function atomicState(file, state) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
async function until(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await delay(25);
  }
  throw new Error('Timed out waiting for disposable recovery fixture.');
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function readEvents(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}
function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
}
function killFixture(pid) {
  if (!pid) return;
  try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

test('native helper reports process events and validates process identity', { skip: !mac }, () => {
  const compiled = spawnSync(process.execPath, ['scripts/build-recovery.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const probe = spawnSync(helper, ['--probe'], { encoding: 'utf8' });
  assert.equal(probe.status, 0);
  assert.deepEqual(JSON.parse(probe.stdout), { version: 1, platform: 'darwin', processEvents: true });
  const identity = spawnSync(helper, ['--process-identity', String(process.pid)], { encoding: 'utf8' });
  assert.equal(identity.status, 0);
  assert.equal(JSON.parse(identity.stdout).pid, process.pid);
});

test('native helper restarts an isolated app and exits when recovery is disabled', { skip: !mac, timeout: 45000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-recovery-native-'));
  fs.chmodSync(temp, 0o700);
  const bundle = path.join(temp, 'Recovery Fixture.app');
  const macOS = path.join(bundle, 'Contents', 'MacOS');
  const resources = path.join(bundle, 'Contents', 'Resources');
  fs.mkdirSync(macOS, { recursive: true });
  fs.mkdirSync(resources);
  const executable = path.join(macOS, 'RecoveryFixture');
  const statePath = path.join(temp, 'state.json');
  const eventPath = path.join(temp, 'events.jsonl');
  const sessionId = randomUUID();
  fs.writeFileSync(path.join(resources, 'fixture-config.json'), JSON.stringify({ statePath, eventPath, sessionId }));
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.opencluely.test.${sessionId}</string>
<key>CFBundleExecutable</key><string>RecoveryFixture</string><key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/></dict></plist>`);
  const compiled = spawnSync('xcrun', ['swiftc', path.join(__dirname, 'recovery-fixture.swift'), '-o', executable], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  let supervisor;
  const fixturePids = new Set();
  t.after(async () => {
    const state = readJSON(statePath);
    if (state) atomicState(statePath, { ...state, enabled: false });
    if (supervisor && supervisor.exitCode === null && supervisor.signalCode === null) {
      await Promise.race([childExit(supervisor), delay(2000)]);
      if (supervisor.exitCode === null && supervisor.signalCode === null) {
        supervisor.kill('SIGKILL');
        await childExit(supervisor);
      }
    }
    if (state?.pid) fixturePids.add(state.pid);
    const latest = readJSON(statePath);
    if (latest?.pid) fixturePids.add(latest.pid);
    for (const pid of fixturePids) killFixture(pid);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const opened = spawnSync('/usr/bin/open', ['-g', '-a', bundle], { encoding: 'utf8' });
  assert.equal(opened.status, 0, opened.stderr);
  const first = await until(() => readJSON(statePath));
  fixturePids.add(first.pid);
  assert.equal(first.enabled, true);
  supervisor = spawn(helper, ['--state', statePath, '--session', sessionId], { stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = '';
  supervisor.stderr.on('data', chunk => { diagnostics += chunk; });
  await delay(500);
  assert.equal(supervisor.exitCode, null, diagnostics);
  killFixture(first.pid);
  const second = await until(() => {
    const state = readJSON(statePath);
    return state?.pid && state.pid !== first.pid && state;
  });
  fixturePids.add(second.pid);
  assert.equal(second.sessionId, sessionId);
  // Kill the replacement as soon as it publishes its PID, then require another
  // launch. This also exercises exit/PID updates near `open` completion.
  killFixture(second.pid);
  const third = await until(() => {
    const state = readJSON(statePath);
    return state?.pid && state.pid !== first.pid && state.pid !== second.pid && state;
  }, 25000).catch(error => { throw new Error(`${error.message}\n${diagnostics}`); });
  fixturePids.add(third.pid);
  const events = await until(() => {
    const records = readEvents(eventPath);
    return records.length >= 3 && records;
  });
  assert.equal(events.length, 3);
  assert.equal(events[1].recovered, true);
  assert.equal(events[2].recovered, true);
  atomicState(statePath, { ...third, enabled: false });
  assert.equal(await Promise.race([childExit(supervisor), delay(2000).then(() => 'timeout')]), 0, diagnostics);
  // Disabling the helper must leave the currently running GUI alive.
  assert.doesNotThrow(() => process.kill(third.pid, 0));
  killFixture(third.pid);
  await delay(2500);
  assert.equal(fs.readFileSync(eventPath, 'utf8').trim().split('\n').length, 3);
});

test('native helper exits cleanly for a stale session or an unsafe state file', { skip: !mac }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-recovery-disarm-'));
  fs.chmodSync(temp, 0o700);
  try {
    const statePath = path.join(temp, 'state.json');
    const state = { version: 1, sessionId: randomUUID(), enabled: true, pid: 0,
      appPath: '/tmp/Does Not Exist.app', executablePath: '/tmp/Does Not Exist.app/Contents/MacOS/Fixture' };
    atomicState(statePath, state);
    const stale = spawnSync(helper, ['--state', statePath, '--session', randomUUID()], { encoding: 'utf8', timeout: 3000 });
    assert.equal(stale.status, 0, stale.stderr);
    fs.chmodSync(statePath, 0o644);
    const unsafe = spawnSync(helper, ['--state', statePath, '--session', state.sessionId], { encoding: 'utf8', timeout: 3000 });
    assert.equal(unsafe.status, 0, unsafe.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
