import React from 'react';
import murkandloamLogo from '../assets/murkandloam.png';
import '../styles/ConfigurationView.css';

function ConfigurationView({ showAlbumLabels, onShowAlbumLabelsChange, visualizerSync, onVisualizerSyncChange, onReturnToFoyer }) {
  return (
    <div className="configuration-view">
      <div className="configuration-content">
        {/* APPEARANCE */}
        <div className="config-panel">
          <div className="config-header">appearance</div>
          <div className="config-divider" />
          <label className="config-checkbox">
            <input
              type="checkbox"
              checked={showAlbumLabels}
              onChange={(e) => onShowAlbumLabelsChange(e.target.checked)}
            />
            <span className="checkbox-box" />
            <span className="checkbox-content">
              <span className="checkbox-label">Show record titles on grid</span>
              <span className="checkbox-description">Display title and artist beneath album covers</span>
            </span>
          </label>
        </div>

        {/* PLAYBACK */}
        <div className="config-panel">
          <div className="config-header">playback</div>
          <div className="config-divider" />
          <div className="config-setting">
            <span className="setting-label">Visualizer Sync</span>
            <div className="slider-row">
              <input
                type="range"
                min="0"
                max="300"
                step="5"
                value={visualizerSync}
                onChange={(e) => onVisualizerSyncChange(Number(e.target.value))}
                className="config-slider"
              />
              <span className="slider-value">{visualizerSync}ms</span>
            </div>
            <span className="setting-description">
              Adjust if the visualizer appears out of sync with the audio.
              Increase for Bluetooth or high-latency setups.
            </span>
          </div>
        </div>

        {/* LIBRARY */}
        <div className="config-panel">
          <div className="config-header">library</div>
          <div className="config-divider" />
          <button className="config-btn" onClick={onReturnToFoyer}>
            Return to Foyer for Library Switching
          </button>
        </div>

        {/* ABOUT */}
        <div className="config-panel about-panel">
          <div className="config-header">about</div>
          <div className="config-divider" />
          <div className="about-content">
            <img src={murkandloamLogo} alt="Murk & Loam" className="about-logo" />
            <div className="about-app-name">the_gloaming</div>
            <div className="about-version">Version 1.0</div>
            <div className="about-tagline">Music is a place.</div>
            <div className="about-waveform">░░░░░▒▒▒▒▒▓▓▓▓▓████████▓▓▓▓▓▒▒▒▒▒░░░░░</div>
            <div className="about-immortalite">immortalité</div>
            <div className="about-founders">Jerome Murk (1932–2009) · Humphrey Loam (1929–2003)</div>
            <div className="about-company">Murk & Loam Ordinator Applications</div>
            <div className="about-established">Est. 198؏</div>
            <div className="about-coda">The work continues.</div>
            <div className="about-credits">This iteration created by Elara, Lorelai, Reel, and Claude Code.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigurationView;
