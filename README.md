# OpenCluely Overlay 2.3.5

**Mac God'sPlan** (`mac-godsplan`) is the macOS adaptation of [ashokchilka99/opencluely-overlay](https://github.com/ashokchilka99/opencluely-overlay). The source, tests, native recovery helper, build configuration and setup documentation are included here.

macOS and Windows desktop assistant for text and image questions using OpenAI / ChatGPT, Claude, or Gemini.

**Mac:** Open `dist/mac-arm64/OpenCluely Overlay.app`, or install the DMG from `dist/`. See [Mac setup and feature notes](docs/MACOS.md). The original interface and text/image features are preserved, with native menu-bar controls, Command+Option shortcuts, Keychain encryption, and screenshot permission guidance. Screen-sharing exclusion is best effort on macOS; modern ScreenCaptureKit clients can still capture the overlay.

Version 2.2.0 adds **automatic reopening** on Mac, enabled whenever the installed app opens. Pause it immediately from Settings or the menu bar; a deliberate Quit stops both the app and recovery. The next app opening enables it again. See [automatic reopening and owner controls](docs/AUTOMATIC-REOPENING.md).

Version 2.3.0 adds **OpenAI / ChatGPT API support**, provider-specific model dropdowns with a custom-ID option, and **New chat**. With restoration enabled, previous conversations are encrypted and can be reopened from Settings. See the [end-to-end verification](docs/E2E-VERIFICATION.md) and [upstream comparison](docs/COMPARISON.md).

Version 2.3.1 adds **encrypted interrupted-answer recovery**, file flushing before atomic saves, and continued generation during a renderer crash. A restored partial answer is available for review and manual retry; it never automatically resends your question. This does not prevent forced termination or establish compatibility with assessment software. See [resilience behavior and verification](docs/RESILIENCE.md).

Version 2.3.2 removes the overlay's logo, brand heading, tagline and welcome slogans, and supports **up to five images per question** across upload, paste, drop and screenshot attachments. Each preview can be removed individually. OpenAI, Claude and Gemini receive every selected image in order. See [image support and verification](docs/IMAGES.md).

Version 2.3.4 supports **up to ten images per question** and adds fully independent **App opacity** and **Code box opacity** sliders. Code boxes can remain at 100% with the app at 10%, or fade to 10% with the app at 100%. Both settings are saved independently.

Version 2.3.8 removes the Read/Type switch. The Mac overlay stays editable and applies native activation prevention to its own panel, so typing does not require activating the overlay application. Automatic reopening waits one minute. See [panel behavior, research and limits](docs/NONACTIVATING-PANEL.md).

**Protect against normal Quit requests** remains enabled by default. External cooperative Quit requests are declined; quitting through OpenCluely asks for confirmation. Force termination can still interrupt the app; automatic reopening provides recovery afterward. See [close-protection details and checks](docs/CLOSE-PROTECTION.md).

- Always-on-top overlay with tray controls, click-through, and global shortcuts.
- Text questions, image upload/paste/drop, screenshots, and streamed answers.
- Separate OpenAI, Claude, and Gemini keys, verified before saving with Keychain-backed encryption on Mac or Windows encryption.
- Screen-capture protection enabled by default; check your meeting client's preview.
- Optional startup after sign-in and encrypted conversation restoration.

Download the Windows installer from [Releases](https://github.com/ashokchilka99/opencluely-overlay/releases/latest). It is an unsigned development build.

See [setup, privacy and development documentation](README-OVERLAY.md), [Windows startup](docs/STARTUP.md), and [verification results](docs/VERIFICATION.md).

The installed app starts in the tray after Windows sign-in. Ctrl+Alt+Space shows or hides it. Source development requires running `npm ci` first.

For source development, use Node.js 22.12 or newer:

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run build:win
```

Desktop checks require an interactive desktop session. Test outputs stay in the ignored `.test-output/` directory. API keys, local conversations, dependencies, and generated builds are excluded from Git.

On macOS, use `npm run build:mac` for Apple Silicon, `npm run build:mac:all` for Apple Silicon and Intel, or `npm run pack:mac` for an app bundle. Desktop checks also run on Mac, with screenshot capture checked only when Screen Recording permission is already granted. Unit tests never need provider keys.

Based on [arth-agrawal/OpenCluely](https://github.com/arth-agrawal/OpenCluely) and [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely). The original implementation remains available in Git history. Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
