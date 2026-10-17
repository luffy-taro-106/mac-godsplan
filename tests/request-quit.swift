import AppKit
import Darwin

// This fixture can request a normal quit only of the Electron parent that spawned it.
guard CommandLine.arguments.count == 2,
      let target = Int32(CommandLine.arguments[1]), target == getppid(),
      let app = NSRunningApplication(processIdentifier: target) else {
    fputs("Quit fixture requires its own application parent\n", stderr)
    exit(2)
}
guard app.terminate() else {
    fputs("Native quit request could not be sent\n", stderr)
    exit(1)
}
print("Normal native quit request sent")
