# An interactive panel without a mode switch

The Mac overlay accepts clicks, typing, provider/model choices, and scrolling directly. There is no Read/Type control. Normal opening, the show/hide shortcut, and screenshot restoration use `showInactive()` so merely showing the overlay does not request keyboard focus. Clicking its inputs lets macOS direct keyboard input to the panel.

## Native activation prevention

The window uses Electron's `type: 'panel'` and `acceptFirstMouse: true`. A small Node-API module applies activation prevention to that same native window. It does not change Electron's Objective-C window class or replace its delegates. Click-through remains a separate mouse-passthrough feature.

The native module checks for `_setPreventsActivation:` and `_preventsActivation` before using them. Successful verification requires both selectors and a positive activation-prevention result. These are private AppKit selectors, so their availability and behavior can change in future macOS releases. If native support cannot load or activation prevention is unavailable, the app reports a warning in Settings rather than claiming that the browser is protected.

No global keyboard monitor, event tap, browser extension, website injection, or extra Accessibility/Input Monitoring permission is used. Only the overlay's own window is configured. The diagnostic state can report the native activation flag and the frontmost application identifier; it is not sent to AI providers.

## What the research establishes

- [Apple's key-window guide](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/WinPanel/Concepts/ChangingMainKeyWindow.html) distinguishes the active application from the key window receiving keyboard input.
- [Electron's macOS panel implementation](https://github.com/electron/electron/blob/v44.7.0/shell/browser/ui/cocoa/electron_ns_panel.mm) supplies the nonactivating style mask. Its [show/focus implementation](https://github.com/electron/electron/blob/v44.7.0/shell/browser/native_window_mac.mm) avoids explicit application activation for panels.
- [Akiflow's panel implementation](https://github.com/akiflow/electron-panel-window/blob/master/functions_mac.mm) documents a missing native activation-prevention tag when a window only reports the panel style. It supplies the specific activation flag used here. Its broader class-swapping implementation is not included.
- The older [Abstract panel library](https://github.com/goabstract/electron-panel-window) implements the same general panel pattern but is archived.

Keeping the browser application active is different from proving that a website cannot observe any input or focus change. Native dialogs, pointer lock, fullscreen transitions, leaving a game's canvas, or a site's own rules can still affect it. Browser tests measure particular real behaviors; they do not establish universal undetectability. There is no supported macOS API that guarantees that every website will remain unaware of all overlay interaction.

## Building

Mac builds compile `overlay/native/macos-panel.mm` using Clang and Node-API headers. The build script checks the current Node installation, standard Homebrew/Node include paths, and the local node-gyp cache. Set `OPENCLUELY_NODE_HEADERS` to an `include/node` folder if headers are installed elsewhere. The Node-API addon uses ABI-stable APIs and is packaged unpacked for arm64 or x64. Only current arm64 hardware is exercised locally; x64 is cross-compiled.
