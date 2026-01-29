import Foundation
import AVFoundation

// The Gloaming - Native Audio Service
// Provides true gapless playback via AVQueuePlayer
// Communicates with Electron via JSON over stdin/stdout

// Create the audio engine
let audioEngine = AudioEngine()

// Buffer for incomplete lines from stdin
var inputBuffer = ""

// Set up stdin reading using DispatchSource
let stdinSource = DispatchSource.makeReadSource(
    fileDescriptor: FileHandle.standardInput.fileDescriptor,
    queue: .main
)

stdinSource.setEventHandler {
    let data = FileHandle.standardInput.availableData

    // Empty data means EOF - parent closed stdin
    guard !data.isEmpty else {
        exit(0)
    }

    guard let str = String(data: data, encoding: .utf8) else {
        return
    }

    inputBuffer += str

    // Process complete lines (newline-delimited JSON)
    while let newlineIndex = inputBuffer.firstIndex(of: "\n") {
        let line = String(inputBuffer[..<newlineIndex])
        inputBuffer = String(inputBuffer[inputBuffer.index(after: newlineIndex)...])

        if !line.isEmpty {
            processCommand(line, engine: audioEngine)
        }
    }
}

stdinSource.setCancelHandler {
    exit(0)
}

stdinSource.resume()

// Signal that we're ready
sendEvent(["event": "ready"])

// Keep the process alive with RunLoop
RunLoop.main.run()
