/**
 * Audio Bridge
 *
 * Manages the Swift audio service as a child process.
 * Communicates via newline-delimited JSON over stdin/stdout.
 *
 * The Swift service provides true gapless playback using AVQueuePlayer.
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class AudioBridge extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.buffer = '';
    this.ready = false;
    this.spawning = false;
  }

  /**
   * Spawn the Swift audio service
   * @param {string} libraryPath - Path to current library (for future use)
   */
  spawn(libraryPath) {
    if (this.process || this.spawning) {
      console.log('[AudioBridge] Already running or spawning');
      return;
    }

    this.spawning = true;

    // Determine binary path based on environment
    // In development: use release build from swift-audio
    // In production (packaged app): use binary from Resources folder
    const isDev = !process.resourcesPath || process.resourcesPath.includes('node_modules');
    const binaryPath = isDev
      ? path.join(__dirname, '../swift-audio/.build/arm64-apple-macosx/release/gloaming-audio')
      : path.join(process.resourcesPath, 'gloaming-audio');

    console.log('[AudioBridge] Spawning Swift audio service...');
    console.log('[AudioBridge] Binary:', binaryPath);

    try {
      this.process = spawn(binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe']  // stdin, stdout, stderr
      });

      // Handle stdout (JSON events from Swift)
      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      // Handle stderr (Swift errors/logs)
      this.process.stderr.on('data', (data) => {
        console.error('[AudioBridge:stderr]', data.toString().trim());
      });

      // Handle process exit
      this.process.on('close', (code) => {
        console.log(`[AudioBridge] Process exited with code ${code}`);
        this.process = null;
        this.ready = false;
        this.spawning = false;
        this.emit('closed', code);
      });

      // Handle spawn error
      this.process.on('error', (err) => {
        console.error('[AudioBridge] Spawn error:', err.message);
        this.process = null;
        this.ready = false;
        this.spawning = false;
        this.emit('error', err);
      });

      this.spawning = false;

    } catch (err) {
      console.error('[AudioBridge] Failed to spawn:', err.message);
      this.spawning = false;
      this.emit('error', err);
    }
  }

  /**
   * Process buffered stdout data, extracting complete JSON lines
   */
  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';  // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          this.handleEvent(event);
        } catch (e) {
          console.error('[AudioBridge] Failed to parse:', line, e.message);
        }
      }
    }
  }

  /**
   * Handle a parsed event from the Swift service
   */
  handleEvent(event) {
    const eventName = event.event;

    if (eventName === 'ready') {
      this.ready = true;
      console.log('[AudioBridge] ✓ Swift audio service ready (native gapless playback enabled)');
    }

    // Emit the event for IPC handlers to forward to renderer
    this.emit(eventName, event);
  }

  /**
   * Send a command to the Swift service
   */
  send(command) {
    if (!this.process || !this.process.stdin.writable) {
      console.warn('[AudioBridge] Cannot send - process not running');
      return false;
    }

    try {
      const json = JSON.stringify(command) + '\n';
      this.process.stdin.write(json);
      return true;
    } catch (err) {
      console.error('[AudioBridge] Send error:', err.message);
      return false;
    }
  }

  // ============================================
  // Command Methods
  // ============================================

  /**
   * Load a track (does not auto-play)
   */
  load(id, audioPath) {
    return this.send({ cmd: 'load', id, path: audioPath });
  }

  /**
   * Preload next track for gapless transition
   */
  preload(id, audioPath) {
    return this.send({ cmd: 'preload', id, path: audioPath });
  }

  /**
   * Start/resume playback
   */
  play() {
    return this.send({ cmd: 'play' });
  }

  /**
   * Pause playback
   */
  pause() {
    return this.send({ cmd: 'pause' });
  }

  /**
   * Stop playback and clear state
   */
  stop() {
    return this.send({ cmd: 'stop' });
  }

  /**
   * Seek to position in seconds
   */
  seek(position) {
    return this.send({ cmd: 'seek', position });
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(level) {
    return this.send({ cmd: 'volume', level });
  }

  /**
   * Switch to preloaded track (manual skip)
   */
  playNext() {
    return this.send({ cmd: 'playNext' });
  }

  /**
   * Set visualizer lookahead in seconds (for sync adjustment)
   */
  setLookahead(seconds) {
    return this.send({ cmd: 'setLookahead', seconds });
  }

  /**
   * Gracefully shutdown the Swift service
   */
  quit() {
    if (this.process) {
      this.send({ cmd: 'quit' });

      // Give it a moment to quit gracefully, then force kill
      setTimeout(() => {
        if (this.process) {
          console.log('[AudioBridge] Force killing process');
          this.process.kill('SIGTERM');
          this.process = null;
        }
      }, 500);
    }

    this.ready = false;
  }

  /**
   * Check if the service is running and ready
   */
  isReady() {
    return this.ready && this.process !== null;
  }
}

// Export singleton instance
const audioBridge = new AudioBridge();
module.exports = audioBridge;
