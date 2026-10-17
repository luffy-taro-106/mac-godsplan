'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');

const LABEL = 'com.opencluely.overlay.recovery';
const RECOVERY_ARGUMENT = '--opencluely-recovery';
const escapeXML = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));

function recoverySession(argv) {
  const index = argv.indexOf(RECOVERY_ARGUMENT);
  if (index === -1) return null;
  return typeof argv[index + 1] === 'string' && /^[a-f0-9-]{36}$/i.test(argv[index + 1]) ? argv[index + 1] : '';
}

function launchAgentPlist({ label, helperPath, statePath, sessionId, bundleIdentifier = 'com.opencluely.overlay' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${escapeXML(label)}</string>
<key>ProgramArguments</key><array>${[helperPath, '--state', statePath, '--session', sessionId].map(value => `<string>${escapeXML(value)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>5</integer>
<key>ProcessType</key><string>Background</string>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>AssociatedBundleIdentifiers</key><array><string>${escapeXML(bundleIdentifier)}</string></array>
</dict></plist>
`;
}

function launchctl(args) {
  return new Promise((resolve, reject) => {
    execFile('/bin/launchctl', args, { encoding: 'utf8', timeout: 8000, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); }
      else resolve(stdout);
    });
  });
}
function missingJob(error) {
  return [3, 113].includes(error.code) || /could not find service|no such process|service not found/i.test(error.stderr || '');
}
function writePrivate(file, content) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const attributes = fs.lstatSync(directory);
  if (!attributes.isDirectory() || attributes.isSymbolicLink()) throw new Error('Recovery data directory must be a real directory.');
  fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, `.write-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

// The GUI process is never a child of this LaunchAgent. Unloading recovery must
// not terminate the overlay, and the plist is deliberately outside LaunchAgents
// so recovery cannot silently become another launch-at-login preference.
class MacRecovery {
  constructor({ available, directory, appPath, executablePath, helperPath, pid = process.pid,
    uid = typeof process.getuid === 'function' ? process.getuid() : 0, label = LABEL,
    run = launchctl, onChange = () => {}, bundleIdentifier = 'com.opencluely.overlay' }) {
    if (!/^[-a-zA-Z0-9.]+$/.test(label)) throw new Error('Invalid recovery service label.');
    this.available = available;
    this.directory = directory; this.appPath = appPath; this.executablePath = executablePath;
    this.helperPath = helperPath; this.pid = pid; this.label = label; this.run = run; this.onChange = onChange;
    this.bundleIdentifier = bundleIdentifier;
    this.domain = `gui/${uid}`; this.target = `${this.domain}/${label}`;
    this.statePath = path.join(directory, 'state.json');
    this.plistPath = path.join(directory, 'recovery.plist');
    this.enabled = false; this.busy = false; this.error = ''; this.sessionId = null; this.pending = null;
    this.sessionEnding = false;
  }
  status() { return { available: this.available, enabled: this.enabled, busy: this.busy, error: this.error }; }
  changed() { this.onChange(this.status()); }
  readState() {
    try {
      const file = fs.lstatSync(this.statePath);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 16384) return null;
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch { return null; }
  }
  acceptsSession(sessionId) {
    const state = this.readState();
    return !!sessionId && state?.version === 1 && state.enabled === true && state.sessionId === sessionId &&
      state.appPath === this.appPath && state.executablePath === this.executablePath;
  }
  writeState(enabled) {
    writePrivate(this.statePath, JSON.stringify({ version: 1, sessionId: this.sessionId,
      enabled, pid: this.pid, executablePath: this.executablePath, appPath: this.appPath }));
  }
  async unload() {
    try { await this.run(['bootout', this.target]); }
    catch (error) { if (!missingJob(error)) throw error; }
  }
  operation(action) {
    if (this.busy) return Promise.reject(new Error('Automatic reopening is already changing. Please wait.'));
    this.busy = true; this.error = ''; this.changed();
    this.pending = Promise.resolve().then(action).catch(error => {
      this.error = error.message || 'Automatic reopening could not be changed.';
      throw error;
    }).finally(() => { this.busy = false; this.pending = null; this.changed(); });
    return this.pending;
  }
  enable({ sessionId = null } = {}) {
    if (this.sessionEnding) return Promise.reject(new Error('Automatic reopening cannot start while signing out.'));
    if (!this.available) return Promise.reject(new Error('Automatic reopening is available in the installed Mac app.'));
    if (this.enabled && !this.busy) return Promise.resolve(this.status());
    return this.operation(async () => {
      if (sessionId && !this.acceptsSession(sessionId)) throw new Error('This automatic reopening session has stopped.');
      if (!sessionId) {
        // Disable any previous supervisor before installing a fresh session.
        const previous = this.readState();
        if (previous) writePrivate(this.statePath, JSON.stringify({ ...previous, enabled: false }));
        await this.unload();
      }
      if (this.sessionEnding) throw new Error('Automatic reopening cannot start while signing out.');
      this.sessionId = sessionId || randomUUID();
      try {
        fs.accessSync(this.helperPath, fs.constants.X_OK);
        this.writeState(true);
        let loaded = false;
        if (sessionId) {
          try { await this.run(['print', this.target]); loaded = true; }
          catch (error) { if (!missingJob(error)) throw error; }
        }
        if (!loaded) {
          if (this.sessionEnding) throw new Error('Session ended.');
          writePrivate(this.plistPath, launchAgentPlist({ label: this.label, helperPath: this.helperPath, statePath: this.statePath, sessionId: this.sessionId, bundleIdentifier: this.bundleIdentifier }));
          await this.run(['bootstrap', this.domain, this.plistPath]);
          await this.run(['print', this.target]);
        }
        if (this.sessionEnding) throw new Error('Session ended.');
        this.enabled = true;
        return this.status();
      } catch (error) {
        try { this.writeState(false); } catch { try { fs.rmSync(this.statePath, { force: true }); } catch {} }
        try { await this.unload(); } catch {}
        this.enabled = false;
        throw new Error('Automatic reopening could not start. Try turning it on again, or reopen the app.');
      }
    });
  }
  disable() {
    if (!this.available) return Promise.resolve(this.status());
    return this.operation(async () => {
      let disarmed = false;
      try { this.writeState(false); disarmed = true; }
      catch {
        try { fs.rmSync(this.statePath, { force: true }); disarmed = true; } catch {}
      }
      let unloaded = false;
      try { await this.unload(); unloaded = true; } catch {}
      if (!disarmed || !unloaded) {
        if (disarmed) this.enabled = false;
        throw new Error(disarmed ? 'Reopening is paused, but its helper could not be unloaded. Try turning it off again.' : 'Recovery state could not be cleared. Check available disk space and try turning reopening off again.');
      }
      this.enabled = false;
      fs.rmSync(this.plistPath, { force: true });
      return this.status();
    });
  }
  async stopForQuit() {
    if (this.pending) { try { await this.pending; } catch {} }
    if (this.available) await this.disable();
  }
  disarmForSessionEnd() {
    this.sessionEnding = true;
    try {
      const previous = this.readState();
      if (previous) writePrivate(this.statePath, JSON.stringify({ ...previous, enabled: false }));
    } catch { try { fs.rmSync(this.statePath, { force: true }); } catch {} }
    this.enabled = false;
    // The GUI domain itself is removed on logout. Do not delay OS shutdown.
    if (this.available) void this.unload().catch(() => {});
  }
}

module.exports = { MacRecovery, LABEL, RECOVERY_ARGUMENT, recoverySession, launchAgentPlist };
