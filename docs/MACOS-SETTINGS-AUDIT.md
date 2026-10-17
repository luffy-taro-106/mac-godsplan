# macOS settings and Force Quit audit

Checked 17 October 2026 on macOS 27.0 (26A428), Apple Silicon.

**Later 2.2.0 update:** The user subsequently requested automatic reopening with an owner-controlled pause. That separate [recovery feature](AUTOMATIC-REOPENING.md) is now implemented. References below to excluding restart describe the earlier audit requirement, not the current feature selection.

## Result and scope

**No supported per-app macOS setting was found that makes the existing OpenCluely overlay immune to force termination.** The installed version 2.1.1 protects cooperative Quit requests; it cannot veto an allowed force kill. Automatic restart is outside the requested solution.

The latest threat described is hypothetical software running under the same login account, without root, with Accessibility permission. Its implementation has not been supplied or tested. Accessibility UI control and direct process termination are separate paths: removing UI permission does not remove ordinary same-user signal permissions.

This audit covered Apple's published XNU signal implementation, installed SDK headers/manuals, process and application presentation controls, launchd options, privilege separation, and Apple's security/deployment documentation. It is not a review of all private macOS source or the exact kernel source for this installed build. The published XNU snapshot reviewed is commit `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea` (`xnu-12377.1.9`).

## What the kernel permits

The published `cansignal()` path checks mandatory security policy before ordinary process credentials. Its ordinary credentials check permits matching user identities; root is not required for another process under the same account to send a signal. `sigaction()` rejects installing handlers for `SIGKILL` and `SIGSTOP`. No target-app immunity preference appears in this examined path. An ordinary application cannot catch `SIGKILL` to veto it. [Signal permission implementation](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sig.c#L283), [handler restriction](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sig.c#L413), [Apple kill manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html).

Special system-process treatment in broadcast/group signalling is not immunity from individually targeted termination. Code-signing flags such as `CS_KILL`, `CS_RESTRICT`, and `CS_RUNTIME` concern code validity, dynamic linking, and runtime policies; they are not a configurable denial of termination. [Broadcast/group code](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sig.c#L1536), [signing flag definitions](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/cs_blobs.h#L33).

## Controls that sound relevant

| Control | Actual effect and limit |
| --- | --- |
| AppKit `disableForceQuit` | Disables the Command–Option–Escape panel while the declaring app is active, with required Dock presentation options. It does not deny another process's termination APIs. Another foreground app determines the active presentation policy, so this cannot protect the background overlay while the lock app is active. |
| `disableSuddenTermination` / `disableAutomaticTermination` | Control eligibility for system-managed termination optimizations. They do not intercept another process's force kill. |
| launchd `KeepAlive` | Restarts an exited job. This is recovery, which the user explicitly excluded. |
| launchd transactions, pressured exit, process type | Affect launchd's own stop behavior, memory reclamation, or resource policy. They do not grant immunity from another permitted caller. |
| SIP, authenticated root, Hardened Runtime | Protect designated OS components or code integrity. There is no supported preference to add OpenCluely to Apple's protected system processes. Disabling these protections does not add immunity. |
| Kiosk / assessment modes | Restrict an entire session and require the corresponding managed deployment or entitlement. They are not a per-app immunity switch preserving normal overlay operation alongside another application. |

Sources: [AppKit flag](https://developer.apple.com/documentation/appkit/nsapplication/presentationoptions-swift.struct/disableforcequit), [active-app scope](https://developer.apple.com/documentation/appkit/nsapplication/presentationoptions-swift.property), [required option combinations](https://developer.apple.com/documentation/appkit/nsapplication/presentationoptions-swift.struct), [sudden termination](https://developer.apple.com/documentation/foundation/processinfo/disablesuddentermination()), [launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), [SIP](https://support.apple.com/en-us/102149), [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime), [Mac Autonomous Single App Mode](https://support.apple.com/guide/deployment/autonomous-single-app-mode-payload-settings-dep8a42c4c4a/web), [assessment entitlement](https://developer.apple.com/documentation/automaticassessmentconfiguration/preparing-an-educational-assessment-app-for-distribution).

## What can prevent a particular caller

- **Controller permission or configuration:** revoking the other application's Accessibility permission prevents its Accessibility-based UI control. An explicit allowed-app setting in that application may also solve its particular closing behavior, if it offers one. Neither gives OpenCluely general immunity. A same-user application that directly sends permitted signals does not need Accessibility for that path. [Apple Accessibility permissions](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac).
- **Separate process identity:** a correctly designed worker running under a different account can resist direct signals from an unprivileged user whose credentials do not match. Root-owning the executable file alone does not change the running identity. This can protect backend work, but a supported system daemon has no WindowServer access and cannot present the overlay. A normal per-user graphical component remains separately terminable. Apple advises against running GUI code as root. This is an architectural change with privacy, Keychain, IPC authentication, and user-controlled shutdown requirements, not a preferences toggle. [Signal permissions](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html), [daemon/agent separation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html), [Apple guidance on privileged GUI code](https://developer.apple.com/forums/thread/708765).
- **Approved security authorization:** an appropriately provisioned Endpoint Security client can deny covered signal requests before delivery. This requires Apple's restricted entitlement and a separate security component; it is not an available system preference or a guarantee against all termination paths. See the [earlier Endpoint Security assessment](PROCESS-PROTECTION.md).

## Local evidence and changes

SIP and authenticated root were both enabled. OpenCluely remained ad hoc signed with its existing JIT and library-validation exceptions, without the restricted Endpoint Security entitlement. The installed AppKit header describes `NSApplicationPresentationDisableForceQuit` specifically as disabling the keyboard-invoked panel. Installed Foundation headers and `kill(2)`, `sigaction(2)`, and `launchd.plist(5)` manuals corroborate the boundaries above.

Read-only inspection also examined relevant process/security sysctl names and descriptions. A name containing “app protection” or “kill” is not evidence of a per-app immunity mechanism; no such switch was established.

**This audit changed documentation only.** No sysctl/defaults writes, permission changes, security disabling, new accounts, privileged helpers, services, watchdogs, or app termination tests were performed in this settings audit. The existing [normal Quit guard and its verification](CLOSE-PROTECTION.md) remain unchanged. The earlier isolated SIGKILL probe is recorded separately in the process-protection assessment.

## Spotlight comparison on this Mac

A subsequent read-only comparison inspected the installed Spotlight/search launch configurations, running process identities, application attributes, and code signatures. Continued availability of search is not evidence that one particular GUI process never exits.

- `/System/Library/LaunchAgents/com.apple.Spotlight.plist` configures launch-on-demand Mach services and `KeepAlive` with `AfterInitialDemand = true` and `SuccessfulExit = false`. On this particular macOS 27 build, that legacy job was not loaded. Its configuration includes a conditional disabling rule for the Campo feature; it must not be presented as the currently running UI job.
- `/System/Library/LaunchAgents/com.apple.campo.plist` points to `/System/Applications/Siri AI.app`. The job was running in the user GUI session. Its configuration also contains `KeepAlive` with `AfterInitialDemand = true` and `SuccessfulExit = false`. This establishes a configured recovery mechanism, not immunity to termination. [Apple launchd behavior](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).
- The metadata backend `mds` was running under UID 0, while `mds_stores` used UID 308 and `corespotlightd` used the logged-in user's UID 501. Its system daemon configuration sets `KeepAlive = true` and `RunAtLoad = true`. Different identities can restrict ordinary direct signals; they do not make the entire graphical search system a single unkillable process.
- The legacy Spotlight app, active Campo app, and installed OpenCluely all have `LSUIElement = true`. OpenCluely already uses the no-Dock application presentation characteristic; copying it again would not add termination protection.
- The active Campo application and `mds` have Apple OS signatures. Campo also has private Apple entitlements, including RunningBoard and protected-storage access. Reading those declarations does not establish an entitlement that grants general kill immunity. OpenCluely cannot acquire Apple's signature and private OS authority by copying a bundle identifier or entitlement text. [Apple's description of protected system components](https://support.apple.com/en-us/102149).

The reusable design is separation of backend work from a small user interface, with authenticated communication between them. That can preserve backend work when the interface stops; a system daemon itself cannot display the overlay. [Apple daemon/GUI separation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html). Spotlight's configured recovery is a separate feature excluded by the user's requirement against restarting after a kill. Public [Core Spotlight APIs](https://developer.apple.com/documentation/corespotlight) provide search indexing and queries, not transfer of Spotlight's system privileges to an arbitrary overlay.

No Spotlight component was terminated, reconfigured, or modified. No OpenCluely runtime behavior changed in this comparison. Whether a particular third-party closer deliberately excludes Apple components remains untested because that software is hypothetical.
