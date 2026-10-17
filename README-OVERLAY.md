# OpenCluely Overlay 2.3

A macOS and Windows desktop assistant that stays above your apps and answers text and image questions using **OpenAI / ChatGPT**, **Claude**, or **Gemini**.

**For Mac installation and Mac-specific behavior, start with [docs/MACOS.md](docs/MACOS.md).** The Windows installation steps below continue to apply to the original Windows build.

Built from [arth-agrawal/OpenCluely](https://github.com/arth-agrawal/OpenCluely), based on [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely). The original implementation is available upstream and in this repository's Git history. The current source and packaged app use the `overlay/` implementation, focused on text and images.

## Get started

1. Download `OpenCluely-Overlay-Setup-2.1.0.exe` from [Releases](https://github.com/ashokchilka99/opencluely-overlay/releases/latest) and install it. Source builds place the installer under `dist/`.
2. Click the gear, choose OpenAI / ChatGPT, Claude, or Gemini, select a model, enter your provider API key, and save. The app checks API access before saving it encrypted on this device. Save a separate key for each provider you use. Saved keys restore after the app or computer restarts. To replace a key, enter the new key and save; a failed check preserves the previous key. Leave the field blank to keep it.
3. Type a question and press Enter. Shift+Enter adds a new line.
4. For an image question, use the image button, paste from the clipboard, drag an image onto the window, or take a screenshot. Preview the image, optionally type a question, and press Enter. With no text, the assistant reads and answers the question in the image.

These are unsigned development builds; Windows may show a publisher warning. Public distribution should use a trusted code-signing certificate. API usage is billed by your provider. A chat subscription may not include API credits.

## Overlay behavior

- Stays above ordinary desktop windows. Drag the title bar to move it and use the edges to resize.
- The pointer button enables click-through, allowing mouse and keyboard input to reach the app underneath. Use Ctrl+Alt+I or the tray to interact again.
- The compact button collapses the conversation to a small toolbar.
- The minus button, Escape, and the normal close action hide to the tray. The process and active answer keep running. Quit explicitly through the tray or Settings.
- Enable Start in tray when I sign in in the installed app to launch with Windows. This option is disabled in portable/source builds because their executable path may be temporary.
- Closing other apps does not close this assistant. No hidden service or continuous refocusing is installed.
- Hide overlay from screen sharing and recordings is enabled by default, including for existing profiles. It protects the overlay and its in-window Settings, and stays enabled after sleep, recovery and restart. You can turn it off in Settings.

| Action | Windows | Mac |
| --- | --- | --- |
| Show / hide | Ctrl+Alt+Space | Command+Option+Space |
| Toggle click-through | Ctrl+Alt+I | Command+Option+I |
| Screenshot | Ctrl+Alt+S | Command+Option+S |

If another app has registered a shortcut, Settings shows a warning and the tray/buttons remain available. The Screenshot button uses the display selected in Settings; the global shortcut captures the display under the pointer. Screenshots are previewed, and nothing is sent until you ask.

## Text and image handling

- OpenAI, Claude and Gemini stream answers into one conversation. Switch using the provider selector.
- Attach one PNG/JPEG per question, up to 10 MB and 32 megapixels. The app validates the format and dimensions before decoding. Images are converted to JPEG and capped at 2560 pixels on the longest side. Use a close crop for small text.
- Follow-ups may include up to three recent images from this session. The image cache holds at most ten images. Older images may need to be attached again.
- Requests include at most eight previous completed exchanges, bounded to about 48,000 text characters. Incomplete/cancelled answers do not enter model context.
- Stop cancels the active request. Temporary failures are retried up to twice, only before output arrives. Requests have a two-minute total deadline. Interrupted output requires an explicit retry.
- Provider-specific model dropdowns include 16 text/vision choices verified on 17 October 2026. Defaults are `gpt-6.1-sol`, `claude-sonnet-5-5`, and `gemini-3.8-flash`. A custom-ID option remains available. Access depends on your account; the app never silently switches models or providers.
- **New chat** resets the composer and context. With restoration enabled, previous completed conversations are encrypted and can be reopened or deleted from Settings. Stop an active answer before changing conversations.
- Answers support Markdown, code blocks, copying and Markdown export. Generated HTML is sanitized; remote images and scripts are blocked. Clicking a generated link copies it for you to open in your own browser.

## Privacy

Text and attached images go directly to your selected AI provider over HTTPS when you ask. There is no application backend or telemetry. Retention and costs depend on your provider account. Recent images can be sent again as follow-up context during the current session.

Saved keys stay in the native process and do not return in renderer state or exports. Keys and optional saved conversation text are encrypted with Electron safeStorage, using the login Keychain on macOS and DPAPI on Windows. This protects saved files; other processes running as your user may still be able to decrypt them. If encryption is unavailable, the app refuses to persist keys/history instead of saving plaintext.

Images stay in bounded memory and are never written to conversation history. Reopening restores text and image names, but you must reattach pixels. Disabling restoration removes saved current and archived history. Clear conversation removes the current chat and releases its images; previous chats remain available. Exports are plaintext Markdown saved only when you choose Export.

Data lives in `~/Library/Application Support/OpenCluely Overlay` on Mac and `%APPDATA%/OpenCluely Overlay` on Windows. Renderer drafts and caches use an in-memory browser session. Diagnostics are size-bounded and contain lifecycle/error categories, not prompts, image pixels, keys or provider response bodies.

Key verification makes a metadata request to the selected provider's models API, with the key in an HTTPS header. It does not generate an answer or send your conversation. API access checks do not guarantee billing credit, quota, or access to every model. There is no verification call at startup; a saved key can be used immediately when the app starts.

Capture exclusion uses Electron's content protection and Windows `WDA_EXCLUDEFROMCAPTURE`. Windows 10 version 2004 or newer removes the window from supported capture paths; older versions can show a blank rectangle. **On macOS, newer clients using ScreenCaptureKit can capture the window even when protection is requested. The app labels this best effort.** Share a specific application window or hide the overlay when needed. Meeting apps and capture modes vary, so check the sharing preview or a private recording before relying on it. Native file pickers, system dialogs, and external camera photographs are outside this overlay's protection. See [Electron's window API](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable) and [Microsoft's capture-affinity documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Reliability and limits

Includes a single-instance lock, close-to-tray lifetime, renderer crash recovery with loop limits, suspend cancellation, resume handling, bounded caches, checked IPC callers, monitor-boundary recovery, and atomic settings/history writes. It does not poll or capture screens while idle.

Windows can terminate the app through Task Manager, shutdown/sign-out, or a main-process crash. It cannot run while the computer sleeps or is off. UAC/security screens and some exclusive fullscreen applications prevent ordinary overlays. Sleep cancels active requests; retry after resume. Capture exclusion cannot guarantee compatibility with every meeting app or recording method.

AI answers can be wrong, especially with blurry images. The assistant is instructed to identify unclear text and uncertainty. No finite test suite can guarantee a bug-free app or smooth behavior above every application.

## Develop and build

Use Node.js 22.12 or newer and Git. In PowerShell or Command Prompt:

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run build:win
```

The launch script clears ELECTRON_RUN_AS_NODE for the child and works on Windows. No Python, Whisper, microphone or audio setup is required. Dependencies are pinned in package-lock.json. A scoped global-agent override removes an advisory in the build dependency tree.

The installed app works independently of this source folder. Generated builds are excluded from Git and distributed through Releases. Desktop test artifacts stay in `.test-output/`, which is also excluded from Git. Keep the entire `%APPDATA%/OpenCluely Overlay` profile when upgrading so Windows can restore encrypted keys and history.

The desktop test suite uses a temporary profile and mock AI responses. It exercises Windows topmost/tray behavior, click-through, compact sizing, DPAPI, key replacement and rollback, restoration in a new Electron process, image paste, real UI submission, safe rendering, follow-up context, cancellation, IPC caller isolation, renderer recovery, capture and cache limits. It checks real screen-capture pixels with exclusion switched off/on and Settings open. It does not validate every meeting client, a paid API call or model answer accuracy.

If your network cannot download GitHub release assets, use an HTTPS mirror for the build process. The development Electron binary for this build was obtained through the npm mirror and verified against Electron's published checksum. Certificate validation stayed enabled.

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run build:win
```

## Source

- overlay/main.js: lifecycle, native images, IPC, requests and tray.
- overlay/providers.js: provider payloads, streaming, deadlines and retries.
- overlay/core.js: validation, window bounds and context limits.
- overlay/storage.js: encrypted persistence and atomic writes.
- overlay/preload.js: limited renderer bridge.
- overlay/ui/: local interface with no external assets or renderer networking.
- tests/: unit tests and Windows integration suite.
- Git history and upstream repositories: original implementation for reference.

## References and license

[Electron window API](https://www.electronjs.org/docs/latest/api/browser-window), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Claude models](https://platform.claude.com/docs/en/models/overview), [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

Apache-2.0. See LICENSE and NOTICE. The original README described MIT, while the supplied LICENSE contains Apache-2.0; this package follows the supplied LICENSE and preserves upstream attribution.
