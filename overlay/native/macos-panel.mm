// Apply activation prevention to this process's own Electron panel. Electron's
// NSPanel-style getter does not necessarily initialize the WindowServer tag.
// Research: https://github.com/akiflow/electron-panel-window/blob/master/functions_mac.mm
// Keep Electron's native class/delegate intact; do not replace the window class.
#import <AppKit/AppKit.h>
#import <objc/message.h>
#include <node_api.h>
#include <cstring>

static NSWindow *WindowFromHandle(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) {
        napi_throw_type_error(env, nullptr, "A native window handle is required.");
        return nil;
    }
    bool buffer = false;
    napi_is_buffer(env, argv[0], &buffer);
    void *bytes = nullptr;
    size_t size = 0;
    if (!buffer || napi_get_buffer_info(env, argv[0], &bytes, &size) != napi_ok || size != sizeof(void *)) {
        napi_throw_type_error(env, nullptr, "Invalid native window handle.");
        return nil;
    }
    if (![NSThread isMainThread]) {
        napi_throw_error(env, nullptr, "Panel configuration must run on the main thread.");
        return nil;
    }
    void *pointer = nullptr;
    std::memcpy(&pointer, bytes, sizeof(pointer));
    if (!pointer) {
        napi_throw_type_error(env, nullptr, "The native view is unavailable.");
        return nil;
    }
    NSView *view = (__bridge NSView *)pointer;
    if (!view.window) napi_throw_error(env, nullptr, "The native window is unavailable.");
    return view.window;
}

static void SetBoolean(napi_env env, napi_value object, const char *name, bool value) {
    napi_value item;
    napi_get_boolean(env, value, &item);
    napi_set_named_property(env, object, name, item);
}

static napi_value Describe(napi_env env, NSWindow *window) {
    napi_value result;
    napi_create_object(env, &result);
    SEL setter = NSSelectorFromString(@"_setPreventsActivation:");
    SEL getter = NSSelectorFromString(@"_preventsActivation");
    const bool available = window && [window respondsToSelector:setter] && [window respondsToSelector:getter];
    const bool prevents = available && ((BOOL (*)(id, SEL))objc_msgSend)(window, getter);
    SetBoolean(env, result, "available", available);
    SetBoolean(env, result, "preventsActivation", prevents);
    SetBoolean(env, result, "nonactivatingStyle", window && (window.styleMask & NSWindowStyleMaskNonactivatingPanel));
    SetBoolean(env, result, "focusable", window && window.canBecomeKeyWindow);
    SetBoolean(env, result, "keyWindow", window && window.isKeyWindow);
    NSString *identifier = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier ?: @"";
    napi_value frontmost;
    napi_create_string_utf8(env, identifier.UTF8String, NAPI_AUTO_LENGTH, &frontmost);
    napi_set_named_property(env, result, "frontmostApp", frontmost);
    return result;
}

static napi_value Configure(napi_env env, napi_callback_info info) {
    @try {
        NSWindow *window = WindowFromHandle(env, info);
        if (!window) return nullptr;
        SEL setter = NSSelectorFromString(@"_setPreventsActivation:");
        if ([window respondsToSelector:setter]) ((void (*)(id, SEL, BOOL))objc_msgSend)(window, setter, YES);
        return Describe(env, window);
    } @catch (NSException *exception) {
        napi_throw_error(env, nullptr, "macOS could not configure this panel's activation behavior.");
        return nullptr;
    }
}

static napi_value Inspect(napi_env env, napi_callback_info info) {
    @try {
        NSWindow *window = WindowFromHandle(env, info);
        return window ? Describe(env, window) : nullptr;
    } @catch (NSException *exception) {
        napi_throw_error(env, nullptr, "macOS could not inspect this panel's activation behavior.");
        return nullptr;
    }
}

NAPI_MODULE_INIT() {
    napi_value configure, inspect;
    napi_create_function(env, "configure", NAPI_AUTO_LENGTH, Configure, nullptr, &configure);
    napi_create_function(env, "inspect", NAPI_AUTO_LENGTH, Inspect, nullptr, &inspect);
    napi_set_named_property(env, exports, "configure", configure);
    napi_set_named_property(env, exports, "inspect", inspect);
    return exports;
}
