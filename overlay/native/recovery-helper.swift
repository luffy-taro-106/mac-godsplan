// A per-session, user-owned supervisor. launchd supervises this helper; this
// helper watches the GUI process without adopting it as a child process.
import Foundation
import Dispatch
import Darwin

private struct RecoveryState: Decodable {
    let version: Int
    let sessionId: String
    let enabled: Bool
    let pid: Int32
    let executablePath: String
    let appPath: String
}

private struct ProcessIdentity: Equatable, Codable {
    let pid: Int32
    let executablePath: String
    let startSeconds: UInt64
    let startMicroseconds: UInt64
}

private func canonicalPath(_ path: String) -> String {
    URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
}

private func processIdentity(_ pid: Int32) -> ProcessIdentity? {
    guard pid > 1 else { return nil }
    var info = proc_bsdinfo()
    let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    guard count == Int32(MemoryLayout<proc_bsdinfo>.size), info.pbi_uid == getuid(), info.pbi_status != UInt32(SZOMB) else { return nil }
    // PROC_PIDPATHINFO_MAXSIZE is an arithmetic C macro not imported by Swift.
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return ProcessIdentity(pid: pid, executablePath: canonicalPath(String(cString: buffer)),
                           startSeconds: info.pbi_start_tvsec, startMicroseconds: info.pbi_start_tvusec)
}

private func diagnostic(_ message: String) {
    // Do not log profile contents, provider credentials, or conversation text.
    fputs("OpenCluely recovery: \(message)\n", stderr)
}

private let debugEnabled = ProcessInfo.processInfo.environment["OPENCLUELY_RECOVERY_DEBUG"] == "1"
private let reopenDelaySeconds: TimeInterval = 60
private func debug(_ message: String) {
    if debugEnabled { diagnostic("debug: " + message) }
}

private final class RecoverySupervisor {
    private let statePath: String
    private let sessionId: String
    private let queue = DispatchQueue(label: "com.opencluely.overlay.recovery")
    private var directorySource: DispatchSourceFileSystemObject?
    private var processSource: DispatchSourceProcess?
    private var watchedIdentity: ProcessIdentity?
    private var retryTimer: DispatchSourceTimer?
    private var handshakeTimer: DispatchSourceTimer?
    private var launcher: Process?
    private var exiting = false

    init(statePath: String, sessionId: String) {
        self.statePath = statePath
        self.sessionId = sessionId
    }

    func run() -> Never {
        queue.async { self.start() }
        // Every event handler captures weakly to avoid source retain cycles.
        // Explicitly retain the supervisor for the event loop's entire lifetime;
        // optimized builds may otherwise release the temporary after start().
        withExtendedLifetime(self) { dispatchMain() }
    }

    private func start() {
        debug("started pid \(getpid())")
        let directoryPath = URL(fileURLWithPath: statePath).deletingLastPathComponent().path
        let fd = open(directoryPath, O_EVTONLY | O_NOFOLLOW)
        var info = stat()
        guard fd >= 0, fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else {
            if fd >= 0 { close(fd) }
            finish("private recovery directory unavailable")
        }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd,
            eventMask: [.write, .rename, .delete, .revoke], queue: queue)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            debug("state directory event")
            if !source.data.intersection([.rename, .delete, .revoke]).isEmpty {
                self.finish("recovery directory removed")
            }
            self.reconcile()
        }
        source.setCancelHandler { close(fd) }
        directorySource = source
        source.resume()
        reconcile()
    }

    private func readState() -> RecoveryState? {
        let fd = open(statePath, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_uid == getuid(), (info.st_mode & 0o077) == 0,
              info.st_size > 0, info.st_size <= 32768 else { return nil }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        guard let data = try? handle.readToEnd(),
              let state = try? JSONDecoder().decode(RecoveryState.self, from: data),
              state.version == 1, state.sessionId == sessionId, state.enabled,
              state.executablePath.hasPrefix("/"), state.appPath.hasPrefix("/"),
              state.appPath.hasSuffix(".app") else { return nil }
        let executable = canonicalPath(state.executablePath)
        let app = canonicalPath(state.appPath)
        guard executable.hasPrefix(app + "/Contents/MacOS/") else { return nil }
        return state
    }

    private func matchingIdentity(_ state: RecoveryState) -> ProcessIdentity? {
        guard let identity = processIdentity(state.pid),
              identity.executablePath == canonicalPath(state.executablePath) else { return nil }
        return identity
    }

    private func reconcile() {
        guard !exiting else { return }
        guard let state = readState() else { finish("recovery disabled or session ended") }
        guard FileManager.default.isExecutableFile(atPath: state.executablePath),
              FileManager.default.fileExists(atPath: state.appPath) else { finish("application unavailable") }
        if let identity = matchingIdentity(state) {
            retryTimer?.cancel()
            retryTimer = nil
            // Keep the startup deadline while `open` is still pending. The GUI
            // may die immediately after this PID update, leaving an open client
            // waiting for an application that will never finish starting.
            if launcher == nil {
                handshakeTimer?.cancel()
                handshakeTimer = nil
            }
            if identity != watchedIdentity { watch(identity) }
            return
        }
        // An open request stays pending until the replacement GUI publishes its
        // PID, or the handshake deadline expires. Directory events cannot cause
        // duplicate opens during that interval.
        guard launcher == nil, handshakeTimer == nil, retryTimer == nil else { return }
        scheduleRetry()
    }

    private func watch(_ identity: ProcessIdentity) {
        debug("watching GUI pid \(identity.pid)")
        processSource?.cancel()
        processSource = nil
        watchedIdentity = identity
        let source = DispatchSource.makeProcessSource(identifier: identity.pid, eventMask: .exit, queue: queue)
        source.setEventHandler { [weak self] in
            guard let self, self.watchedIdentity == identity else { return }
            debug("GUI exit event pid \(identity.pid)")
            self.watchedIdentity = nil
            self.processSource?.cancel()
            self.processSource = nil
            self.reconcile()
        }
        processSource = source
        source.resume()
        // Cover exit/PID reuse between the initial lookup and attaching kqueue.
        if processIdentity(identity.pid) != identity {
            source.cancel()
            processSource = nil
            watchedIdentity = nil
            reconcile()
        }
    }

    private func scheduleRetry() {
        guard retryTimer == nil, handshakeTimer == nil, launcher == nil else { return }
        // Wait a full minute after each exit, including repeated startup failures.
        let delay = reopenDelaySeconds
        debug("retry scheduled in \(delay) seconds")
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + delay, leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.retryTimer?.cancel()
            self.retryTimer = nil
            self.reopen()
        }
        retryTimer = timer
        timer.resume()
    }

    private func reopen() {
        debug("launch timer fired")
        // A stop/session change written while the timer was waiting always wins.
        guard let state = readState() else { finish("recovery disabled before launch") }
        if let identity = matchingIdentity(state) { watch(identity); return }
        guard FileManager.default.isExecutableFile(atPath: state.executablePath),
              FileManager.default.fileExists(atPath: state.appPath) else { finish("application unavailable") }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        task.arguments = ["-g", "-a", state.appPath, "--args", "--opencluely-recovery", sessionId]
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        task.terminationHandler = { [weak self] finished in
            guard let self else { return }
            self.queue.async {
                guard !self.exiting, self.launcher === finished else { return }
                self.launcher = nil
                if finished.terminationStatus != 0 {
                    diagnostic("launch client exited with status \(finished.terminationStatus); retrying in one minute")
                    self.handshakeTimer?.cancel()
                    self.handshakeTimer = nil
                }
                // A replacement can publish its PID and exit before `open`
                // completes. Its exit handler waits for launcher, so clearing
                // launcher must reconcile after successful opens as well.
                self.reconcile()
            }
        }
        launcher = task
        do {
            debug("requesting GUI launch")
            try task.run()
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 10, leeway: .milliseconds(250))
            timer.setEventHandler { [weak self] in
                guard let self else { return }
                self.handshakeTimer?.cancel()
                self.handshakeTimer = nil
                // LaunchServices can keep its `open` client waiting if the GUI
                // dies during startup. Bound that wait as well as the PID
                // handshake, otherwise launcher would prevent future retries.
                if let pending = self.launcher {
                    self.launcher = nil
                    if pending.isRunning { pending.terminate() }
                }
                self.reconcile()
            }
            handshakeTimer = timer
            timer.resume()
        } catch {
            launcher = nil
            diagnostic("launch failed; retrying in one minute")
            reconcile()
        }
    }

    private func finish(_ reason: String) -> Never {
        exiting = true
        retryTimer?.cancel()
        handshakeTimer?.cancel()
        processSource?.cancel()
        directorySource?.cancel()
        if let pending = launcher, pending.isRunning { pending.terminate() }
        diagnostic(reason)
        // Exit 0 deliberately: KeepAlive.SuccessfulExit=false must not resurrect
        // a helper whose session has been explicitly disarmed.
        exit(0)
    }
}

private let args = Array(CommandLine.arguments.dropFirst())
if args == ["--probe"] {
    print("{\"version\":1,\"platform\":\"darwin\",\"processEvents\":true,\"reopenDelaySeconds\":\(Int(reopenDelaySeconds))}")
} else if args.count == 2, args[0] == "--process-identity", let pid = Int32(args[1]),
          let identity = processIdentity(pid), let data = try? JSONEncoder().encode(identity),
          let json = String(data: data, encoding: .utf8) {
    print(json)
} else if args.count == 4, args[0] == "--state", args[2] == "--session",
          args[1].hasPrefix("/"), UUID(uuidString: args[3]) != nil {
    RecoverySupervisor(statePath: args[1], sessionId: args[3]).run()
} else {
    diagnostic("invalid arguments")
    exit(0)
}
