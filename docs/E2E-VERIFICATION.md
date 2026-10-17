# OpenCluely Overlay 2.3.0 end-to-end verification

Checked 17 October 2026 on the local Apple Silicon Mac, macOS 27.0 (26A428), Electron 44.7.0. Installed app: `/Applications/OpenCluely Overlay.app`.

## Automated results

- `npm test`: **44 passed**, no failures or skips. Covers provider request construction and streaming, image validation/context limits, encrypted storage, settings migration, platform rules, Quit protection, and recovery registration/session/shutdown races.
- `npm run test:desktop`: **21 desktop scenarios passed**, no skips, followed by **two successful fresh-process restoration/confirmed-Quit checks**. Uses the real Electron main process, sandboxed renderer and IPC with temporary profiles and mock provider responses.
- `npm run test:recovery`: **four native/integration checks passed**. A disposable signed GUI and unique launchd job exercise actual SIGKILL events, repeated reopening, recovery of the killed helper, pausing without closing the GUI, manual reopening, stale/unsafe state rejection, and explicit stopping. Fixture teardown also verifies no process remains at its unique executable path.

| Feature group | Exercised behavior |
| --- | --- |
| Window/lifetime | Topmost window, close-to-menu-bar, click-through and focus release, compact/normal dimensions, opacity, all-Spaces configuration, shortcut registration and labels, explicit Quit and cancelled Quit |
| Provider/model controls | All three providers, every catalog option, per-provider model selections, custom model ID, encrypted OpenAI key, key replacement/failure rollback/removal, no keys in renderer state |
| Answers | Real renderer submission, streamed text, follow-up text/image context, duplicate-request rejection, cancellation, retry, incomplete-turn exclusion, Markdown sanitization and code/answer copying |
| Images | PNG/JPEG import, native clipboard image paste, drag/drop, file-picker import/cancellation, rejection of invalid/oversized input, preview removal, bounded image cache, native screenshot pixels and bounded JPEG result |
| Chats | New chat, encrypted archive/current storage, restoration in another process, reopen previous chat, archive-write failure preserving current chat, delete confirmation/cancel, clear confirmation/cancel, restoration opt-out, active-answer switching rejection |
| Export/security/recovery | Markdown export via real IPC with a temporary save destination, caller isolation, renderer-crash recovery, normal external native Quit rejection, pause/rearm while an answer is active |

The suite caught Electron 44's removal of `clipboard.readImage/writeImage` and asynchronous text clipboard methods. The app now uses the current ClipboardItem/Blob image API and awaits text copying. Tests also caught fresh-process migration expectations and disposal timing in the native fixture. Recovery tests explicitly wait for owned processes to exit and clean up pending LaunchServices fixture launches before deleting the fixture bundle.

## Installed-app checks

- Backed up the prior 2.2.0 app and profile in private temporary storage before replacement. Existing encrypted key and conversation restored in 2.3.0; Keychain secrets were not exported or printed.
- Verified the installed version and `LSUIElement=true`; the app uses accessory activation policy, menu-bar controls and no Dock icon. This does not prevent process termination.
- Confirmed owner Quit unloaded the production recovery job and stopped the app before installation. Reopening enabled recovery again. The preceding 2.2 installation also passed a real production main-process SIGKILL/relaunch check (PID 28752 → 29197), an immediate recovery pause, and rearming through an explicit app open. Recovery code is unchanged in 2.3.
- With the user's explicit permission, enabled Screen & System Audio Recording for the installed app. The stale permission entry after the ad hoc update was removed and the installed 2.3 app re-added through System Settings. After controlled restart, the app reported permission enabled and produced a **2560 × 1440 BenQ display screenshot preview**. The attachment was removed locally and was **not sent to any provider**.
- Used New chat to preserve the original conversation, sent one short synthetic question with the existing Claude Sonnet 5.5 key, and received **“OpenCluely test OK.”** through the installed app. Reopened the original conversation afterward; the test exchange is available in Previous chats.

## Package checks and limits

Apple Silicon app, DMG and ZIP built successfully. Strict deep code-signature verification passed for the build and installed app; DMG checksums and every ZIP entry passed integrity checks. See `dist/MACOS-2.3.0-SHA256SUMS.txt`. This local build is ad hoc signed, not Developer ID signed or notarized. Intel and Windows packages were not rebuilt or exercised in this session.

OpenAI/Gemini protocol paths were tested with deterministic mocked responses. Live access to every catalog model, billing/quota failures on the user's accounts, actual login after reboot, physical display disconnect/reconnect, sleep/wake, exclusive fullscreen apps and actual meeting-client capture behavior were not end-to-end tested. All-Spaces and display/sleep handling have automated configuration/code coverage, not exhaustive physical hardware coverage. No named third-party app closer was supplied. Force Quit remains possible; recovery operates afterward and can be stopped by the owner. Interrupted in-memory answers cannot be resumed automatically.

Model choices were checked against [OpenAI models](https://developers.openai.com/api/docs/models), [ChatGPT's latest API alias](https://developers.openai.com/api/docs/models/chat-latest), [Claude models](https://platform.claude.com/docs/en/models/overview) and [Gemini models](https://ai.google.dev/gemini-api/docs/models). Documentation availability does not establish account entitlement. API billing is separate from chat subscriptions.
