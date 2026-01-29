/**
 * The Gloaming - useAudioPlayer Hook
 * 
 * React hook for audio playback. Wraps the AudioEngine singleton
 * and provides reactive state for components.
 * 
 * Usage:
 *   const { 
 *     isPlaying, currentTrack, currentTime, duration,
 *     play, pause, togglePlayPause, seek, setVolume,
 *     loadTrack, preloadNext, skipNext
 *   } = useAudioPlayer({ queue, onTrackEnd });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import audioEngine from './AudioEngine';

// Get Electron IPC if available
const { ipcRenderer } = window.require ? window.require('electron') : {};

function useAudioPlayer({ queue = [], queuePosition = 0, onQueueAdvance, onAddToHistory, onError } = {}) {
  // Reactive state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1.0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [nextTrackReady, setNextTrackReady] = useState(false);
  const [spectrumBands, setSpectrumBands] = useState(null); // 25 bands from FFT analyzer

  // Listening session tracking
  const listeningSessionRef = useRef({
    trackId: null,
    albumId: null,
    artist: null,
    startTime: null,
    accumulatedSeconds: 0,
    lastUpdateTime: null
  });
  
  // Track the last track ID we started a session for
  const lastSessionTrackIdRef = useRef(null);

  // Refs to hold latest callback versions (to avoid stale closures in engine callbacks)
  const onAddToHistoryRef = useRef(onAddToHistory);
  const onQueueAdvanceRef = useRef(onQueueAdvance);
  const onErrorRef = useRef(onError);
  const handleTrackEndRef = useRef(null);

  // Keep refs up to date
  useEffect(() => {
    onAddToHistoryRef.current = onAddToHistory;
    onQueueAdvanceRef.current = onQueueAdvance;
    onErrorRef.current = onError;
  }, [onAddToHistory, onQueueAdvance, onError]);

  // Initialize engine on mount
  useEffect(() => {
    // Set up engine callbacks
    audioEngine.onStateChange = ({ isPlaying: playing, track }) => {
      setIsPlaying(playing);
      if (track !== undefined) {
        setCurrentTrack(track);
        // Reset time display when track is cleared (stop)
        if (track === null) {
          setCurrentTime(0);
          setDuration(0);
        }
      }

      // If a NEW track started playing (e.g., from gapless playback),
      // we need to start a session for it
      if (playing && track && track.id !== lastSessionTrackIdRef.current) {
        // Commit any existing session first
        const session = listeningSessionRef.current;
        if (session.trackId) {
          const { trackId, albumId, artist, accumulatedSeconds } = session;
          listeningSessionRef.current = {
            trackId: null, albumId: null, artist: null,
            startTime: null, accumulatedSeconds: 0, lastUpdateTime: null
          };
          // Gapless transition = track ended naturally, always add to history
          onAddToHistoryRef.current?.({ trackId, albumId, artist });
          // Record to ledgers if >= 5 seconds
          if (accumulatedSeconds >= 5) {
            console.log(`[Ledgers] Recorded ${Math.floor(accumulatedSeconds)}s for ${trackId}`);
            if (ipcRenderer) {
              ipcRenderer.invoke('record-listen', {
                trackId, albumId, artist, seconds: Math.floor(accumulatedSeconds)
              }).catch(err => console.error('[useAudioPlayer] Error recording listen:', err));
            }
          }
        }
        // Start new session
        listeningSessionRef.current = {
          trackId: track.id,
          albumId: track.albumId || null,
          artist: track.artist || null,
          startTime: Date.now(),
          accumulatedSeconds: 0,
          lastUpdateTime: Date.now()
        };
        lastSessionTrackIdRef.current = track.id;
        console.log(`[Ledgers] Started session for ${track.id} (via state change)`);
      }

      // Update listening session timing on play/pause
      const session = listeningSessionRef.current;
      if (playing && session.trackId) {
        // Resuming - reset the lastUpdateTime
        session.lastUpdateTime = Date.now();
      } else if (!playing && session.trackId) {
        // Pausing - accumulate time up to now
        if (session.lastUpdateTime) {
          const elapsed = (Date.now() - session.lastUpdateTime) / 1000;
          if (elapsed > 0 && elapsed < 60) { // Sanity check
            session.accumulatedSeconds += elapsed;
          }
          session.lastUpdateTime = null;
        }
      }
    };

    audioEngine.onTimeUpdate = ({ currentTime: time, duration: dur }) => {
      setCurrentTime(time);
      setDuration(dur);

      // Update accumulated listening time while playing
      const session = listeningSessionRef.current;
      if (session.trackId && session.lastUpdateTime) {
        const now = Date.now();
        const elapsed = (now - session.lastUpdateTime) / 1000;
        // Only accumulate if reasonable (< 2 seconds between updates)
        if (elapsed > 0 && elapsed < 2) {
          session.accumulatedSeconds += elapsed;
        }
        session.lastUpdateTime = now;
      }
      // Note: If lastUpdateTime is null, we're paused - don't restart timing here.
      // The play/pause handler in onStateChange manages lastUpdateTime.
    };
    
    audioEngine.onTrackEnd = (track) => {
      // Track ended naturally - queue management happens in handleTrackEnd
      // Use ref to always call the latest version
      handleTrackEndRef.current?.(track);
    };
    
    audioEngine.onError = (error) => {
      console.error('[useAudioPlayer] Error:', error);
      onErrorRef.current?.(error);
    };

    // Spectrum data for visualizer (native audio only)
    audioEngine.onSpectrum = ({ bands }) => {
      setSpectrumBands(bands);
    };

    // Commit session before window closes
    const handleBeforeUnload = () => {
      const session = listeningSessionRef.current;
      if (session.trackId && session.accumulatedSeconds >= 5 && ipcRenderer) {
        // Use sendSync for synchronous recording before close
        // Fall back to invoke (may not complete)
        ipcRenderer.invoke('record-listen', {
          trackId: session.trackId,
          albumId: session.albumId,
          artist: session.artist,
          seconds: Math.floor(session.accumulatedSeconds)
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Don't destroy the engine on unmount - it's a singleton
      // Just clear the callbacks
      audioEngine.onStateChange = null;
      audioEngine.onTimeUpdate = null;
      audioEngine.onTrackEnd = null;
      audioEngine.onError = null;
      audioEngine.onSpectrum = null;
    };
  }, []);
  
  // Record listening session to ledgers
  // trackEnded: true if track finished naturally (always add to history)
  const commitListeningSession = useCallback((trackEnded = false) => {
    const session = listeningSessionRef.current;

    if (!session.trackId) {
      return; // No active session
    }

    // Finalize accumulated time - add any elapsed time since last update
    let finalSeconds = session.accumulatedSeconds;
    if (session.lastUpdateTime) {
      const elapsed = (Date.now() - session.lastUpdateTime) / 1000;
      if (elapsed > 0 && elapsed < 300) { // Sanity check: < 5 minutes
        finalSeconds += elapsed;
      }
    }

    // Capture values and reset IMMEDIATELY to prevent double-commits
    const { trackId, albumId, artist } = session;
    const accumulatedSeconds = finalSeconds;
    listeningSessionRef.current = {
      trackId: null,
      albumId: null,
      artist: null,
      startTime: null,
      accumulatedSeconds: 0,
      lastUpdateTime: null
    };

    // Add to playback history if track ended OR 10+ seconds played
    if (trackEnded || accumulatedSeconds >= 10) {
      onAddToHistoryRef.current?.({ trackId, albumId, artist });
    }

    // Don't record to ledgers if < 5 seconds
    if (accumulatedSeconds < 5) {
      return;
    }

    if (ipcRenderer) {
      ipcRenderer.invoke('record-listen', {
        trackId,
        albumId,
        artist,
        seconds: Math.floor(accumulatedSeconds)
      }).catch(err => {
        console.error('[useAudioPlayer] Error recording listen:', err);
      });
    }
  }, []); // Uses refs, no external dependencies

  // Start a new listening session for a track
  const startListeningSession = useCallback((track) => {
    // Commit any existing session first
    commitListeningSession();

    if (!track) {
      return;
    }

    const trackId = track.id;

    listeningSessionRef.current = {
      trackId: trackId,
      albumId: track.albumId || null,
      artist: track.artist || null,
      startTime: Date.now(),
      accumulatedSeconds: 0,
      lastUpdateTime: Date.now()
    };
    // Mark this track as having a session so onStateChange doesn't double-start
    lastSessionTrackIdRef.current = trackId;
  }, [commitListeningSession]);

  // Update accumulated listening time
  const updateListeningTime = useCallback(() => {
    const session = listeningSessionRef.current;
    if (!session.trackId || !session.lastUpdateTime) return;

    const now = Date.now();
    const elapsed = (now - session.lastUpdateTime) / 1000;

    // Only accumulate if reasonable (< 5 seconds between updates)
    // This prevents counting time when paused
    if (elapsed > 0 && elapsed < 5) {
      session.accumulatedSeconds += elapsed;
    }

    session.lastUpdateTime = now;
  }, []);

  // Handle when a track ends
  const handleTrackEnd = useCallback((endedTrack) => {
    // Commit listening session for ended track (trackEnded = true for history)
    commitListeningSession(true);
    // Notify parent that we need next track
    onQueueAdvanceRef.current?.();
  }, [commitListeningSession]); // Uses ref for onQueueAdvance

  // Keep handleTrackEnd ref updated for use in engine callback
  useEffect(() => {
    handleTrackEndRef.current = handleTrackEnd;
  }, [handleTrackEnd]);

  // Preload next track when queue or position changes
  useEffect(() => {
    const nextIndex = queuePosition + 1;
    if (nextIndex < queue.length) {
      const nextTrack = queue[nextIndex];
      audioEngine.preloadNext(nextTrack);
      setNextTrackReady(false);
    } else {
      audioEngine.preloadNext(null);
    }
  }, [queue, queuePosition]);
  
  // Helper to initialize audio engine with config
  const ensureInitialized = useCallback(async () => {
    if (isInitialized) return;

    let useNativeAudio = true;
    if (ipcRenderer) {
      try {
        const config = await ipcRenderer.invoke('get-library-config');
        useNativeAudio = config?.settings?.useNativeAudio !== false;
      } catch (err) {
        console.warn('[useAudioPlayer] Could not load config:', err);
      }
    }
    await audioEngine.initialize(useNativeAudio);
    setIsInitialized(true);
  }, [isInitialized]);

  // Load and optionally play a specific track
  const loadTrack = useCallback(async (track, autoPlay = true) => {
    // Start new listening session (commits any existing one)
    startListeningSession(track);

    await ensureInitialized();
    await audioEngine.loadAndPlay(track, autoPlay);

    // If auto-playing, initialize timing
    if (autoPlay) {
      listeningSessionRef.current.lastUpdateTime = Date.now();
    }
  }, [ensureInitialized, startListeningSession]);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    await ensureInitialized();
    await audioEngine.togglePlayPause();
  }, [ensureInitialized]);

  // Play
  const play = useCallback(async () => {
    await ensureInitialized();
    await audioEngine.play();
  }, [ensureInitialized]);
  
  // Pause
  const pause = useCallback(() => {
    audioEngine.pause();
  }, []);
  
  // Seek to time
  const seek = useCallback((time) => {
    audioEngine.seek(time);
  }, []);
  
  // Seek by percentage
  const seekPercent = useCallback((percent) => {
    console.log('[useAudioPlayer] seekPercent called:', percent);
    audioEngine.seekPercent(percent);
  }, []);
  
  // Set volume
  const setVolume = useCallback((value) => {
    audioEngine.setVolume(value);
    setVolumeState(value);
  }, []);
  
  // Skip to next track
  const skipNext = useCallback(async () => {
    const nextIndex = queuePosition + 1;
    if (nextIndex < queue.length) {
      const nextTrack = queue[nextIndex];
      // Start new listening session (commits current session first)
      startListeningSession(nextTrack);
      // Play the next track immediately
      await audioEngine.playNext();
      // Notify parent to advance position
      onQueueAdvance?.();
    } else {
      // No more tracks - commit current session before stopping
      commitListeningSession();
      audioEngine.pause();
    }
  }, [queue, queuePosition, onQueueAdvance, startListeningSession, commitListeningSession]);
  
  // Skip to previous (for now, just restart current track)
  // TODO: Implement history for true previous functionality
  const skipPrev = useCallback(() => {
    const audio = audioEngine.getActiveAudio?.();
    if (audio && audio.currentTime > 3) {
      // If more than 3 seconds in, restart the track
      audioEngine.seek(0);
    } else {
      // TODO: Go to previous track from history
      audioEngine.seek(0);
    }
  }, []);
  
  // Stop playback completely (commits session and clears track)
  const stop = useCallback(() => {
    commitListeningSession();
    audioEngine.stop();
  }, [commitListeningSession]);
  
  // Format time helper
  const formatTime = useCallback((seconds) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  return {
    // State
    isPlaying,
    currentTrack,
    currentTime,
    duration,
    volume,
    isInitialized,
    nextTrackReady,
    
    // Formatted values
    currentTimeFormatted: formatTime(currentTime),
    durationFormatted: formatTime(duration),
    progress: duration > 0 ? (currentTime / duration) * 100 : 0,
    
    // Controls
    loadTrack,
    play,
    pause,
    togglePlayPause,
    seek,
    seekPercent,
    setVolume,
    skipNext,
    skipPrev,
    stop,
    spectrumBands,  // 25 bands from FFT analyzer (null when using HTML5 audio)
  };
}

export default useAudioPlayer;
