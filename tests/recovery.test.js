'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MacRecovery, recoverySession, launchAgentPlist } = require('../overlay/recovery');

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-recovery-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [], states = [];
  const recovery = new MacRecovery({ available: true, directory, appPath: '/Applications/Test & Recovery.app',
    executablePath: '/Applications/Test & Recovery.app/Contents/MacOS/Test', helperPath: process.execPath,
    pid: 1234, uid: 501, run: async args => { calls.push(args); return 'test job'; },
    onChange: state => states.push(state), ...overrides });
  return { recovery, calls, states, directory };
}
test('ordinary launch arms a private session without restarting its current PID', async t => {
  const { recovery, calls, states } = setup(t);
  await recovery.enable();
  const state = recovery.readState();
  assert.equal(state.enabled, true); assert.equal(state.pid, 1234);
  assert.equal(recovery.status().enabled, true); assert.equal(recovery.status().busy, false);
  assert.equal(fs.statSync(recovery.statePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(recovery.directory).mode & 0o777, 0o700);
  assert.deepEqual(calls.map(call => call[0]), ['bootout', 'bootstrap', 'print']);
  assert.equal(calls.some(call => call.includes('kickstart')), false);
  assert.equal(states[0].busy, true); assert.equal(states.at(-1).busy, false);
  const plist = fs.readFileSync(recovery.plistPath, 'utf8');
  assert.match(plist, /SuccessfulExit<\/key><false\/>/);
  assert.equal(plist.includes('<key>UserName</key>'), false);
  const original = recovery.sessionId;
  await recovery.enable();
  assert.equal(recovery.sessionId, original); assert.equal(calls.length, 3);
});
test('pause disarms on disk before unloading and leaves the GUI process alone', async t => {
  const { recovery, calls } = setup(t);
  await recovery.enable();
  recovery.run = async args => {
    calls.push(args);
    assert.equal(recovery.readState().enabled, false, 'Disarm must precede launchctl');
  };
  await recovery.disable();
  assert.equal(recovery.enabled, false);
  assert.equal(recovery.readState().pid, 1234);
  assert.equal(fs.existsSync(recovery.plistPath), false);
  assert.equal(calls.at(-1)[0], 'bootout');
});
test('next manual launch enables recovery again despite a previously paused session', async t => {
  const { recovery, directory } = setup(t);
  await recovery.enable(); const token = recovery.sessionId;
  await recovery.disable();
  const next = new MacRecovery({ available: true, directory, appPath: recovery.appPath, executablePath: recovery.executablePath,
    helperPath: process.execPath, pid: 5678, run: async () => '' });
  await next.enable();
  assert.equal(next.readState().enabled, true); assert.equal(next.readState().pid, 5678);
  assert.notEqual(next.sessionId, token);
});
test('automatic launch reuses a live session and attaches its new PID without reloading the helper', async t => {
  const { recovery, directory } = setup(t);
  await recovery.enable();
  const token = recovery.sessionId, calls = [];
  const next = new MacRecovery({ available: true, directory, appPath: recovery.appPath, executablePath: recovery.executablePath,
    helperPath: process.execPath, pid: 5678, run: async args => { calls.push(args); return ''; } });
  await next.enable({ sessionId: token });
  assert.equal(next.readState().sessionId, token); assert.equal(next.readState().pid, 5678);
  assert.deepEqual(calls.map(call => call[0]), ['print']);
});
test('paused, stale, or mismatched automatic launch tokens cannot reactivate recovery', async t => {
  const { recovery } = setup(t);
  await recovery.enable(); const token = recovery.sessionId;
  assert.equal(recovery.acceptsSession(randomUUID()), false);
  const state = recovery.readState();
  fs.writeFileSync(recovery.statePath, JSON.stringify({ ...state, executablePath: '/wrong' }));
  assert.equal(recovery.acceptsSession(token), false);
  fs.writeFileSync(recovery.statePath, JSON.stringify(state));
  await recovery.disable();
  assert.equal(recovery.acceptsSession(token), false);
  await assert.rejects(recovery.enable({ sessionId: token }), /session has stopped/);
  assert.equal(recovery.enabled, false);
});
test('failed registration disarms state and surfaces a recoverable error', async t => {
  const { recovery } = setup(t, { run: async args => { if (args[0] === 'bootstrap') throw new Error('Registration rejected'); } });
  await assert.rejects(recovery.enable(), /could not start/);
  assert.equal(recovery.readState().enabled, false); assert.equal(recovery.status().enabled, false);
  assert.match(recovery.status().error, /could not start/); assert.equal(recovery.busy, false);
});
test('missing launchd jobs permit normal start and pause; other errors remain visible', async t => {
  const missing = Object.assign(new Error('not loaded'), { code: 113 });
  const { recovery } = setup(t, { run: async args => { if (args[0] === 'bootout') throw missing; } });
  await recovery.enable(); await recovery.disable();
  assert.equal(recovery.enabled, false);
  await recovery.enable();
  recovery.run = async () => { throw Object.assign(new Error('not permitted'), { code: 5 }); };
  await assert.rejects(recovery.disable(), /paused.*could not be unloaded/);
  assert.equal(recovery.readState().enabled, false);
});
test('intentional Quit waits for an in-progress start then stops recovery', async t => {
  let release;
  const { recovery } = setup(t, { run: async args => {
    if (args[0] === 'bootstrap') await new Promise(resolve => { release = resolve; });
  } });
  const start = recovery.enable();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const stopped = recovery.stopForQuit();
  release(); await start; await stopped;
  assert.equal(recovery.enabled, false); assert.equal(recovery.readState().enabled, false);
});
test('logout disarms synchronously and never blocks session termination', async t => {
  const { recovery } = setup(t);
  await recovery.enable();
  recovery.disarmForSessionEnd();
  assert.equal(recovery.readState().enabled, false); assert.equal(recovery.enabled, false);
});
for (const heldCommand of ['bootout', 'bootstrap']) test(`logout during pending ${heldCommand} cannot rearm recovery`, async t => {
  let release, held = false;
  const commands = [];
  const { recovery } = setup(t, { run: async args => {
    commands.push(args[0]);
    if (args[0] === heldCommand && !held) {
      held = true; await new Promise(resolve => { release = resolve; });
    }
  } });
  const start = recovery.enable();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  recovery.disarmForSessionEnd(); release();
  await assert.rejects(start);
  assert.equal(recovery.enabled, false);
  assert.notEqual(recovery.readState()?.enabled, true);
  if (heldCommand === 'bootout') assert.equal(commands.includes('bootstrap'), false);
  await assert.rejects(recovery.enable(), /signing out/);
});
test('development and unsupported platforms do not register recovery', async t => {
  const { recovery, calls } = setup(t, { available: false });
  await assert.rejects(recovery.enable(), /installed Mac app/);
  await recovery.stopForQuit();
  assert.deepEqual(calls, []);
});
test('launch arguments and plist XML preserve spaces without shell evaluation', () => {
  const token = randomUUID();
  assert.equal(recoverySession(['app', '--opencluely-recovery', token]), token);
  assert.equal(recoverySession(['app']), null);
  assert.equal(recoverySession(['app', '--opencluely-recovery']), '');
  assert.equal(recoverySession(['app', '--opencluely-recovery', 'invalid']), '');
  const plist = launchAgentPlist({ label: 'com.test.recovery', helperPath: '/Test & Stuff/helper', statePath: '/Test <State>/state.json', sessionId: token });
  assert.match(plist, /Test &amp; Stuff/); assert.match(plist, /Test &lt;State&gt;/);
  assert.equal(plist.includes('/bin/sh'), false);
});
