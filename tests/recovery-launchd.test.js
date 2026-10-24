'use strict';
// Real launchd integration, using only a disposable app and a unique test job.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { MacRecovery } = require('../overlay/recovery');
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
async function until(predicate, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for the isolated launchd recovery job.');
}

test('launchd recovers helper and GUI, pause stops reopening, and next manual launch rearms it', { skip: process.platform !== 'darwin', timeout: 220000 }, async t => {
  const root = path.join(__dirname, '..');
  const sourceHelperPath = path.join(root, 'overlay', 'native', 'bin', `recovery-helper-${process.arch}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-launchd-test-'));
  // launchd has no inherited Desktop/Documents privacy authorization. Run the
  // signed helper from an unprotected test directory, matching /Applications in
  // production, rather than allowing dyld to block opening a Desktop checkout.
  const helperPath = path.join(temp, `recovery-helper-${process.arch}`);
  fs.copyFileSync(sourceHelperPath, helperPath);
  fs.chmodSync(helperPath, 0o755);
  const directory = path.join(temp, 'recovery');
  fs.mkdirSync(directory, { mode: 0o700 });
  const token = randomUUID();
  const bundleIdentifier = `com.opencluely.recovery-test.${token}`;
  const label = `${bundleIdentifier}.supervisor`;
  const bundle = path.join(temp, 'Recovery Launchd Fixture.app');
  const executablePath = path.join(bundle, 'Contents', 'MacOS', 'RecoveryFixture');
  const resources = path.join(bundle, 'Contents', 'Resources');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true }); fs.mkdirSync(resources);
  const statePath = path.join(directory, 'state.json');
  const eventPath = path.join(temp, 'events.jsonl');
  const diagnosticPath = path.join(temp, 'helper-diagnostics.log');
  const configPath = path.join(resources, 'fixture-config.json');
  const setToken = sessionId => fs.writeFileSync(configPath, JSON.stringify({ statePath, eventPath, sessionId }));
  setToken(token);
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string><key>CFBundleExecutable</key><string>RecoveryFixture</string>
<key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
  const compiled = spawnSync('xcrun', ['swiftc', path.join(__dirname, 'recovery-fixture.swift'), '-o', executablePath], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  let recovery, completed = false;
  const fixtures = new Set();
  async function jobInfo() {
    try {
      const { stdout } = await run('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`]);
      return { pid: Number(stdout.match(/^\s*pid = (\d+)/m)?.[1]),
        text: stdout.split('\n').filter(line => /^\s*(state|pid|runs|last exit code|last terminating signal|spawn type|job state) =/.test(line)).join('\n') };
    } catch { return null; }
  }
  async function killOwned(pid, expectedPath, signal = 'SIGKILL') {
    const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'uid=,comm='], { encoding: 'utf8' });
    if (result.status !== 0) return;
    const match = result.stdout.trim().match(/^(\d+)\s+(.+)$/);
    assert.ok(match, 'The disposable process must have an observable owner and path');
    assert.equal(Number(match[1]), process.getuid());
    assert.equal(fs.realpathSync(match[2]), fs.realpathSync(expectedPath), 'Only a verified disposable process may be killed');
    process.kill(pid, signal);
    await until(() => {
      const status = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
      return status.status !== 0 || status.stdout.trim().startsWith('Z');
    }, 3000);
  }
  const eventCount = () => fs.existsSync(eventPath) ? fs.readFileSync(eventPath, 'utf8').trim().split('\n').length : 0;
  t.after(async () => {
    if (!completed) console.error(JSON.stringify({ fixtureState: readJSON(statePath), job: await jobInfo(),
      helperDiagnostics: fs.existsSync(diagnosticPath) ? fs.readFileSync(diagnosticPath, 'utf8') : '' }));
    try { await recovery?.stopForQuit(); } catch {
      const state = readJSON(statePath);
      if (state) fs.writeFileSync(statePath, JSON.stringify({ ...state, enabled: false }), { mode: 0o600 });
      try { await run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`]); } catch {}
    }
    const state = readJSON(statePath); if (state?.pid) fixtures.add(state.pid);
    for (const pid of fixtures) await killOwned(pid, executablePath, 'SIGTERM');
    // LaunchServices can finish an already accepted launch after the supervisor
    // has exited. Include any such process before deleting the signed fixture.
    const resolvedExecutable = fs.realpathSync(executablePath);
    const liveFixtures = () => spawnSync('/bin/ps', ['-axo', 'uid=,pid=,stat=,comm='], { encoding: 'utf8' }).stdout.split('\n').flatMap(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      return match && Number(match[1]) === process.getuid() && !match[3].startsWith('Z') && match[4] === resolvedExecutable ? [Number(match[2])] : [];
    });
    await delay(500);
    for (const pid of liveFixtures()) await killOwned(pid, executablePath, 'SIGTERM');
    await until(() => liveFixtures().length === 0, 3000);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const openFixture = () => run('/usr/bin/open', ['-g', '-a', bundle]);
  await openFixture();
  const first = await until(() => readJSON(statePath)); fixtures.add(first.pid);
  const construct = pid => new MacRecovery({ available: true, directory, appPath: bundle, executablePath, helperPath, pid, label, bundleIdentifier,
    run: async args => {
      if (args[0] === 'bootstrap') {
        await run('/usr/bin/plutil', ['-insert', 'StandardErrorPath', '-string', diagnosticPath, args[2]]);
        await run('/usr/bin/plutil', ['-insert', 'EnvironmentVariables', '-json', '{"OPENCLUELY_RECOVERY_DEBUG":"1"}', args[2]]);
      }
      const { stdout } = await run('/bin/launchctl', args, { timeout: 8000 });
      return stdout;
    }
  });
  recovery = construct(first.pid);
  await recovery.enable();
  const helper1 = await until(async () => { const job = await jobInfo(); return job?.pid && job; });
  await delay(400);
  assert.equal(readJSON(statePath).pid, first.pid, 'Enabling recovery must preserve the live GUI PID');
  assert.equal(eventCount(), 1);
  await killOwned(helper1.pid, helperPath);
  const helper2 = await until(async () => { const job = await jobInfo(); return job?.pid && job.pid !== helper1.pid && job; });
  assert.notEqual(helper2.pid, helper1.pid);
  assert.doesNotThrow(() => process.kill(first.pid, 0));
  const firstExitAt = performance.now();
  await killOwned(first.pid, executablePath);
  const second = await until(() => { const state = readJSON(statePath); return state?.pid !== first.pid && state?.pid && state; }, 80000); fixtures.add(second.pid);
  assert.ok(performance.now() - firstExitAt >= 60000, 'launchd recovery must wait at least one minute');
  const secondExitAt = performance.now();
  await killOwned(second.pid, executablePath);
  const third = await until(() => { const state = readJSON(statePath); return state?.pid !== second.pid && state?.pid && state; }, 80000); fixtures.add(third.pid);
  assert.ok(performance.now() - secondExitAt >= 60000, 'Repeated launchd recovery must also wait at least one minute');
  assert.equal(eventCount(), 3, 'Each kill should produce one replacement GUI');
  await recovery.disable();
  assert.equal(await jobInfo(), null);
  assert.doesNotThrow(() => process.kill(third.pid, 0), 'Pausing must leave the GUI alive');
  await killOwned(third.pid, executablePath);
  await delay(3000); assert.equal(eventCount(), 3, 'Paused recovery must not reopen a killed app');
  await openFixture();
  const fourth = await until(() => { const state = readJSON(statePath); return state?.pid !== third.pid && state?.pid && state; }); fixtures.add(fourth.pid);
  recovery = construct(fourth.pid);
  await recovery.enable();
  assert.equal(recovery.status().enabled, true);
  assert.ok((await jobInfo())?.pid);
  await recovery.stopForQuit();
  await killOwned(fourth.pid, executablePath, 'SIGTERM');
  await delay(3000);
  assert.equal(eventCount(), 4, 'Intentional Quit cleanup must keep the app stopped');
  assert.equal(await jobInfo(), null);
  completed = true;
});
