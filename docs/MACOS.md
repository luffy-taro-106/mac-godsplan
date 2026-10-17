# OpenCluely Overlay for Mac

The Mac port preserves the existing green overlay interface, streaming chat, provider switching, image upload/paste/drop, screenshot previews and display selection, click-through, compact view, opacity, conversation follow-ups, stop/retry, Markdown/code copying, export, clear, encrypted restoration, close-to-menu-bar behavior, single-instance handling, renderer recovery, and display/sleep recovery. Version 2.3 adds OpenAI / ChatGPT alongside Claude and Gemini, model dropdowns, and New chat with encrypted conversation archives.

## Open the app

1. Open `dist/OpenCluely-Overlay-2.3.0-mac-arm64.dmg` and drag **OpenCluely Overlay** to Applications. The `arm64` build runs on Apple Silicon Macs. An Intel build can be generated with `npm run build:mac:all`.
2. Launch **OpenCluely Overlay** from Applications. A small star appears in the menu bar. Click it for Show, Settings, click-through, compact view, and Quit. The app runs without a Dock icon.
3. Open the overlay’s Settings, select OpenAI / ChatGPT, Claude, or Gemini, choose a model, and enter your API key. Keys are verified before saving and encrypted using the Mac login Keychain. If macOS asks for Keychain access, allow it for OpenCluely. A chat subscription is separate from provider API access.
4. Type a question or attach a PNG/JPEG. Press Enter to ask; Shift+Enter adds a new line. Screenshots and attachments are previewed before they are sent.

You can also open `dist/mac-arm64/OpenCluely Overlay.app` directly, or double-click `Start OpenCluely.command` to run from this source checkout after installing dependencies. A packaged app works independently of Node and the source folder.

The model dropdown below the toolbar changes the active model immediately. Settings also offers model choices and **Custom model ID** for account-specific or newly released models. Each provider remembers its selection. The catalog was checked against official provider documentation on 17 October 2026; account access and quota still apply.

**New chat** clears the current question, attachment and conversation context. When **Restore my conversation after reopening** is on, the completed conversation is archived first; use **Previous chats** in Settings to reopen it. Opening a previous chat archives the current completed conversation. While an answer is active, stop it before starting or opening another chat. Disabling restoration deletes saved current and archived chats; images are never persisted. **Clear conversation** clears only the current chat. Archives are bounded to 100 chats and 3 MB of text.

Local builds are ad hoc signed, without an Apple Developer ID or notarization. They are intended for local use. If a downloaded build is blocked, use macOS’s **Privacy & Security → Open Anyway** for an app you trust. Public distribution requires Developer ID signing and notarization.

## Mac shortcuts

| Action | Shortcut |
| --- | --- |
| Show / hide and focus question | Command+Option+Space |
| Enable / disable click-through | Command+Option+I |
| Screenshot display under pointer | Command+Option+S |
| Settings while the overlay is focused | Command+, |
| Hide overlay | Escape |

The Screenshot button uses the display selected in Settings. Conflicting global shortcuts appear as warnings in Settings; menu-bar controls remain available. Command+C/V/X/A work in editable fields. Click-through releases the overlay’s keyboard focus as well as passing mouse events through. Use the shortcut or menu bar to interact again.

The overlay appears across Spaces and above ordinary fullscreen apps. It does not continuously steal focus. macOS secure screens, some exclusive fullscreen apps, Mission Control, and system UI can supersede ordinary app windows.

## Screenshots and sharing

Screen capture needs macOS **System Settings → Privacy & Security → Screen & System Audio Recording** permission. The name may be **Screen Recording** on older releases. Use **Open Screen Recording settings** in the overlay’s Settings or its menu-bar menu. Enable OpenCluely, then quit and reopen it if macOS requests that. Source development may list **Electron** rather than OpenCluely. Upload/paste/drop do not require screen capture permission. No microphone or camera permission is requested.

**The Windows capture-exclusion guarantee cannot be reproduced for all Mac screen-sharing apps.** Electron’s Mac content protection uses a legacy window-sharing flag. Newer clients using ScreenCaptureKit can still record the overlay. The setting is retained as **Request capture protection (best effort)**, with the limitation shown beside it. Share a specific app window or hide the overlay before sharing the entire screen. Verify your actual meeting client’s preview. See [Electron’s documented limitation](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable).

The app hides its own overlay during screenshots and restores it afterward. Screenshots are never taken on a timer or while idle.

## Start at login and saved data

Move the app to Applications before enabling **Start in menu bar when I sign in**. macOS registers the app bundle as a login item. A login launch starts hidden; manually opening the app shows it. If macOS requires approval, enable it under **General → Login Items**. Unsigned/notarization-free builds can be refused by macOS; the app surfaces a failed registration and directs you to Login Items. Login startup has not been proven by a full reboot in this session.

Closing or hiding the overlay keeps it running. Choose **Quit OpenCluely** explicitly to stop it. It cannot run while the Mac is off or asleep. Sleep cancels an active answer; retry after waking.

Starting with 2.1.1, **Protect against normal Quit requests** is enabled by default, including for existing profiles. Normal external Quit requests are rejected before they can cancel an answer or close the window. OpenCluely’s menu-bar Quit, Command+Q and Settings Quit ask for confirmation, with **Keep running** selected by default. Turn the protection off in Settings for ordinary unguarded Quit behavior. macOS shutdown notifications bypass this guard. Force Quit and process signals can still stop the app; software with Accessibility permission may operate the same confirmation controls you can. This is protection against cooperative closing, not a boundary against an authorized UI controller. See [close-protection notes](CLOSE-PROTECTION.md).

Starting with 2.2.0, the installed Mac app also enables **Reopen automatically after a crash or Force Quit** each time you open it. Turn the switch off in Settings or the menu bar to pause recovery immediately; it stays off until you open the app again. A confirmed **Quit OpenCluely** stops both the app and recovery. Recovery uses a small native helper with process-exit notifications; it does not add a login item or change the sign-in preference. See [recovery behavior, resource use, and emergency stop](AUTOMATIC-REOPENING.md). Building Mac packages now requires Xcode Command Line Tools to compile the helper.

Preferences, encrypted keys, optional encrypted conversation text, and bounded diagnostics live in `~/Library/Application Support/OpenCluely Overlay`. Keep this profile and your login Keychain when upgrading. Do not share it. Version 2.3 migrates existing conversation text into an encrypted current-chat/archive store when it is next saved. Image pixels stay in bounded memory and are not restored after restart. Exports are plain Markdown files saved only when you choose Export.

## Develop and build

Requires macOS 13 or newer. Use Node 22.12 or newer (Node 24 recommended) for development:

```sh
git clone https://github.com/ashokchilka99/mac-godsplan.git
cd mac-godsplan
npm ci
npm start
npm test
npm run test:desktop
npm run build:mac
```

`npm run build:mac:all` produces Apple Silicon and Intel DMGs/ZIPs. `npm run pack:mac` produces only the Apple Silicon app bundle. The package includes a Retina menu-bar template icon, a multi-resolution Mac icon, accessory-app metadata, screen-capture purpose text, and hardened-runtime entitlements for JIT and locally signed Electron frameworks. Native file dialogs, the Keychain, and login-item registration are handled by Electron/macOS. The configured `mac.identity` is `-` for ad hoc local signing; use a Developer ID identity and notarization credentials for public distribution.

Desktop tests use a temporary profile and mock AI responses, so they never need a paid provider request. They test the real interface and native window. On Mac, Xcode Command Line Tools let the suite compile a tiny native fixture to send a normal Quit request to its own parent test app; without those tools that native check is explicitly skipped. Screenshot pixels are checked only if Screen Recording permission is already granted; otherwise that check is explicitly skipped. Provider billing, model access, actual meeting-client capture behavior, a full logout/reboot, and Intel hardware require separate user/environment validation.

See [the 2.3 end-to-end report](E2E-VERIFICATION.md) for current checks. `MACOS-VERIFICATION.md` records the earlier Mac port verification.
