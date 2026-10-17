# OpenCluely termination protection assessment

Checked 16 October 2026 on the local Mac.

**2.2.0 update:** The user subsequently authorized recovery after termination. The installed Mac app now implements optional, session-controlled [automatic reopening](AUTOMATIC-REOPENING.md). The original no-restart requirement below records the earlier assessment and is no longer the current product requirement. Recovery does not change the conclusion about total immunity.

**17 October update:** Version 2.1.1 now includes opt-out protection against normal cooperative Quit requests, with a confirmed user Quit path. This narrows accidental/external normal closing; it does not change the force-termination conclusion below. See [implementation and verification](CLOSE-PROTECTION.md). The original assessment’s “no behavior changes” statement records the earlier research session only.

**Settings follow-up:** The later question narrowed the caller to hypothetical same-user software with Accessibility and no root. The [macOS settings and published-kernel audit](MACOS-SETTINGS-AUDIT.md) covers that case, including the limited `disableForceQuit` presentation option. A separate worker identity can restrict a non-root caller's direct signals, but does not make the ordinary visible overlay immune. This is distinct from the original unrestricted-root assumption below.

## Requirement and result

The requested behavior is uninterrupted execution of the existing Mac overlay, without automatic relaunch, even against hypothetical software with full host administrator/root access.

**No supported configuration can make this ordinary application totally immune to all termination.** An approved Endpoint Security system extension is the strongest relevant candidate for preventing covered signal requests. It provides a narrower guarantee than immunity to every termination path or failure of the desktop session.

## Assessment of the supplied techniques

| Technique | Meets the requirement? | Reason |
| --- | --- | --- |
| launchd KeepAlive, watchdog, login item | No | Provides startup/recovery, with an interruption after termination. |
| Root daemon or separate service account | No | Can restrict ordinary users, but does not defeat the assumed root caller; a screen overlay still needs a GUI session. |
| Ignore normal termination signals | No | Does not intercept SIGKILL. |
| Apple-style name, background mode, priority or install location | No | Does not confer Apple's private process privileges. |
| Endpoint Security authorization policy | Partial prevention | Can deny covered signal operations before delivery, including requests from privileged callers, subject to entitlement and deployment requirements. |
| Run OpenCluely inside a VM on this Mac | No | A host with the assumed authority can terminate the VM. |
| Restrict the other application to a guest VM without host control | Changes the assumption | Can remove its ability to signal host processes, but the other application no longer has full host access. |

## Strongest supported candidate

Build a separate Endpoint Security system extension and subscribe to `ES_EVENT_TYPE_AUTH_SIGNAL`. Identify OpenCluely and its required helper processes by validated code/process identity. Deny unauthorized covered termination requests while preserving deliberate user Quit, maintenance and shutdown. The SDK also exposes delegated signal instigators, which matter when another process asks launchd to act for it.

Apple documents stronger protection for an installed ES extension's own assets and launchd job. This does not automatically protect every ordinary app process; the extension needs its own carefully scoped authorization policy.

Prerequisites include Apple's restricted `com.apple.developer.endpoint-security.client` entitlement, authorized signing/provisioning, extension installation approval and Full Disk Access for a system-wide ES client. Apple approval cannot be supplied by editing an entitlement plist. Eligibility/approval for this product is not established.

The installed OpenCluely bundle is ad hoc signed. Inspection showed only JIT and local-framework library-validation entitlements; it does not carry the Endpoint Security entitlement. No extension is implemented or activated by this assessment.

The signal API is not a guarantee against every way a process or its dependencies may stop. The local SDK explicitly excludes self-signals from its signal event. App crashes, loss of WindowServer/the GUI session, system shutdown and other system-level failures remain outside an absolute uninterrupted-execution claim. macOS 27 adds deadline-miss policy controls; they do not confer general process immortality.

The macOS 27 descendants-only client still requires the restricted entitlement and receives events instigated within its process subtree. It does not cover an unrelated external process killer.

## Local checks

- Read the user-supplied research attachment and the installed Endpoint Security headers (`ESClient.h`, `ESMessage.h`, `ESTypes.h`).
- Inspected the installed OpenCluely bundle's signed entitlements.
- Ran an isolated disposable Node child process: installing a SIGKILL handler failed with `EINVAL`; a targeted SIGKILL terminated that child. No automatic restart occurred. This verifies the ordinary signal-handler boundary on this Mac, not the behavior of an ES policy.
- Did not terminate OpenCluely, change its Quit behavior, install a watchdog/daemon/extension, weaken macOS security, or modify any system service.

## Sources

- [Apple: sigaction](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/sigaction.2.html)
- [Apple: signal authorization event](https://developer.apple.com/documentation/endpointsecurity/es_event_type_auth_signal)
- [Apple: Endpoint Security entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)
- [Apple: Build an Endpoint Security app](https://developer.apple.com/videos/play/wwdc2020/10159/)
- [Apple: descendants-only ES client](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:))

**Decision:** Do not label OpenCluely unkillable or install a recovery mechanism as a substitute for the requested prevention. A scoped ES protection project needs Apple's entitlement approval and a defined, testable termination threat model. Total immunity under the stated unrestricted-host assumption is not an achievable product guarantee.
