# Windows startup and shortcuts

For macOS startup, menu-bar controls, and shortcuts, see [Mac setup](MACOS.md). This page records the original Windows behavior and verification.

Install the Windows setup executable from Releases, open Settings, and enable **Start in tray when I sign in**. The app registers `com.opencluely.overlay` under the current user's Windows startup entries, pointing to the installed executable with `--background`.

The default executable location is `%LOCALAPPDATA%\Programs\OpenCluely Overlay\OpenCluely Overlay.exe`. Source and portable builds disable startup registration because their paths may be temporary.

After restarting the computer, sign in to Windows and allow startup applications to load. **Ctrl+Alt+Space** then shows or hides the overlay. **Ctrl+Alt+I** toggles click-through, and **Ctrl+Alt+S** captures a screenshot for preview. If a shortcut conflicts with another app, use the tray menu and check the warning in Settings.

Closing or hiding the overlay keeps it running in the tray. Quit explicitly from Settings or the tray. Windows shutdown, sign-out, Task Manager, or a process crash can stop it. Nothing runs while the laptop is off.

Keys and optional saved conversation text restore from `%APPDATA%\OpenCluely Overlay`. Preserve this entire profile when moving or upgrading the app; do not commit it to Git or share it.

On the development machine, the installed startup command and enabled status were checked, and the user confirmed the physical shortcut opened the overlay. A full reboot was not performed during that verification.

Programmatic startup checks need to account for [Electron's Windows lookup issue for paths containing spaces](https://releases.electronjs.org/pr/54364). The actual startup command must quote the executable path.
