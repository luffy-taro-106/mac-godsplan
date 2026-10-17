# Automatic reopening in 2.2.0

The installed Mac app enables automatic reopening whenever you open OpenCluely. If its main process crashes or is force terminated, a small user-owned native helper asks macOS to open the app again. This is recovery after an interruption, not prevention of the termination.

## Owner controls

- Open Settings and turn off **Reopen automatically after a crash or Force Quit**. This takes effect immediately, independently of Save settings, including during an active answer. The app stays running and recovery stays paused for this session.
- The menu-bar **Reopen automatically** checkbox provides the same immediate control.
- **Quit OpenCluely** stops recovery first, then closes the app. Cancelling the Quit confirmation leaves both running. Use Quit to release the app's CPU and memory.
- Opening the app again enables recovery again. This also applies when explicitly reopening an already running, paused app through Finder. Merely showing the overlay with its shortcut or clicking its existing window does not reset the pause.
- The existing **Start in menu bar when I sign in** preference remains separate. Recovery does not add a login item or make the app launch at the next login when that preference is off.

No administrator account, root helper, or security extension is required. This feature is available in a packaged Mac app installed in Applications. Development and ordinary desktop tests never register the production service.

## Operation and resource use

The helper is a separate native Swift executable, supervised by a LaunchAgent in the current user's GUI domain. It watches the existing main process using Dispatch process-exit notifications and watches a private state directory for changes. It has no periodic polling timer while the app is healthy. Enabling recovery does not restart the existing app or run another Electron instance.

After termination, the first reopening attempt waits about two seconds. Repeated rapid failures back off to approximately 4, 8, 16, then 30 seconds between attempts. Attempts continue while recovery remains enabled and the app exists. LaunchServices startup waits are bounded; reopening is not guaranteed to be instantaneous. A new valid main process publishes its PID to the helper, which then resumes waiting for process-exit notifications.

The helper validates the target's UID, executable path, and observed process birth time. State is replaced atomically in a private mode-0700 directory, with mode-0600 files and a random recovery-session token. A delayed automatic launch with a paused or stale token exits before showing the interface or reading credentials. This token identifies a recovery run, not an authenticated OS-login identity or a boundary against another process with full access to the same account.

Disabling recovery writes the disabled state before unloading the helper job. The graphical app is opened by LaunchServices and is not the helper's child, so stopping the helper does not terminate the overlay. A helper crash or force kill is recovered by `KeepAlive.SuccessfulExit = false`; a deliberate clean helper exit is not repeatedly restarted. Normal user logout/shutdown disarms recovery, and the GUI job's lifetime ends with that login session.

The job's plist is stored under the app's private data, outside automatically loaded LaunchAgents directories:

```
~/Library/Application Support/OpenCluely Overlay/recovery/recovery.plist
~/Library/Application Support/OpenCluely Overlay/recovery/state.json
```

The service label is `com.opencluely.overlay.recovery`. It does not change another application's permissions or macOS security settings.

## Emergency stop

If the app cannot stay open long enough to reach Settings, run these two lines in Terminal. They invalidate the pending recovery state first, then unload only OpenCluely's recovery helper. The second command may report that the service is already absent.

```sh
rm -f "$HOME/Library/Application Support/OpenCluely Overlay/recovery/state.json"
launchctl bootout "gui/$(id -u)/com.opencluely.overlay.recovery"
```

Opening OpenCluely again enables recovery again. To uninstall permanently, stop recovery, quit the app, and remove the application bundle. Saved credentials and history need not be deleted.

## Limits

An in-flight answer, unsaved draft, and images held only in memory may be lost when the app is killed. Completed history restores only if conversation persistence was enabled and successfully saved. macOS can deny launches or stop a GUI session; a controller with sufficient authority can remove the recovery job or the app. Repeated kills can keep interrupting the overlay. Recovery does not make the app immune to force termination.

Sources: [Apple launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), [Dispatch process sources](https://developer.apple.com/documentation/dispatch/dispatchsourceprocess), [Electron activation/reopen events](https://www.electronjs.org/docs/latest/api/app#event-activate-macos).
