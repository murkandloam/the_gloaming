import Foundation
import AVFoundation
import Accelerate

/// Spectrum analyzer that reads audio independently for FFT visualization.
/// "Two readers, one score" - this never touches AVQueuePlayer.
/// It opens files separately with AVAudioFile and chases the playback position.
class SpectrumAnalyzer {
    // FFT configuration
    private let fftSize: Int = 2048
    private let bandCount: Int = 25
    private var fftSetup: FFTSetup?

    // Audio file reader (independent from playback)
    private var analysisFile: AVAudioFile?
    private var sampleRate: Double = 44100
    private var currentFilePath: String?

    // Buffers for FFT
    private var realBuffer: [Float] = []
    private var imagBuffer: [Float] = []
    private var windowBuffer: [Float] = []
    private var magnitudes: [Float] = []

    // Smoothed output bands
    private var smoothedBands: [Float]

    // Band frequency edges (log-spaced from 20Hz to 20kHz)
    private var bandEdges: [Float] = []

    // Analysis timer
    private var analysisTimer: DispatchSourceTimer?
    private var isAnalyzing = false

    // Current playback position (updated from AudioEngine)
    private var currentPosition: Double = 0

    // Lookahead to compensate for latency in the position reporting chain
    // Configurable via settings - varies by machine/output device
    private var lookaheadSeconds: Double = 0.030

    // Normalization - running max with decay
    private var runningMax: Float = 0.1
    private let maxDecay: Float = 0.995

    init() {
        smoothedBands = [Float](repeating: 0, count: bandCount)
        setupFFT()
        calculateBandEdges()
    }

    deinit {
        stopAnalysis()
        if let setup = fftSetup {
            vDSP_destroy_fftsetup(setup)
        }
    }

    // MARK: - Setup

    private func setupFFT() {
        let log2n = vDSP_Length(log2(Float(fftSize)))
        fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))

        // Allocate buffers
        realBuffer = [Float](repeating: 0, count: fftSize / 2)
        imagBuffer = [Float](repeating: 0, count: fftSize / 2)
        magnitudes = [Float](repeating: 0, count: fftSize / 2)

        // Create Hann window
        windowBuffer = [Float](repeating: 0, count: fftSize)
        vDSP_hann_window(&windowBuffer, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
    }

    private func calculateBandEdges() {
        // Log-spaced bands from 55Hz to 18kHz
        // Starting at 55Hz cuts off inaudible sub-bass that just wastes bars
        // Ending at 18kHz avoids the mostly-empty ultra-high range
        let minFreq: Float = 55.0
        let maxFreq: Float = 18000.0
        let ratio = maxFreq / minFreq

        bandEdges = (0...bandCount).map { i in
            minFreq * pow(ratio, Float(i) / Float(bandCount))
        }
    }

    // MARK: - File Management

    /// Open a new audio file for analysis (called when track loads/changes)
    func openFile(path: String) {
        // Close previous file
        analysisFile = nil
        currentFilePath = nil

        let url = URL(fileURLWithPath: path)

        do {
            analysisFile = try AVAudioFile(forReading: url)
            sampleRate = analysisFile!.processingFormat.sampleRate
            currentFilePath = path

            // Reset position
            currentPosition = 0

            // Reset smoothed bands
            smoothedBands = [Float](repeating: 0, count: bandCount)

            fputs("[SpectrumAnalyzer] Opened file: \(path) | sampleRate: \(sampleRate)\n", stderr)
        } catch {
            fputs("[SpectrumAnalyzer] Failed to open file: \(error.localizedDescription)\n", stderr)
        }
    }

    /// Close current file (called on stop)
    func closeFile() {
        analysisFile = nil
        currentFilePath = nil
        smoothedBands = [Float](repeating: 0, count: bandCount)
    }

    // MARK: - Position Sync

    /// Update the playback position (called from AudioEngine's state updates)
    func updatePosition(_ position: Double) {
        currentPosition = position
    }

    /// Set the lookahead time (user-configurable)
    func setLookahead(_ seconds: Double) {
        lookaheadSeconds = max(0, min(0.5, seconds))  // Clamp 0-500ms
        fputs("[SpectrumAnalyzer] Lookahead set to \(lookaheadSeconds * 1000)ms\n", stderr)
    }

    // MARK: - Analysis Control

    /// Start sending spectrum events at ~25fps
    func startAnalysis() {
        guard !isAnalyzing else { return }
        isAnalyzing = true

        let queue = DispatchQueue(label: "com.gloaming.spectrum", qos: .userInteractive)
        analysisTimer = DispatchSource.makeTimerSource(queue: queue)
        analysisTimer?.schedule(deadline: .now(), repeating: .milliseconds(40)) // 25fps

        analysisTimer?.setEventHandler { [weak self] in
            self?.analyzeAndSend()
        }

        analysisTimer?.resume()
        fputs("[SpectrumAnalyzer] Started analysis\n", stderr)
    }

    /// Stop sending spectrum events
    func stopAnalysis() {
        isAnalyzing = false
        analysisTimer?.cancel()
        analysisTimer = nil

        // Send zeros to gracefully fade out
        DispatchQueue.main.async {
            self.smoothedBands = [Float](repeating: 0, count: self.bandCount)
            self.sendSpectrumEvent()
        }
    }

    // MARK: - FFT Analysis

    private func analyzeAndSend() {
        guard let file = analysisFile, let setup = fftSetup else {
            return
        }

        // Calculate frame position from current playback time + lookahead
        // This compensates for latency in position reporting and rendering
        let analysisPosition = currentPosition + lookaheadSeconds
        let framePosition = AVAudioFramePosition(analysisPosition * sampleRate)

        // Bounds check - don't read past end of file
        guard framePosition >= 0, framePosition < file.length - AVAudioFramePosition(fftSize) else {
            return
        }

        // Seek to position
        file.framePosition = framePosition

        // Read samples
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: file.processingFormat,
            frameCapacity: AVAudioFrameCount(fftSize)
        ) else { return }

        do {
            try file.read(into: buffer, frameCount: AVAudioFrameCount(fftSize))
        } catch {
            return
        }

        guard let channelData = buffer.floatChannelData?[0] else { return }

        // Apply window
        var windowedSamples = [Float](repeating: 0, count: fftSize)
        vDSP_vmul(channelData, 1, windowBuffer, 1, &windowedSamples, 1, vDSP_Length(fftSize))

        // Perform FFT
        var splitComplex = DSPSplitComplex(realp: &realBuffer, imagp: &imagBuffer)

        windowedSamples.withUnsafeBufferPointer { ptr in
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: fftSize / 2) { complexPtr in
                vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(fftSize / 2))
            }
        }

        let log2n = vDSP_Length(log2(Float(fftSize)))
        vDSP_fft_zrip(setup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))

        // Calculate magnitudes
        vDSP_zvmags(&splitComplex, 1, &magnitudes, 1, vDSP_Length(fftSize / 2))

        // Convert to dB scale then normalize
        var one: Float = 1.0
        vDSP_vsadd(magnitudes, 1, &one, &magnitudes, 1, vDSP_Length(fftSize / 2)) // Add 1 to avoid log(0)

        var dbMagnitudes = [Float](repeating: 0, count: fftSize / 2)
        var count = Int32(fftSize / 2)
        vvlog10f(&dbMagnitudes, &magnitudes, &count)

        // Scale to reasonable range (0-1)
        var scale: Float = 0.15  // Tune this for visual appeal
        vDSP_vsmul(dbMagnitudes, 1, &scale, &dbMagnitudes, 1, vDSP_Length(fftSize / 2))

        // Bucket into bands
        let newBands = bucketIntoBands(dbMagnitudes)

        // Smooth with asymmetric attack/decay
        for i in 0..<bandCount {
            let target = newBands[i]
            if target > smoothedBands[i] {
                // Near-instant attack (~20ms)
                smoothedBands[i] = smoothedBands[i] * 0.07 + target * 0.93
            } else {
                // Snappy decay (~60ms)
                smoothedBands[i] = smoothedBands[i] * 0.55 + target * 0.45
            }
        }

        // Send on main thread
        DispatchQueue.main.async {
            self.sendSpectrumEvent()
        }
    }

    private func bucketIntoBands(_ magnitudes: [Float]) -> [Float] {
        var bands = [Float](repeating: 0, count: bandCount)
        let binWidth = Float(sampleRate) / Float(fftSize)

        for i in 0..<bandCount {
            let lowFreq = bandEdges[i]
            let highFreq = bandEdges[i + 1]

            let lowBin = max(1, Int(lowFreq / binWidth))
            let highBin = min(fftSize / 2 - 1, Int(highFreq / binWidth))

            if highBin >= lowBin {
                // For narrow bands (few bins), use weighted average with neighbors
                // This prevents single-bin spikes (the "middle finger" effect)
                var sum: Float = 0
                var weightSum: Float = 0

                for bin in lowBin...highBin {
                    let value = max(0, magnitudes[bin])
                    // Weight center bins more than edges
                    let centerBin = Float(lowBin + highBin) / 2.0
                    let distance = abs(Float(bin) - centerBin)
                    let weight = 1.0 / (1.0 + distance * 0.3)
                    sum += value * weight
                    weightSum += weight
                }

                // Also blend with neighbors to smooth isolated peaks
                if lowBin > 1 {
                    sum += max(0, magnitudes[lowBin - 1]) * 0.3
                    weightSum += 0.3
                }
                if highBin < fftSize / 2 - 2 {
                    sum += max(0, magnitudes[highBin + 1]) * 0.3
                    weightSum += 0.3
                }

                bands[i] = sum / weightSum
            }
        }

        // Track running max for normalization
        let currentMax = bands.max() ?? 0.1
        runningMax = max(runningMax * maxDecay, currentMax, 0.1)

        // Normalize
        return bands.map { min(1.0, max(0, $0 / runningMax)) }
    }

    private func sendSpectrumEvent() {
        // Calculate RMS and peak from current bands
        let rms = sqrt(smoothedBands.reduce(0) { $0 + $1 * $1 } / Float(bandCount))
        let peak = smoothedBands.max() ?? 0

        sendEvent([
            "event": "spectrum",
            "bands": smoothedBands,
            "rms": rms,
            "peak": peak
        ])
    }
}
