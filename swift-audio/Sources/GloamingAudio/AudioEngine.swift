import Foundation
import AVFoundation

/// Native audio engine using AVQueuePlayer for true gapless playback.
/// Communicates with Electron via JSON over stdin/stdout.
class AudioEngine {
    private var player: AVQueuePlayer
    private var currentItem: AVPlayerItem?
    private var preloadedItem: AVPlayerItem?
    private var currentTrackId: String?
    private var preloadedTrackId: String?
    private var timeObserver: Any?

    // Store duration when loaded (asset.duration can be unreliable during playback)
    private var currentDuration: Double = 0
    private var preloadedDuration: Double = 0

    // Track item-to-id mapping for end notifications
    private var itemToTrackId: [AVPlayerItem: String] = [:]

    // Track file paths for spectrum analyzer
    private var currentFilePath: String?
    private var preloadedFilePath: String?

    // Spectrum analyzer - separate from playback ("two readers, one score")
    private let spectrumAnalyzer = SpectrumAnalyzer()

    init() {
        player = AVQueuePlayer()
        // Allow longer buffer for smoother gapless transitions
        player.automaticallyWaitsToMinimizeStalling = true
        setupObservers()
    }

    deinit {
        if let observer = timeObserver {
            player.removeTimeObserver(observer)
        }
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Commands

    func load(id: String, path: String) {
        let url = URL(fileURLWithPath: path)

        fputs("[Swift] LOAD called: \(id) | path: \(path)\n", stderr)
        fputs("[Swift] LOAD - clearing preloaded state (preloadedTrackId was: \(preloadedTrackId ?? "nil"))\n", stderr)

        // Verify file exists
        guard FileManager.default.fileExists(atPath: path) else {
            sendEvent([
                "event": "error",
                "message": "File not found",
                "path": path
            ])
            return
        }

        let item = AVPlayerItem(url: url)
        // Set preferred buffer duration for smooth playback
        item.preferredForwardBufferDuration = 10  // 10 seconds ahead

        // Clear previous state
        player.removeAllItems()
        itemToTrackId.removeAll()
        preloadedItem = nil
        preloadedTrackId = nil
        preloadedDuration = 0

        currentTrackId = id
        currentItem = item
        currentFilePath = path
        itemToTrackId[item] = id

        // Open file for spectrum analysis (separate reader)
        spectrumAnalyzer.openFile(path: path)

        player.insert(item, after: nil)

        // Wait for duration to be available
        item.asset.loadValuesAsynchronously(forKeys: ["duration"]) { [weak self] in
            DispatchQueue.main.async {
                var error: NSError?
                let status = item.asset.statusOfValue(forKey: "duration", error: &error)

                if status == .loaded {
                    let duration = item.asset.duration.seconds
                    let safeDuration = duration.isNaN ? 0 : duration
                    self?.currentDuration = safeDuration
                    sendEvent([
                        "event": "loaded",
                        "id": id,
                        "duration": safeDuration
                    ])
                } else {
                    sendEvent([
                        "event": "error",
                        "message": error?.localizedDescription ?? "Failed to load duration",
                        "path": path
                    ])
                }
            }
        }
    }

    func preload(id: String, path: String) {
        let url = URL(fileURLWithPath: path)

        fputs("[Swift] Preload called: \(id) | path: \(path)\n", stderr)

        // Verify file exists
        guard FileManager.default.fileExists(atPath: path) else {
            sendEvent([
                "event": "error",
                "message": "File not found for preload",
                "path": path
            ])
            return
        }

        let item = AVPlayerItem(url: url)
        // Set preferred buffer duration - critical for gapless transitions
        item.preferredForwardBufferDuration = 30  // Buffer entire short tracks

        preloadedTrackId = id
        preloadedItem = item
        preloadedFilePath = path
        itemToTrackId[item] = id

        // Insert after current item for gapless playback
        if let current = currentItem {
            player.insert(item, after: current)
            fputs("[Swift] Inserted item into queue after current. Queue count: \(player.items().count)\n", stderr)
        } else {
            // No current item - insert at end of queue (which may be empty)
            // This allows preloading even when nothing is playing
            player.insert(item, after: nil)
            fputs("[Swift] No current item - inserted at end of queue. Queue count: \(player.items().count)\n", stderr)
        }

        // Load both playable status and duration
        item.asset.loadValuesAsynchronously(forKeys: ["playable", "duration"]) { [weak self] in
            DispatchQueue.main.async {
                var error: NSError?
                let playableStatus = item.asset.statusOfValue(forKey: "playable", error: &error)
                let durationStatus = item.asset.statusOfValue(forKey: "duration", error: nil)

                if playableStatus == .loaded {
                    // Store duration if available
                    if durationStatus == .loaded {
                        let duration = item.asset.duration.seconds
                        self?.preloadedDuration = duration.isNaN ? 0 : duration
                        fputs("[Swift] Preload ready: \(id) | duration: \(self?.preloadedDuration ?? 0)\n", stderr)
                    } else {
                        self?.preloadedDuration = 0
                        fputs("[Swift] Preload ready: \(id) | duration: unknown\n", stderr)
                    }
                    sendEvent(["event": "preloaded", "id": id])
                } else {
                    sendEvent([
                        "event": "error",
                        "message": error?.localizedDescription ?? "Failed to preload",
                        "path": path
                    ])
                }
            }
        }
    }

    func play() {
        player.play()
        spectrumAnalyzer.startAnalysis()
    }

    func pause() {
        player.pause()
        spectrumAnalyzer.stopAnalysis()
    }

    func stop() {
        player.pause()
        player.removeAllItems()
        currentItem = nil
        preloadedItem = nil
        currentTrackId = nil
        preloadedTrackId = nil
        currentFilePath = nil
        preloadedFilePath = nil
        currentDuration = 0
        itemToTrackId.removeAll()
        spectrumAnalyzer.stopAnalysis()
        spectrumAnalyzer.closeFile()
    }

    func seek(to position: Double) {
        let time = CMTime(seconds: position, preferredTimescale: 1000)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            // Send state update after seek completes (even when paused)
            guard let self = self else { return }
            let pos = self.player.currentTime().seconds
            let safePos = pos.isNaN ? 0 : pos
            sendEvent([
                "event": "state",
                "playing": self.player.rate > 0,
                "position": safePos,
                "duration": self.currentDuration
            ])
        }
    }

    func setVolume(_ level: Float) {
        player.volume = max(0, min(1, level))
    }

    func setLookahead(_ seconds: Double) {
        spectrumAnalyzer.setLookahead(seconds)
    }

    func playNext() {
        // Manual advancement (skip button)
        guard let nextId = preloadedTrackId else {
            // No preloaded track - just stop
            stop()
            return
        }

        player.advanceToNextItem()

        // Update state
        currentTrackId = nextId
        currentItem = preloadedItem
        currentFilePath = preloadedFilePath
        currentDuration = preloadedDuration
        preloadedItem = nil
        preloadedTrackId = nil
        preloadedFilePath = nil
        preloadedDuration = 0

        // Switch analyzer to new file
        if let path = currentFilePath {
            spectrumAnalyzer.openFile(path: path)
        }

        sendEvent(["event": "trackChanged", "id": nextId, "duration": currentDuration])
    }

    // MARK: - Observers

    private func setupObservers() {
        // Periodic time updates (every 40ms to match spectrum analyzer rate)
        let interval = CMTime(seconds: 0.04, preferredTimescale: 1000)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main
        ) { [weak self] time in
            self?.sendStateUpdate()
        }

        // Track end notification
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerItemDidPlayToEndTime),
            name: .AVPlayerItemDidPlayToEndTime,
            object: nil
        )

        // Track failed notification
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerItemFailedToPlayToEndTime),
            name: .AVPlayerItemFailedToPlayToEndTime,
            object: nil
        )
    }

    @objc private func playerItemDidPlayToEndTime(_ notification: Notification) {
        guard let item = notification.object as? AVPlayerItem else { return }

        // Get the track ID for this item
        guard let endedTrackId = itemToTrackId[item] else { return }

        // Only process if this is our current item
        guard item === currentItem else { return }

        // Debug: Log state before processing
        let hasPreloaded = preloadedTrackId != nil
        let queueCount = player.items().count
        fputs("[Swift] Track ended: \(endedTrackId) | hasPreloaded: \(hasPreloaded) | queueCount: \(queueCount)\n", stderr)

        // Send track ended event
        sendEvent(["event": "trackEnded", "id": endedTrackId])

        // Clean up the ended item
        itemToTrackId.removeValue(forKey: item)

        // Promote preloaded to current (AVQueuePlayer already advanced)
        if let nextId = preloadedTrackId {
            currentTrackId = nextId
            currentItem = preloadedItem
            currentFilePath = preloadedFilePath
            // Use stored preloaded duration (more reliable than reading from asset during playback)
            currentDuration = preloadedDuration
            preloadedItem = nil
            preloadedTrackId = nil
            preloadedFilePath = nil
            preloadedDuration = 0

            // Switch analyzer to new file
            if let path = currentFilePath {
                spectrumAnalyzer.openFile(path: path)
            }

            fputs("[Swift] Promoting to: \(nextId) | duration: \(currentDuration)\n", stderr)
            sendEvent([
                "event": "trackChanged",
                "id": nextId,
                "duration": currentDuration
            ])

            // AVQueuePlayer should auto-play, but ensure it's playing
            player.play()
            fputs("[Swift] Called player.play()\n", stderr)
        } else {
            fputs("[Swift] No preloaded track - stopping\n", stderr)
            // No next track
            currentItem = nil
            currentTrackId = nil
            currentFilePath = nil
            spectrumAnalyzer.stopAnalysis()
            spectrumAnalyzer.closeFile()
        }
    }

    @objc private func playerItemFailedToPlayToEndTime(_ notification: Notification) {
        guard let item = notification.object as? AVPlayerItem,
              let error = item.error else { return }

        let trackId = itemToTrackId[item] ?? "unknown"
        sendEvent([
            "event": "error",
            "message": error.localizedDescription,
            "trackId": trackId
        ])
    }

    private func sendStateUpdate() {
        // Only send during playback
        guard player.rate > 0 else { return }

        let position = player.currentTime().seconds
        let safePosition = position.isNaN ? 0 : position

        // Update spectrum analyzer position (it chases the playback time)
        spectrumAnalyzer.updatePosition(safePosition)

        sendEvent([
            "event": "state",
            "playing": player.rate > 0,
            "position": safePosition,
            "duration": currentDuration
        ])
    }
}

// MARK: - JSON Helpers

func sendEvent(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let json = String(data: data, encoding: .utf8) else {
        return
    }
    print(json)
    fflush(stdout)
}

func processCommand(_ line: String, engine: AudioEngine) {
    guard let data = line.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cmd = json["cmd"] as? String else {
        sendEvent(["event": "error", "message": "Invalid command: \(line)"])
        return
    }

    switch cmd {
    case "load":
        if let id = json["id"] as? String, let path = json["path"] as? String {
            engine.load(id: id, path: path)
        } else {
            sendEvent(["event": "error", "message": "load requires id and path"])
        }

    case "preload":
        if let id = json["id"] as? String, let path = json["path"] as? String {
            engine.preload(id: id, path: path)
        } else {
            sendEvent(["event": "error", "message": "preload requires id and path"])
        }

    case "play":
        engine.play()

    case "pause":
        engine.pause()

    case "stop":
        engine.stop()

    case "seek":
        if let position = json["position"] as? Double {
            engine.seek(to: position)
        } else {
            sendEvent(["event": "error", "message": "seek requires position"])
        }

    case "volume":
        if let level = json["level"] as? Double {
            engine.setVolume(Float(level))
        } else {
            sendEvent(["event": "error", "message": "volume requires level"])
        }

    case "playNext":
        engine.playNext()

    case "setLookahead":
        if let seconds = json["seconds"] as? Double {
            engine.setLookahead(seconds)
        } else {
            sendEvent(["event": "error", "message": "setLookahead requires seconds"])
        }

    case "quit":
        exit(0)

    default:
        sendEvent(["event": "error", "message": "Unknown command: \(cmd)"])
    }
}
