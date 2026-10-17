# Automatic reopening verification

Recovery introduced in 2.2.0 and rechecked with 2.3.0 on 17 October 2026 on the local Apple Silicon Mac running macOS 27.0 (26A428). See the complete [2.3 verification report](E2E-VERIFICATION.md).

## Completed checks

- **44 unit checks passed**, including private state, ordinary/recovery launch handling, session pause, stale-token rejection, registration failure cleanup, asynchronous Quit cleanup, and shutdown races during pending launchctl operations.
- **21 desktop scenarios and two fresh-process checks passed**, with no skipped screenshot check in the final run. The recovery control was exercised through real IPC while a mock AI answer remained active. Pausing did not cancel it, recovery state was not saved as a permanent preference, invalid IPC input was rejected, and explicit app reopening re-enabled recovery. Existing storage, provider, renderer recovery, normal Quit, and confirmed Quit checks also passed.
- **Three native helper checks passed**, including actual disposable-GUI SIGKILL/recovery cycles, private-file/session validation, process identity lookup, and disabling recovery while leaving the GUI alive.
- **The real launchd integration check passed** with a unique temporary job and disposable app. It preserves the original GUI PID on registration, recovers a killed helper, recovers two genuinely killed GUI instances, unloads without closing the live GUI, leaves a subsequently killed GUI stopped while paused, enables again after a manual open, and stays stopped after intentional Quit cleanup. The test verifies process ownership and executable path before killing its own fixtures and waits for their termination.

The integration work caught and corrected races involving pending LaunchServices clients, rapid second-process death, and shutdown during arming. The fixture publishes a private file before atomic rename and does not mutate signed resources after signing. Teardown includes any pending LaunchServices fixture process and verifies none remains before deleting its bundle.

A launchd helper executed directly from a Desktop checkout was blocked in dyld before reaching application code. The integration fixture now runs a signed copy from private temporary storage. The production helper is unpacked inside the installed application under `/Applications`; development builds do not register recovery. No macOS privacy permission was weakened to make the test run.

Automated provider requests use mocks and temporary profiles. Automated process-termination tests use disposable fixtures. Separate installed-app verification below includes the production recovery service and one real main-process termination; the broader 2.3 check also includes a short live Claude request.

## Build

The Apple Silicon app, DMG, and ZIP were built. The app and unpacked helper passed strict signature verification, and the packaged helper's process-event probe succeeded. The final DMG and ZIP integrity checks were run. Current artifact hashes are saved in `dist/MACOS-2.3.0-SHA256SUMS.txt`; the earlier 2.2 hashes remain available separately.

Packaging reused the locally installed Electron 44.7.0 distribution after a redundant network download stalled. The runtime version and dependencies were unchanged. The local app is ad hoc signed; no notarization is claimed.

## Installed-app verification

After the user unlocked the Mac, 2.2.0 was installed and checked. Its encrypted key and conversation matched the pre-upgrade backup. Turning recovery off immediately unloaded the helper while the app stayed alive. Explicitly opening the installed app rearmed it. A verified main-process SIGKILL replaced PID 28752 with PID 29197 and restored completed saved state. A deliberate Settings Quit stopped the app and unloaded recovery before the next upgrade.

The installed app is now **2.3.0**. It restored the existing conversation and key, enables recovery when opened, and its intentional Quit again stopped both app and helper during the screen-permission restart. Recovery code is unchanged from 2.2.

Physical logout/reboot and the unspecified third-party app closer have not been tested. Reopening restores completed saved state, not an interrupted in-memory AI stream. See [owner controls and limits](AUTOMATIC-REOPENING.md).
