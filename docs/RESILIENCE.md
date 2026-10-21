# Resilience in OpenCluely 2.3.1

Updated 20 October 2026. These changes protect saved work and improve recovery. They do not make OpenCluely immune to DoSelect, Force Quit, administrators, repeated termination, shutdown, or hardware failure. No DoSelect runtime assessment was used for validation.

## Behavior

| Event | Result |
| --- | --- |
| Close overlay window | Existing behavior: hide to the menu bar; main process keeps running. |
| Ordinary cooperative Quit | Existing normal-quit protection can decline the request. Explicit Quit from OpenCluely remains available. |
| Renderer crashes | Reload the UI within the existing retry limit. A healthy provider request continues in the main process, and the UI restores its current state. |
| Main process is killed | Its network connection and computation stop. The existing installed-Mac recovery helper can reopen it while its session remains enabled and functional. |
| Reopen after interrupted answer | With conversation restoration enabled, show the saved question and partial text as interrupted. Never send another provider request automatically. |
| Original question included an image | Show an attachment reminder. The recovery button copies the question into the composer so the owner can reattach the image before sending. |
| Disk write or file flush fails | Preserve the preceding committed file and report the save failure. Generation may continue, but unsaved work remains at risk. |
| User disables restoration or clears the current conversation | Remove its unfinished-answer checkpoint and cancel pending checkpoint writes. |
| User explicitly quits, logs out, or shuts down | Preserve existing owner controls; recovery is disarmed. Flush a pending text checkpoint when the event is received. |

## Data and resource use

The main process owns provider connections and the UI owns presentation. Renderer failures can therefore recover without another worker or Electron instance. Main-process termination still interrupts generation; moving the work to another killable process would not establish immunity to a privileged host controller.

`interrupted-work.enc` contains the submitted question, partial output, request identifier, provider/model, optional attachment name, and a hash identifying the completed conversation. It uses the same native encryption provider as saved history. It excludes API keys, image pixels, and unsent composer drafts. A context mismatch prevents restoration into a different conversation. A completed request identifier prevents duplication if termination happens after history commits but before checkpoint deletion.

Checkpoint at request start, approximately once per second while output arrives, and on completion/cancellation. There is no idle polling or new service. Under normal load this limits recent unsaved output to roughly the checkpoint interval; a blocked event loop, failed disk write, or unavailable encryption can extend that loss. Recovery uses the latest successful save. Turning off **Restore my conversation after reopening** disables checkpoint persistence.

Saves use unique exclusive temporary files, private permissions on macOS, a file flush, then atomic replacement. Failed writes do not overwrite the last committed save. Encrypted files remain encrypted in staging. Removing a saved file also removes its abandoned staging files. This is not a transactional backup system or a guarantee against power failure, storage corruption, account compromise, or root access. Images remain in memory and must be reattached after process loss.

## Verification

Local macOS checks performed on 20 October 2026:

- 52 unit/process tests passed, including failed flush/rename, an actual `SIGKILL` between staging and replacement, malformed data, checkpoint throttling, deletion, history opt-out, wrong-chat exclusion, and the history-commit race.
- 24 desktop checks passed: 22 interactive Electron checks plus a fresh-process encrypted-profile restore and confirmed Quit. Both completed history and an active provider request were checked across renderer crashes.
- `test:interruption` passed using two real Electron launches with a disposable profile and the native encryption provider. The first main process was killed with `SIGKILL` after checkpointing. The second displayed the partial answer and completed history, remained idle, required image reattachment, and deleted saved content on opt-out.
- Provider calls in these checks were mocked. No real question was sent to a provider. Only disposable test processes were terminated; DoSelect and the installed production app were not terminated or modified by these tests.

Run `npm test`, `npm run test:desktop`, and `npm run test:interruption` to repeat the checks. The host's Homebrew Node installation had a missing ICU library; these runs used the bundled working Node runtime without changing the host's Node installation.

## Build and installation

Built Apple silicon app, DMG and ZIP for 2.3.1. The packaged main process, storage module, checkpoint module and UI were compared byte-for-byte with the tested source. Deep strict code-signature verification and DMG checksum verification passed. This is an ad-hoc-signed local development build, without Apple notarization.

- Installer: `dist/OpenCluely-Overlay-2.3.1-mac-arm64.dmg`
- ZIP: `dist/OpenCluely-Overlay-2.3.1-mac-arm64.zip`
- DMG SHA-256: `a49783b61fb3d30d7efe6ca56a54c0688172ac460af40e0fbf18b9b5a8b34b06`
- ZIP SHA-256: `4c354882decb76af18516c23f98b92c8c18dd2dd0ed94a0375ca6377f145500b`

Installed 2.3.1 into `/Applications/OpenCluely Overlay.app` on 20 October 2026 after the owner authorized quitting the running 2.3.0 copy. Quit through the app's own confirmation, verified its recovery helper stopped, replaced the bundle, and reopened it. Verified installed source/version, the running app and recovery job, enabled conversation restoration and normal-quit protection, and unchanged saved credential/history files. The UI currently reports Screen Recording permission is not enabled; no privacy permissions were changed.

The previous app, saved-data snapshot, and installation record are preserved in `/Users/luffy_sama/Desktop/Workspace/Systum/backups/opencluely-2026-10-20-486bf959`. Keep **Restore my conversation after reopening** enabled to use encrypted checkpoints. The existing API keys and saved history use the same profile format/location.

## Remaining boundary

[Apple documents that SIGKILL cannot be blocked](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/sigaction.2.html). Automatic reopening requires the helper, its launchd job, the application, a working GUI login session, and sufficient machine resources. A controller that can repeatedly terminate the app or disable its supervisor can still prevent useful work. Recovery cannot make a closed assessment permit an additional application.

The implementation does not add root helpers, kernel changes, process impersonation, or interception of DoSelect. It does not change capture behavior or claim invisibility. For simultaneous use in a restricted assessment, compatibility needs approval and configuration from the assessment organizer/vendor; these local tests do not establish it.

References: [Electron native storage](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron renderer process events](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone), and [existing recovery design](AUTOMATIC-REOPENING.md).
