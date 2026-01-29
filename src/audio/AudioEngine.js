/**
 * The Gloaming - Audio Engine
 *
 * Supports two playback backends:
 * 1. Native (Swift AVQueuePlayer) - True gapless playback via IPC
 * 2. HTML5 Audio - Fallback using dual-element A/B buffering
 *
 * The native backend is preferred when available. Set useNativeAudio: false
 * in library config to use HTML5 Audio instead.
 */

const { ipcRenderer } = window.require ? window.require('electron') : {};

class AudioEngine {
  constructor() {
    // Backend selection (set during initialize)
    this.useNativeAudio = true;

    // Web Audio context for HTML5 backend volume control
    this.audioContext = null;

    // Dual audio elements for HTML5 gapless playback
    this.audioA = null;
    this.audioB = null;
    this.activePlayer = 'A';

    // Volume control
    this.gainNode = null;
    this.volume = 1.0;

    // State
    this.isPlaying = false;
    this.currentTrack = null;
    this.nextTrack = null;
    this.currentTime = 0;
    this.duration = 0;

    // Guard against concurrent play/pause operations
    this._playPauseInProgress = false;

    // Callbacks
    this.onTrackEnd = null;      // Called when track ends naturally
    this.onTimeUpdate = null;    // Called with { currentTime, duration }
    this.onStateChange = null;   // Called with { isPlaying, track }
    this.onError = null;         // Called with error info
    this.onSpectrum = null;      // Called with { bands, rms, peak } for visualizer

    // Preload state
    this.nextTrackReady = false;

    // Bind HTML5 event handlers
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.handleTrackEnded = this.handleTrackEnded.bind(this);
    this.handleCanPlayThrough = this.handleCanPlayThrough.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  /**
   * Initialize the audio engine
   * @param {boolean} useNativeAudio - Whether to use native Swift backend
   */
  async initialize(useNativeAudio = true) {
    this.useNativeAudio = useNativeAudio && !!ipcRenderer;

    if (this.useNativeAudio) {
      await this.initializeNative();
    } else {
      await this.initializeHTML5();
    }

    console.log(`[AudioEngine] Initialized (${this.useNativeAudio ? 'native' : 'HTML5'})`);
  }

  // ============================================
  // Native Audio Backend (Swift via IPC)
  // ============================================

  async initializeNative() {
    if (!ipcRenderer) {
      console.warn('[AudioEngine] No ipcRenderer - falling back to HTML5');
      this.useNativeAudio = false;
      return this.initializeHTML5();
    }

    // Remove any existing listeners first (prevents duplicates on re-init)
    ipcRenderer.removeAllListeners('audio:state');
    ipcRenderer.removeAllListeners('audio:loaded');
    ipcRenderer.removeAllListeners('audio:preloaded');
    ipcRenderer.removeAllListeners('audio:trackEnded');
    ipcRenderer.removeAllListeners('audio:trackChanged');
    ipcRenderer.removeAllListeners('audio:error');
    ipcRenderer.removeAllListeners('audio:closed');
    ipcRenderer.removeAllListeners('audio:spectrum');

    // Set up event listeners from Swift service
    ipcRenderer.on('audio:state', (event, data) => {
      // Debug: log when we receive state updates while paused
      if (!data.playing) {
        console.log('[AudioEngine] State update while paused:', data.position);
      }
      this.currentTime = data.position;
      this.duration = data.duration;
      this.isPlaying = data.playing;
      this.onTimeUpdate?.({
        currentTime: data.position,
        duration: data.duration
      });
    });

    ipcRenderer.on('audio:loaded', (event, data) => {
      this.duration = data.duration;
      console.log('[AudioEngine] Loaded:', data.id, `(${data.duration}s)`);
    });

    ipcRenderer.on('audio:preloaded', (event, data) => {
      this.nextTrackReady = true;
      console.log('[AudioEngine] Preloaded:', data.id);
    });

    ipcRenderer.on('audio:trackEnded', (event, data) => {
      console.log('[AudioEngine] Track ended (native):', data.id, '| nextTrackReady:', this.nextTrackReady);

      // If there's a next track preloaded, Swift will handle the transition
      // and send trackChanged. We just wait for that.
      if (this.nextTrackReady && this.nextTrack) {
        console.log('[AudioEngine] Waiting for trackChanged (gapless transition)...');
        return;
      }

      // No next track - queue is empty. Handle like stop.
      console.log('[AudioEngine] No next track - queue ended');
      const endedTrack = this.currentTrack;

      // Clear state
      this.isPlaying = false;
      this.currentTrack = null;
      this.currentTime = 0;
      this.duration = 0;

      // Notify about the ended track (for history/ledgers)
      this.onTrackEnd?.(endedTrack);

      // Update UI
      this.onTimeUpdate?.({ currentTime: 0, duration: 0 });
      this.onStateChange?.({ isPlaying: false, track: null });
    });

    ipcRenderer.on('audio:trackChanged', (event, data) => {
      console.log('[AudioEngine] Track changed to:', data.id, '| duration:', data.duration);

      // Check if we already handled this transition (e.g., manual skip in playNext)
      // If currentTrack already matches the incoming track ID, skip state promotion
      if (this.currentTrack && this.currentTrack.id === data.id) {
        console.log('[AudioEngine] Track change already handled (manual skip), skipping promotion');
        // Still update duration if provided
        if (data.duration) {
          this.duration = data.duration;
        }
        return;
      }

      // Store the track that just ended (for ledger recording)
      const endedTrack = this.currentTrack;

      // Gapless transition occurred - promote next track to current
      this.currentTrack = this.nextTrack;
      this.nextTrack = null;
      this.nextTrackReady = false;

      // Update duration from the event (Swift sends it with trackChanged)
      if (data.duration) {
        this.duration = data.duration;
      }
      this.isPlaying = true; // Track changed means we're playing

      // Now notify about the ended track - this triggers queue advance
      // This happens AFTER we've promoted nextTrack to currentTrack
      this.onTrackEnd?.(endedTrack);

      // Notify about state change with new current track
      this.onStateChange?.({ isPlaying: true, track: this.currentTrack });
    });

    ipcRenderer.on('audio:error', (event, data) => {
      console.error('[AudioEngine] Error:', data.message);
      this.onError?.({
        message: data.message,
        path: data.path,
        track: this.currentTrack
      });
    });

    ipcRenderer.on('audio:closed', (event, data) => {
      console.warn('[AudioEngine] Swift service closed with code:', data);
      // Could implement auto-restart here if needed
    });

    // Spectrum data for visualizer (25 bands at ~25fps)
    ipcRenderer.on('audio:spectrum', (event, data) => {
      this.onSpectrum?.({
        bands: data.bands,
        rms: data.rms,
        peak: data.peak
      });
    });

    // Check if service is ready
    const { ready } = await ipcRenderer.invoke('audio:isReady');
    if (!ready) {
      console.warn('[AudioEngine] Swift service not ready - may still be starting');
    }
  }

  // ============================================
  // HTML5 Audio Backend (Fallback)
  // ============================================

  async initializeHTML5() {
    if (this.audioContext) {
      return; // Already initialized
    }

    // Create Web Audio context
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = this.volume;

    // Create dual audio elements
    this.audioA = this.createAudioElement('A');
    this.audioB = this.createAudioElement('B');
  }

  createAudioElement(id) {
    const audio = new Audio();
    audio.id = `gloaming-audio-${id}`;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio._mediaSource = null;
    audio._id = id;
    return audio;
  }

  connectToGraph(audio) {
    if (audio._mediaSource) return;

    try {
      audio._mediaSource = this.audioContext.createMediaElementSource(audio);
      audio._mediaSource.connect(this.gainNode);
    } catch (e) {
      console.warn('[AudioEngine] Could not connect to graph:', e.message);
    }
  }

  getActiveAudio() {
    return this.activePlayer === 'A' ? this.audioA : this.audioB;
  }

  getInactiveAudio() {
    return this.activePlayer === 'A' ? this.audioB : this.audioA;
  }

  // ============================================
  // Unified API Methods
  // ============================================

  /**
   * Load and optionally play a track
   */
  async loadAndPlay(track, autoPlay = true) {
    if (!this.audioContext && !this.useNativeAudio) {
      await this.initialize(false);
    }

    const audioPath = track.audioPath || track.path;
    if (!audioPath) {
      console.error('[AudioEngine] No audio path for track:', track);
      this.onError?.({ message: 'No audio path', track });
      return;
    }

    // Debug: log when load is called (this clears preloaded state!)
    console.log('[AudioEngine] loadAndPlay called:', {
      id: track.id,
      title: track.title,
      autoPlay,
      stackTrace: new Error().stack
    });

    this.currentTrack = track;
    this.nextTrackReady = false;

    if (this.useNativeAudio) {
      // Native backend
      await ipcRenderer.invoke('audio:load', {
        id: track.id,
        audioPath: audioPath
      });

      if (autoPlay) {
        await ipcRenderer.invoke('audio:play');
        this.isPlaying = true;
        this.onStateChange?.({ isPlaying: true, track });
        console.log('[AudioEngine] Playing:', track.title);
      } else {
        this.isPlaying = false;
        this.onStateChange?.({ isPlaying: false, track });
        console.log('[AudioEngine] Loaded (paused):', track.title);
      }
    } else {
      // HTML5 backend
      if (autoPlay && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const audio = this.getActiveAudio();
      this.removeListeners(audio);

      const src = audioPath.startsWith('local://') ? audioPath : `local://${audioPath}`;
      audio.src = src;

      this.connectToGraph(audio);
      this.addListeners(audio);

      try {
        audio.load();
        if (autoPlay) {
          await audio.play();
          this.isPlaying = true;
          this.onStateChange?.({ isPlaying: true, track });
          console.log('[AudioEngine] Playing:', track.title);
        } else {
          this.isPlaying = false;
          this.onStateChange?.({ isPlaying: false, track });
          console.log('[AudioEngine] Loaded (paused):', track.title);
        }
      } catch (e) {
        console.error('[AudioEngine] Play failed:', e);
        this.onError?.({ message: e.message, track });
      }
    }
  }

  /**
   * Preload the next track for gapless playback
   */
  async preloadNext(track) {
    if (!track) {
      this.nextTrack = null;
      this.nextTrackReady = false;
      return;
    }

    const audioPath = track.audioPath || track.path;

    // Debug: log the full track object to see what we're getting
    console.log('[AudioEngine] preloadNext called with track:', {
      id: track.id,
      title: track.title,
      audioPath: track.audioPath,
      path: track.path,
      resolvedPath: audioPath,
      hasAudioPath: !!track.audioPath,
      fullTrack: track
    });

    if (!audioPath) {
      console.warn('[AudioEngine] No audio path for next track');
      return;
    }

    this.nextTrack = track;
    this.nextTrackReady = false;

    if (this.useNativeAudio) {
      console.log('[AudioEngine] Preloading (native):', track.title, '| id:', track.id, '| path:', audioPath);
      const result = await ipcRenderer.invoke('audio:preload', {
        id: track.id,
        audioPath: audioPath
      });
      console.log('[AudioEngine] Preload result:', result);
    } else {
      // HTML5 backend
      if (!this.audioContext) {
        console.log('[AudioEngine] Deferred preload (not initialized yet):', track.title);
        return;
      }

      const audio = this.getInactiveAudio();
      if (!audio) {
        console.warn('[AudioEngine] No inactive audio element available');
        return;
      }

      audio.removeEventListener('canplaythrough', this.handleCanPlayThrough);

      const src = audioPath.startsWith('local://') ? audioPath : `local://${audioPath}`;
      audio.src = src;

      this.connectToGraph(audio);
      audio.addEventListener('canplaythrough', this.handleCanPlayThrough);
      audio.load();

      console.log('[AudioEngine] Preloading:', track.title);
    }
  }

  /**
   * Switch to the next track (gapless transition)
   */
  async playNext() {
    if (!this.nextTrack) {
      console.log('[AudioEngine] No next track');
      this.isPlaying = false;
      this.onStateChange?.({ isPlaying: false, track: null });
      return;
    }

    if (this.useNativeAudio) {
      // Promote nextTrack to currentTrack BEFORE calling playNext
      // This prevents race condition where queue advances and preloads
      // a new track before we've updated currentTrack
      const trackToPlay = this.nextTrack;
      this.currentTrack = trackToPlay;
      this.nextTrack = null;
      this.nextTrackReady = false;

      // Reset time immediately so progress bar shows 0 before playback starts
      this.currentTime = 0;
      this.onTimeUpdate?.({ currentTime: 0, duration: this.duration });

      await ipcRenderer.invoke('audio:playNext');

      // Notify about state change immediately with the correct track
      this.isPlaying = true;
      this.onStateChange?.({ isPlaying: true, track: trackToPlay });
      console.log('[AudioEngine] Switched to (manual skip):', trackToPlay.title);
      return;
      // Note: audio:trackChanged will still fire but we've already updated state
    } else {
      // HTML5 backend
      const currentAudio = this.getActiveAudio();
      const nextAudio = this.getInactiveAudio();

      currentAudio.pause();
      this.removeListeners(currentAudio);

      this.activePlayer = this.activePlayer === 'A' ? 'B' : 'A';
      this.addListeners(nextAudio);

      this.currentTrack = this.nextTrack;
      this.nextTrack = null;
      this.nextTrackReady = false;

      // Reset time immediately so progress bar shows 0 before playback starts
      this.currentTime = 0;
      this.onTimeUpdate?.({ currentTime: 0, duration: nextAudio.duration || 0 });

      try {
        await nextAudio.play();
        this.isPlaying = true;
        this.onStateChange?.({ isPlaying: true, track: this.currentTrack });
        console.log('[AudioEngine] Switched to:', this.currentTrack.title);
      } catch (e) {
        console.error('[AudioEngine] Switch play failed:', e);
        this.onError?.({ message: e.message, track: this.currentTrack });
      }
    }
  }

  /**
   * Play/pause toggle
   */
  async togglePlayPause() {
    // Prevent concurrent play/pause operations that cause race conditions
    if (this._playPauseInProgress) return;
    this._playPauseInProgress = true;

    try {
      if (this.isPlaying) {
        await this.pause();
      } else {
        await this.play();
      }
    } finally {
      this._playPauseInProgress = false;
    }
  }

  /**
   * Pause playback
   */
  async pause() {
    if (this.useNativeAudio) {
      await ipcRenderer.invoke('audio:pause');
    } else {
      const audio = this.getActiveAudio();
      audio?.pause();
    }

    this.isPlaying = false;
    this.onStateChange?.({ isPlaying: false, track: this.currentTrack });
  }

  /**
   * Resume playback
   */
  async play() {
    if (!this.currentTrack) return;

    if (this.useNativeAudio) {
      await ipcRenderer.invoke('audio:play');
      this.isPlaying = true;
    } else {
      const audio = this.getActiveAudio();

      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      try {
        await audio.play();
        this.isPlaying = true;
      } catch (e) {
        console.error('[AudioEngine] Resume failed:', e);
        return;
      }
    }

    this.onStateChange?.({ isPlaying: true, track: this.currentTrack });
  }

  /**
   * Seek to position
   * @param {number} time - Time in seconds
   */
  async seek(time) {
    if (!isFinite(time)) return;

    if (this.useNativeAudio) {
      await ipcRenderer.invoke('audio:seek', time);
    } else {
      const audio = this.getActiveAudio();
      if (audio) {
        audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0));
      }
    }
  }

  /**
   * Seek by percentage (0-100)
   */
  async seekPercent(percent) {
    if (this.useNativeAudio) {
      // For native, we need the duration
      const targetTime = (percent / 100) * this.duration;
      await this.seek(targetTime);
    } else {
      const audio = this.getActiveAudio();
      if (audio && audio.duration) {
        await this.seek((percent / 100) * audio.duration);
      }
    }
  }

  /**
   * Set volume (0-1)
   */
  async setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));

    if (this.useNativeAudio) {
      await ipcRenderer.invoke('audio:volume', this.volume);
    } else if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.01);
    }
  }

  /**
   * Get current playback state
   */
  getState() {
    if (this.useNativeAudio) {
      return {
        isPlaying: this.isPlaying,
        currentTrack: this.currentTrack,
        currentTime: this.currentTime,
        duration: this.duration,
        volume: this.volume,
        nextTrackReady: this.nextTrackReady
      };
    } else {
      const audio = this.getActiveAudio();
      return {
        isPlaying: this.isPlaying,
        currentTrack: this.currentTrack,
        currentTime: audio?.currentTime || 0,
        duration: audio?.duration || 0,
        volume: this.volume,
        nextTrackReady: this.nextTrackReady
      };
    }
  }

  /**
   * Stop playback and reset
   */
  async stop() {
    if (this.useNativeAudio) {
      await ipcRenderer.invoke('audio:stop');
    } else {
      const audioA = this.audioA;
      const audioB = this.audioB;

      if (audioA) {
        audioA.pause();
        audioA.src = '';
        this.removeListeners(audioA);
      }

      if (audioB) {
        audioB.pause();
        audioB.src = '';
        audioB.removeEventListener('canplaythrough', this.handleCanPlayThrough);
      }
    }

    this.isPlaying = false;
    this.currentTrack = null;
    this.nextTrack = null;
    this.nextTrackReady = false;

    this.onStateChange?.({ isPlaying: false, track: null });
  }

  // ============================================
  // HTML5 Event Handlers
  // ============================================

  addListeners(audio) {
    audio.addEventListener('timeupdate', this.handleTimeUpdate);
    audio.addEventListener('ended', this.handleTrackEnded);
    audio.addEventListener('error', this.handleError);
  }

  removeListeners(audio) {
    audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    audio.removeEventListener('ended', this.handleTrackEnded);
    audio.removeEventListener('error', this.handleError);
  }

  handleTimeUpdate(e) {
    const audio = e.target;
    this.currentTime = audio.currentTime;
    this.duration = audio.duration;

    this.onTimeUpdate?.({
      currentTime: audio.currentTime,
      duration: audio.duration
    });
  }

  handleTrackEnded(e) {
    console.log('[AudioEngine] Track ended');

    this.onTrackEnd?.(this.currentTrack);

    if (this.nextTrackReady && this.nextTrack) {
      this.playNext();
    } else {
      // Queue is empty - clear the track and reset time
      this.isPlaying = false;
      this.currentTrack = null;
      this.currentTime = 0;
      this.duration = 0;
      this.onTimeUpdate?.({ currentTime: 0, duration: 0 });
      this.onStateChange?.({ isPlaying: false, track: null });
    }
  }

  handleCanPlayThrough(e) {
    console.log('[AudioEngine] Next track ready');
    this.nextTrackReady = true;
  }

  handleError(e) {
    const audio = e.target;
    console.error('[AudioEngine] Error:', audio.error);
    this.onError?.({
      message: audio.error?.message || 'Unknown playback error',
      code: audio.error?.code,
      track: this.currentTrack
    });
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Remove IPC listeners if native
    if (this.useNativeAudio && ipcRenderer) {
      ipcRenderer.removeAllListeners('audio:state');
      ipcRenderer.removeAllListeners('audio:loaded');
      ipcRenderer.removeAllListeners('audio:preloaded');
      ipcRenderer.removeAllListeners('audio:trackEnded');
      ipcRenderer.removeAllListeners('audio:trackChanged');
      ipcRenderer.removeAllListeners('audio:error');
      ipcRenderer.removeAllListeners('audio:closed');
    }

    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioA = null;
    this.audioB = null;
    this.gainNode = null;
  }
}

// Singleton instance
const audioEngine = new AudioEngine();

export default audioEngine;
export { AudioEngine };
