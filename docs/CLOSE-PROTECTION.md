# Close protection in 2.1.1

Implemented and checked on 17 October 2026 on the local Apple Silicon Mac.

Version 2.2.0 adds a separate [automatic reopening feature](AUTOMATIC-REOPENING.md). A confirmed user Quit now stops that service before exiting. The no-watchdog statements below describe the original 2.1.1 implementation.

## Behavior

**Protect against normal Quit requests** is enabled by default. Existing profiles gain the setting through default preference validation.

- A normal Quit request that reaches Electron’s `before-quit` event is cancelled before it changes shutdown state, cancels an active answer, closes the window, or unregisters shortcuts. It does not bring a hidden overlay to the foreground.
- Closing the overlay window continues to hide it. The process and any active answer stay alive.
- OpenCluely’s menu-bar/tray Quit, Command+Q on Mac, and Settings Quit share a confirmation flow. **Keep running** is the default/cancel choice. Cancelling leaves the app and active answer running. Confirming stops the app normally.
- Concurrent explicit Quit requests share one dialog. An unrelated normal Quit request during the dialog remains blocked.
- Turn protection off in Settings to restore unguarded normal Quit behavior. A dialog failure leaves protection enabled and explains how to exit.
- OS shutdown/session-end notifications permit quitting. No listener prevents the shutdown event. Fatal startup failures retain an immediate error exit instead of being trapped by the guard.

## Limits with Accessibility-controlled software

Accessibility permission allows software to interact with application interfaces. It does not identify which person or process intended a click in this confirmation flow. Authorized UI automation may operate the same Quit and confirmation controls the user can.

The guard cannot intercept `SIGKILL`, process force termination, or every OS-level exit. It does not stop an app from detecting foreground windows, enforcing its own fullscreen restrictions, or seeing OpenCluely. The third-party software and its exact close mechanism have not been provided or tested. Passing a normal-quit test is not proof of compatibility with that software.

No watchdog, relaunch service, privileged helper, process disguise, continuous refocusing, or change to another app’s permissions was introduced. Existing renderer-crash recovery remains separate from this guard.

## Verification

- **29 unit checks passed**, including protected/unprotected quitting, confirmed/cancelled quitting, concurrent requests, exception recovery, preference migration, and OS-session-end allowance.
- **16 desktop checks passed; one screen-capture check skipped** because the test app lacks Screen Recording permission.
- In a real test Electron process, a blocked Quit left a mock answer actively running, with the same process ID, history, window visibility and working IPC. Cancelling a Quit through the real renderer bridge also preserved the answer.
- A separately compiled AppKit process called `NSRunningApplication.terminate()` on its own parent test app. The request was sent; the protected app remained alive, hidden, and responsive, with its conversation preserved.
- Another temporary Electron process received an explicitly confirmed Quit through the renderer bridge and reached `will-quit` normally. This checks that users are not trapped in the protected app.
- Preference toggling and restoration in a fresh process passed. Provider/network, storage, image, renderer recovery and other existing checks also passed.
- The confirmation result was mocked during automated tests. Physical logout/reboot and the unspecified third-party lock software were not exercised.

The 2.1.1 Apple Silicon app, DMG and ZIP were built. The installed app passed strict recursive code-signature verification; the DMG and ZIP passed archive integrity checks. The previous app was closed through its own Settings Quit button before replacement. The user's encrypted credentials and conversation files were compared with the local upgrade backup and remained byte-for-byte unchanged.

The first updated launch briefly required user-side handling of a possible protected Keychain prompt; the computer-control tool cannot operate SecurityAgent. The app then opened successfully. Native UI inspection verified the restored conversation, **Key saved** status, existing 67% opacity, enabled login preference, and enabled close-protection checkbox. The actual installed-app Quit confirmation was observed with **Keep running** focused by default, followed by the app remaining open with protection enabled. The update did not require an AI request or a new provider key.

## Sources

- [Electron before-quit](https://www.electronjs.org/docs/latest/api/app#event-before-quit)
- [Apple NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication)
- [Apple Accessibility permissions](https://support.apple.com/en-in/guide/mac-help/mh43185/mac)
