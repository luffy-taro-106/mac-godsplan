# Mac verification — 16 October 2026

Historical Mac-port report. See [the 17 October 2.3 end-to-end verification](E2E-VERIFICATION.md) for the current installed version, screenshots, providers, chats and recovery results.

Environment: Apple Silicon (`arm64`), macOS 27.0 (26A428), Node 24.19.0, Electron 44.7.0. Adapted from upstream commit recorded by the local clone. This report concerns the Mac port; the original Windows report is retained separately.

## Results

- `npm test`: **22 passed**, 0 failed. Covers settings/question/image validation, detached-monitor geometry, bounded conversation context, provider authentication/payloads/streaming/retries/deadlines, encrypted atomic persistence, and Mac/Windows startup and shortcut rules.
- `npm run test:desktop`: **12 passed**, 0 failed, **1 skipped** (11 checks in the main process plus credential restoration in a fresh Electron process). The real sandboxed renderer loaded local Markdown/sanitization libraries with no renderer console errors. Verified close-to-menu-bar lifetime, topmost mode, focused-window click-through releasing keyboard focus, compact restoration, all-Spaces mode, Mac shortcut labels, capture limitation text, permission-denial recovery, native Keychain-backed encryption, key replacement/rollback, paste-image preview and submission, image follow-up context, cancellation, IPC caller isolation, renderer-crash recovery, and bounded caches.
- Native screen pixels were **not tested** because Screen Recording permission was not granted to the Electron test app. The suite reports this as skipped; it does not silently treat it as a pass. Permission-denied/restricted behavior was checked without changing OS permissions.
- Apple Silicon `.app`, DMG, and ZIP built successfully. Bundle metadata includes `com.opencluely.overlay`, accessory-app behavior, Mac icon, screen-capture purpose text, and macOS 13 minimum version.
- Ad hoc signature verified with `codesign --verify --deep --strict`. Signed entitlements include JIT and library validation exemption for locally signed Electron frameworks. This is **not** Developer ID signing or notarization.
- `hdiutil verify` accepted the DMG checksum; `unzip -tq` found no ZIP errors.
- Installed at `/Applications/OpenCluely Overlay.app`, verified its signature again, and launched it. Native accessibility inspection showed the rendered interface loading from the installed app archive, including Claude/Gemini selection, image/screenshot/click-through/Settings controls, question field, menu-bar status, and Command+Option shortcuts.
- Source syntax, entitlement plist, and diff whitespace checks passed.

## Runtime download

GitHub release-asset TLS connections failed on this network. Electron was obtained from the npm mirror with certificate validation enabled and verified against the checksum supplied in the official Electron npm package:

```text
electron-v44.7.0-darwin-arm64.zip
e04e411b58a0a14375dd21b0ab4a378fd38930a702e4e20e322fee4849404c0b
```

Build commands used the verified local Electron distribution. The DMG helper came from the build-tool mirror and was validated by electron-builder against its bundled checksum. No TLS or checksum validation was disabled.

## Remaining environment checks

No real provider key or billable AI request was used. Add a Claude/Gemini API key in Settings to use answers. Actual screenshots need permission for the installed app. Login-item registration and a full logout/reboot were not exercised, and no Intel Mac was available. The app reports rejected or approval-pending login registration; manual startup uses macOS Login Items. Actual meeting-client capture behavior must be checked in that client. macOS ScreenCaptureKit capture exclusion cannot be guaranteed by Electron; this limitation is shown in the interface and setup guide.

Generated test artifacts are in `.test-output/`, excluded from Git. Installers and a checksum manifest are in `dist/`, also excluded from Git. No real keys were added to the source or test report.
