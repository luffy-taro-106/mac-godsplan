'use strict';
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(directory, crypto, report = () => {}) {
    this.directory = directory; this.crypto = crypto; this.report = report;
    fs.mkdirSync(directory, { recursive: true });
  }
  available() {
    return this.crypto.isEncryptionAvailable() && !(process.platform === 'linux' && this.crypto.getSelectedStorageBackend() === 'basic_text');
  }
  read(name, fallback, encrypted = false) {
    const file = path.join(this.directory, name);
    if (!fs.existsSync(file)) return fallback;
    try {
      if (fs.statSync(file).size > (name === 'chats.enc' ? 8 : 4) * 1024 * 1024) throw new Error('Oversized settings file');
      const data = fs.readFileSync(file);
      return JSON.parse(encrypted ? this.crypto.decryptString(data) : data.toString('utf8'));
    } catch {
      this.report(`Could not restore ${name}. Your existing file was preserved; defaults are in use.`);
      return fallback;
    }
  }
  write(name, value, encrypted = false) {
    if (encrypted && !this.available()) throw new Error('Secure storage is unavailable. Keys and history cannot be saved on this device.');
    const text = JSON.stringify(value);
    const target = path.join(this.directory, name), temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, encrypted ? this.crypto.encryptString(text) : text, { mode: 0o600 });
    fs.renameSync(temporary, target);
  }
  remove(name) { fs.rmSync(path.join(this.directory, name), { force: true }); }
}
module.exports = { Store };
