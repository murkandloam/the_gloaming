import React, { useState, useEffect } from 'react';
import '../styles/TopBar.css';
import TheEye from './TheEye';

function TopBar({
  currentView,
  onViewChange,
  nowPlaying,
  isPlaying,
  progress = 0,
  currentTime = '0:00',
  duration = '0:00',
  onSeek,
  spectrumBands = null  // 25 bands from FFT analyzer (null = use fallback animation)
}) {
  // Tab display names and their corresponding view names
  const tabs = [
    { display: 'RECORDS', view: 'RECORDS' },
    { display: 'CASSETTES', view: 'MIXTAPES' },
    { display: 'PROGRAMS', view: 'PROGRAMS' },
    { display: 'FACETS', view: 'FACETS' },
    { display: 'LEDGERS', view: 'LEDGERS' },
    { display: 'PANOPTICON', view: 'PANOPTICON' },
    { display: 'CONFIGURATION', view: 'CONFIGURATION' }
  ];
  const isPanopticon = currentView === 'PANOPTICON';

  // Handle progress bar click for seeking
  const handleProgressClick = (e) => {
    if (!onSeek) return;
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    onSeek(Math.max(0, Math.min(100, percent)));
  };

  return (
    <div className={`top-bar ${isPanopticon ? 'panopticon-mode' : ''}`}>
      {/* Logo or Eye */}
      <div className="logo-container">
        {isPanopticon ? (
          <TheEye className="app-logo-eye" />
        ) : (
          <div className="app-logo">the_gloaming.</div>
        )}
      </div>
      
      {/* Row 1: Navigation Tabs */}
      <div className="top-bar-row tabs-row">
        {tabs.map((tab, index) => (
          <React.Fragment key={tab.view}>
            <button
              className={`tab-link ${currentView === tab.view ? 'active' : ''} ${tab.view === 'CONFIGURATION' ? 'tab-gear' : ''}`}
              onClick={() => onViewChange(tab.view)}
              title={tab.view === 'CONFIGURATION' ? 'Configuration' : undefined}
            >
              {tab.view === 'CONFIGURATION' ? '⛭' : tab.display}
            </button>
            {index < tabs.length - 1 && <span className="tab-slash">/</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Row 2: EQ Visualizer */}
      <div className="top-bar-row eq-row">
        <EQVisualizer isPlaying={isPlaying} spectrumBands={spectrumBands} />
      </div>

      {/* Row 3: Now Playing Info with times on edges */}
      <div className="top-bar-row info-row">
        <span className="track-time time-current">{currentTime}</span>
        <div className="track-info-center">
          {nowPlaying ? (
            <>
              <span className="top-bar-track-artist">{nowPlaying.artist}</span>
              <span className="track-separator">|</span>
              <span className="top-bar-track-title">{nowPlaying.title}</span>
            </>
          ) : (
            <span className="track-empty">—</span>
          )}
        </div>
        <span className="track-time time-remaining">-{duration}</span>
      </div>

      {/* Progress Bar with Shimmer - Now Clickable */}
      <div className="progress-bar-container" onClick={handleProgressClick}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }}>
            <div className="progress-shimmer"></div>
            <div className="progress-scrubber"></div>
          </div>
          <div className="progress-empty" style={{ width: `${100 - progress}%` }}></div>
        </div>
      </div>
    </div>
  );
}

/**
 * EQ Visualizer - Real FFT spectrum display
 *
 * When spectrumBands (25 bands from Swift FFT) is available, interpolates to 50 bars.
 * Falls back to random animation when native audio isn't available.
 */
function EQVisualizer({ isPlaying, spectrumBands }) {
  // Fallback random bars for HTML5 audio mode
  const [fallbackBars, setFallbackBars] = useState(Array(50).fill(0));

  // Use fallback animation when no spectrum data
  const useRealSpectrum = spectrumBands && Array.isArray(spectrumBands) && spectrumBands.length === 25;

  useEffect(() => {
    // Only run fallback animation if we don't have real spectrum data
    if (useRealSpectrum || !isPlaying) return;

    const interval = setInterval(() => {
      setFallbackBars(prev => prev.map(() => Math.random() * 0.8 + 0.1));
    }, 150);

    return () => clearInterval(interval);
  }, [isPlaying, useRealSpectrum]);

  // Interpolate 25 bands to 50 bars for smoother visual
  const interpolateBands = (bands) => {
    if (!bands || bands.length !== 25) {
      return Array(50).fill(0);
    }

    const result = [];
    for (let i = 0; i < bands.length - 1; i++) {
      result.push(bands[i]);
      // Linear interpolation between adjacent bands
      result.push((bands[i] + bands[i + 1]) / 2);
    }
    result.push(bands[bands.length - 1]);
    // Add one more to reach exactly 50
    result.push(bands[bands.length - 1] * 0.8);
    return result;
  };

  // Get bar heights - either from real spectrum or fallback
  const barValues = useRealSpectrum
    ? interpolateBands(spectrumBands)
    : (isPlaying ? fallbackBars : Array(50).fill(0));

  // Convert 0-1 values to pixel heights (max 24px to match container)
  const maxHeight = 24;
  const minHeight = 2;

  return (
    <div className={`eq-visualizer ${isPlaying ? 'playing' : ''}`}>
      {barValues.map((value, i) => (
        <div
          key={i}
          className="eq-bar"
          style={{
            height: isPlaying
              ? `${Math.max(minHeight, value * maxHeight)}px`
              : `${minHeight}px`
          }}
        />
      ))}
    </div>
  );
}

export default TopBar;
