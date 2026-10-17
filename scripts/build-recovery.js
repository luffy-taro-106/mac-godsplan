'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// This script only builds the native executable. It never registers a service.
if (process.platform !== 'darwin') {
  console.log('macOS recovery helper: skipped on this platform.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const source = path.join(root, 'overlay', 'native', 'recovery-helper.swift');
const outputDir = path.join(root, 'overlay', 'native', 'bin');
const archArgs = process.argv.slice(2);
const archs = archArgs.includes('--all') ? ['arm64', 'x64'] :
  archArgs.length ? archArgs : [process.env.npm_config_arch || process.arch];
if (archs.some(arch => !['arm64', 'x64'].includes(arch))) {
  console.error('Usage: node scripts/build-recovery.js [arm64|x64|--all]');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
for (const arch of [...new Set(archs)]) {
  const output = path.join(outputDir, `recovery-helper-${arch}`);
  const temporary = `${output}.${process.pid}.tmp`;
  const target = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`;
  const result = spawnSync('xcrun', ['swiftc', '-O', '-target', target, source, '-o', temporary], {
    stdio: 'inherit', timeout: 120000
  });
  if (result.error || result.status !== 0) {
    fs.rmSync(temporary, { force: true });
    console.error(result.error?.message || 'Native recovery helper compilation failed.');
    process.exit(result.status || 1);
  }
  // Provide an ad-hoc signature for local/dev runs; electron-builder signs the
  // unpacked helper again as part of signing the packaged application.
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', temporary], {
    stdio: 'inherit', timeout: 30000
  });
  if (signed.error || signed.status !== 0) {
    fs.rmSync(temporary, { force: true });
    console.error(signed.error?.message || 'Native recovery helper signing failed.');
    process.exit(signed.status || 1);
  }
  fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, output);
  console.log(`Built macOS recovery helper (${arch}).`);
}
