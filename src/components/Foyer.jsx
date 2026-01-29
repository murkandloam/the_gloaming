/**
 * The Foyer - Welcome screen for The Gloaming
 *
 * Appears on launch when no library is open. Introduces the philosophy,
 * offers library creation/selection, and sets the tone for everything that follows.
 */

import React, { useState, useEffect, useRef } from 'react';
import '../styles/Foyer.css';
import murkAndLoamLogo from '../assets/murkandloam.png';
import foyerAmbientMusic from '../assets/murkandloam.mp3';

const { ipcRenderer } = window.require('electron');

// Foyer Visualizer - displays spectrum bars above IMMORTALITÉ
function FoyerVisualizer({ spectrumBands, isPlaying }) {
  const barCount = 50;

  // Interpolate 25 bands to 50 bars
  const interpolatedBars = [];
  if (spectrumBands && spectrumBands.length > 0) {
    for (let i = 0; i < barCount; i++) {
      const position = (i / barCount) * (spectrumBands.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(lower + 1, spectrumBands.length - 1);
      const fraction = position - lower;
      const value = spectrumBands[lower] * (1 - fraction) + spectrumBands[upper] * fraction;
      interpolatedBars.push(value);
    }
  } else {
    // Default to minimum height bars
    for (let i = 0; i < barCount; i++) {
      interpolatedBars.push(0);
    }
  }

  return (
    <div className={`foyer-visualizer ${isPlaying ? 'playing' : ''}`}>
      {interpolatedBars.map((value, index) => {
        const height = Math.max(2, Math.round(value * 24));
        return (
          <div
            key={index}
            className="foyer-eq-bar"
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

function Foyer({ onLibraryReady }) {
  const [mode, setMode] = useState('choose'); // 'choose' | 'create'
  const [libraryName, setLibraryName] = useState('');
  const [selectedPath, setSelectedPath] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [knownLibraries, setKnownLibraries] = useState([]);
  const [shunFoyer, setShunFoyer] = useState(false);

  // Audio state for ambient music
  const [spectrumBands, setSpectrumBands] = useState([]);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Initialize ambient audio on mount
  useEffect(() => {
    const audio = new Audio(foyerAmbientMusic);
    audio.volume = 0.5;
    audioRef.current = audio;

    // Set up Web Audio API for spectrum analysis
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    // Start spectrum animation
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateSpectrum = () => {
      analyser.getByteFrequencyData(dataArray);
      const bands = [];
      const binCount = dataArray.length;
      const bandsNeeded = 25;
      for (let i = 0; i < bandsNeeded; i++) {
        const startBin = Math.floor((i / bandsNeeded) * binCount);
        const endBin = Math.floor(((i + 1) / bandsNeeded) * binCount);
        let sum = 0;
        for (let j = startBin; j < endBin; j++) {
          sum += dataArray[j];
        }
        bands.push((sum / (endBin - startBin)) / 255);
      }
      setSpectrumBands(bands);
      animationFrameRef.current = requestAnimationFrame(updateSpectrum);
    };

    // Handle track ending
    audio.addEventListener('ended', () => {
      setIsAudioPlaying(false);
    });

    // Start playback
    audio.play();
    setIsAudioPlaying(true);
    updateSpectrum();

    // Cleanup on unmount
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Load known libraries and shun preference on mount
  useEffect(() => {
    const loadPrefs = async () => {
      const prefs = await ipcRenderer.invoke('get-foyer-preferences');
      setKnownLibraries(prefs.knownLibraries || []);
      setShunFoyer(prefs.shunFoyer || false);
    };
    loadPrefs();
  }, []);

  // Handle "Create New Library" flow
  const handleCreateNew = () => {
    setMode('create');
    setError(null);
  };

  // Handle folder selection for new library
  const handleSelectFolder = async () => {
    const result = await ipcRenderer.invoke('show-folder-picker', {
      title: 'Choose Library Location',
      message: 'Select where to create your library folder',
      buttonLabel: 'Choose Location'
    });

    if (!result.canceled && result.path) {
      setSelectedPath(result.path);
    }
  };

  // Handle library creation
  const handleCreate = async () => {
    if (!libraryName.trim()) {
      setError('Please give your library a name');
      return;
    }
    if (!selectedPath) {
      setError('Please select a location for your library');
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await ipcRenderer.invoke('create-library', {
      name: libraryName.trim(),
      parentPath: selectedPath
    });

    setIsLoading(false);

    if (result.success) {
      onLibraryReady(result.libraryInfo);
    } else {
      setError(result.error);
    }
  };

  // Handle "Open Existing Library" flow
  const handleOpenExisting = async () => {
    setIsLoading(true);
    setError(null);

    const pickerResult = await ipcRenderer.invoke('show-folder-picker', {
      title: 'Open Library',
      message: 'Select your .library folder',
      buttonLabel: 'Open Library'
    });

    if (pickerResult.canceled) {
      setIsLoading(false);
      return;
    }

    const result = await ipcRenderer.invoke('open-library', pickerResult.path);
    setIsLoading(false);

    if (result.success) {
      onLibraryReady(result.libraryInfo);
    } else {
      setError(result.error);
    }
  };

  // Handle clicking a known library
  const handleOpenKnownLibrary = async (library) => {
    setIsLoading(true);
    setError(null);

    const result = await ipcRenderer.invoke('open-library', library.path);
    setIsLoading(false);

    if (result.success) {
      onLibraryReady(result.libraryInfo);
    } else {
      // Library doesn't exist anymore - offer to remove it
      setError(`Library not found at ${library.path}`);
      // Remove from known libraries
      const updated = knownLibraries.filter(l => l.path !== library.path);
      setKnownLibraries(updated);
      await ipcRenderer.invoke('update-known-libraries', updated);
    }
  };

  // Handle shun checkbox change
  const handleShunChange = async (e) => {
    const checked = e.target.checked;
    setShunFoyer(checked);
    await ipcRenderer.invoke('set-shun-foyer', checked);
  };

  // Back to choose mode
  const handleBack = () => {
    setMode('choose');
    setLibraryName('');
    setSelectedPath(null);
    setError(null);
  };

  return (
    <div className="foyer">
      <div className="foyer-content">
        {/* Logo */}
        <div className="foyer-logo">
          <div className="foyer-logo-placeholder">the_gloaming.</div>
        </div>

        {/* Panel 1: Philosophy */}
        <div className="foyer-panel">
          <div className="foyer-panel-header">welcome</div>
          <div className="foyer-panel-divider" />
          <div className="foyer-copy">
            <p>
              You hold in your hands an application called the_gloaming, a gallery hall awaiting your keen curatorial attention.
            </p>
            <p>
              This application is not a streaming platform and thanks you for eschewing the comparison at its very kernel, for the notion of a subscription gnaws at something within us of dwindling reserve.
            </p>
            <p>
              We at Murk & Loam Ordinator Applications believe in music not as a decorative tissue box or a scented fucking candle, but as <em>a place</em>. A place you can go. Allow the_gloaming to be your chauffeur.
            </p>
            <p>
              Begin by creating a library with the leftmost option of the following selections. The music you collect will be stored within.
            </p>
          </div>
        </div>

        {/* Panel 2: Library Selection */}
        <div className="foyer-panel">
          <div className="foyer-panel-header">library</div>
          <div className="foyer-panel-divider" />

          {/* Choose mode */}
          {mode === 'choose' && (
            <>
              {/* Primary Buttons */}
              <div className="foyer-buttons">
                <button
                  className="foyer-btn primary"
                  onClick={handleCreateNew}
                  disabled={isLoading}
                >
                  Create New Library
                </button>
                <button
                  className="foyer-btn"
                  onClick={handleOpenExisting}
                  disabled={isLoading}
                >
                  Open Existing Library
                </button>
              </div>

              {/* Known Libraries List */}
              {knownLibraries.length > 0 && (
                <div className="foyer-known-libraries">
                  <div className="foyer-known-header">previously detected libraries</div>
                  {knownLibraries.map((library, index) => (
                    <button
                      key={library.path || index}
                      className="foyer-library-item"
                      onClick={() => handleOpenKnownLibrary(library)}
                      disabled={isLoading}
                    >
                      {library.name}
                    </button>
                  ))}
                </div>
              )}

              {error && <div className="foyer-error">{error}</div>}
            </>
          )}

          {/* Create mode */}
          {mode === 'create' && (
            <div className="foyer-create">
              <div className="foyer-field">
                <label className="foyer-label">Library Name</label>
                <input
                  type="text"
                  className="foyer-input"
                  placeholder="My Music Library"
                  value={libraryName}
                  onChange={(e) => setLibraryName(e.target.value)}
                  autoFocus
                />
                <p className="foyer-hint">This will create a "{libraryName || 'Your Name'}.library" folder</p>
              </div>

              <div className="foyer-field">
                <label className="foyer-label">Location</label>
                <div className="foyer-path-row">
                  <span className="foyer-path">
                    {selectedPath || 'No location selected'}
                  </span>
                  <button
                    className="foyer-btn small"
                    onClick={handleSelectFolder}
                  >
                    Browse...
                  </button>
                </div>
              </div>

              {error && <div className="foyer-error">{error}</div>}

              <div className="foyer-actions">
                <button
                  className="foyer-btn"
                  onClick={handleBack}
                  disabled={isLoading}
                >
                  Back
                </button>
                <button
                  className="foyer-btn primary"
                  onClick={handleCreate}
                  disabled={isLoading || !libraryName.trim() || !selectedPath}
                >
                  {isLoading ? 'Creating...' : 'Create Library'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Panel 3: Visualizer & About */}
        <div className="foyer-panel foyer-panel-about">
          <div className="foyer-panel-header">about</div>
          <div className="foyer-panel-divider" />

          {/* Visualizer */}
          <FoyerVisualizer spectrumBands={spectrumBands} isPlaying={isAudioPlaying} />

          {/* Immortalité */}
          <div className="foyer-immortalite">
            ௵   I M M O R T A L I T É   ௸
          </div>

          {/* Footer */}
          <div className="foyer-footer">
            <img src={murkAndLoamLogo} alt="Murk & Loam" className="foyer-footer-logo" />
            <div className="foyer-footer-text">
              <p>Jerome Murk (1932–2009) • Humphrey Loam (1929–2003)</p>
              <p>The work continues.</p>
            </div>
          </div>
          <div className="foyer-company">
            Murk & Loam Ordinator Applications • Est. 198؏
          </div>
        </div>

        {/* Shun Checkbox */}
        <label className="foyer-shun">
          <input
            type="checkbox"
            checked={shunFoyer}
            onChange={handleShunChange}
          />
          <span>Shun Foyer on subsequent initiations</span>
        </label>
      </div>
    </div>
  );
}

export default Foyer;
