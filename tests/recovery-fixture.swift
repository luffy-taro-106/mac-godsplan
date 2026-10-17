// Disposable process used by recovery integration tests. It has no provider
// credentials, screen capture, user profile, or production application state.
import AppKit
import Foundation
import Darwin

struct FixtureConfig: Decodable {
    let statePath: String
    let sessionId: String
    let eventPath: String
}
struct State: Codable {
    let version: Int
    let sessionId: String
    let enabled: Bool
    let pid: Int32
    let executablePath: String
    let appPath: String
}
let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let configURL = bundle.appendingPathComponent("Contents/Resources/fixture-config.json")
guard let configData = try? Data(contentsOf: configURL),
      let config = try? JSONDecoder().decode(FixtureConfig.self, from: configData) else { exit(2) }
let arguments = Array(CommandLine.arguments.dropFirst())
let recovered = arguments.first == "--opencluely-recovery"
var sessionId = config.sessionId
if recovered {
    guard arguments.count == 2,
          let data = try? Data(contentsOf: URL(fileURLWithPath: config.statePath)),
          let old = try? JSONDecoder().decode(State.self, from: data),
          old.enabled, old.sessionId == arguments[1] else { exit(0) }
    sessionId = arguments[1]
}
final class FixtureDelegate: NSObject, NSApplicationDelegate {
    let config: FixtureConfig
    init(config: FixtureConfig) { self.config = config }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Finish the LaunchServices startup handshake before publishing readiness.
        // Killing inside this callback can make LaunchServices retry the initial
        // launch, independently of the recovery service under test.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.publishReady() }
    }
    private func publishReady() {
        if recovered {
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: config.statePath)),
                  let current = try? JSONDecoder().decode(State.self, from: data),
                  current.enabled, current.sessionId == sessionId else { exit(0) }
        }
        let state = State(version: 1, sessionId: sessionId, enabled: true,
                          pid: getpid(), executablePath: executable.path, appPath: bundle.path)
        do {
            let data = try JSONEncoder().encode(state)
            // The new file must already be private when it appears at statePath. A
            // post-rename chmod creates a race with the supervisor's directory event.
            let temporary = config.statePath + "." + UUID().uuidString + ".tmp"
            let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL, 0o600)
            guard fd >= 0 else { exit(3) }
            let stateHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            try stateHandle.write(contentsOf: data)
            try stateHandle.close()
            guard rename(temporary, config.statePath) == 0 else { unlink(temporary); exit(3) }
            let event: [String: Any] = ["kind": "started", "pid": getpid(),
                                       "sessionId": sessionId, "recovered": recovered]
            var eventData = try JSONSerialization.data(withJSONObject: event)
            eventData.append(0x0a)
            if !FileManager.default.fileExists(atPath: config.eventPath) {
                FileManager.default.createFile(atPath: config.eventPath, contents: nil,
                                              attributes: [.posixPermissions: 0o600])
            }
            let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: config.eventPath))
            try handle.seekToEnd()
            try handle.write(contentsOf: eventData)
            try handle.close()
        } catch { exit(3) }
    }
}
let app = NSApplication.shared
let delegate = FixtureDelegate(config: config)
app.delegate = delegate
app.setActivationPolicy(.accessory)
// Test cleanup represents an intentional owner Quit, so finish AppKit's
// LaunchServices lifecycle rather than leaving its registration half-open.
signal(SIGTERM, SIG_IGN)
let quitSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
quitSignal.setEventHandler { app.terminate(nil) }
quitSignal.resume()
app.run()
