/**
 * TrackDetailPanel - Full track editing in Panopticon detail panel
 *
 * Replaces TrackManifest modal with inline editing.
 * Features:
 * - Inline editable title/artist (track artist)
 * - Parent record link (album info is read-only, derived from parent)
 * - Listening stats with slider toggle
 * - Lyrics and notes
 * - Ephemera attachments
 * - Reset ledger and delete with confirmation
 */

import React, { useState, useEffect, useCallback } from 'react';
import InlineEditField from './InlineEditField';
import EphemeraBox from './EphemeraBox';
import './TrackDetailPanel.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

function TrackDetailPanel({ track: initialTrack, onUpdate, onDelete, onNavigateToRecord }) {
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetLedgerConfirm, setShowResetLedgerConfirm] = useState(false);
  const [deleteFile, setDeleteFile] = useState(false);
  const [attachments, setAttachments] = useState([]);

  // Load full track data
  useEffect(() => {
    async function loadTrack() {
      if (!ipcRenderer || !initialTrack?.id) {
        setLoading(false);
        return;
      }

      try {
        const result = await ipcRenderer.invoke('panopticon:get-track-detail', {
          trackId: initialTrack.id
        });

        if (result.success) {
          setTrack(result.track);
        }

        // Load attachments for ephemera box
        const trackAttachments = await ipcRenderer.invoke('get-track-attachments', initialTrack.id);
        setAttachments(trackAttachments || []);
      } catch (err) {
        console.error('Failed to load track:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTrack();
  }, [initialTrack?.id]);

  // Handle field updates
  const handleUpdate = useCallback(async (field, value) => {
    if (!ipcRenderer || !track?.id) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:update-track', {
        trackId: track.id,
        updates: { [field]: value }
      });

      if (result.success) {
        setTrack(prev => ({ ...prev, [field]: value }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update track:', err);
    }
  }, [track?.id, onUpdate]);

  // Reload attachments (for EphemeraBox callbacks)
  const reloadAttachments = useCallback(async () => {
    if (!ipcRenderer || !initialTrack?.id) return;
    try {
      const trackAttachments = await ipcRenderer.invoke('get-track-attachments', initialTrack.id);
      setAttachments(trackAttachments || []);
      onUpdate?.();
    } catch (err) {
      console.error('Failed to reload attachments:', err);
    }
  }, [initialTrack?.id, onUpdate]);

  // Handle track deletion
  const handleDelete = async () => {
    if (!ipcRenderer || !track?.id) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:delete-track', {
        trackId: track.id,
        deleteFile
      });

      if (result.success) {
        onDelete?.();
      }
    } catch (err) {
      console.error('Failed to delete track:', err);
    }
  };

  // Handle reset ledger counts for this track
  const handleResetLedger = async () => {
    if (!ipcRenderer || !track?.id) return;

    try {
      const result = await ipcRenderer.invoke('reset-track-listening-stats', track.id);

      if (result.success) {
        setShowResetLedgerConfirm(false);
        // Update local state to reflect reset
        setTrack(prev => ({
          ...prev,
          plays: 0,
          totalListeningTime: 0,
          lastPlayed: null
        }));
      }
    } catch (err) {
      console.error('Failed to reset ledger counts:', err);
    }
  };

  // Format bitrate for display (e.g., 320000 -> "320 kbps")
  const formatBitrate = (bitrate) => {
    if (!bitrate) return '—';
    const kbps = Math.round(bitrate / 1000);
    return `${kbps} kbps`;
  };

  // Reveal track file in Finder
  const handleRevealInFinder = async () => {
    if (!ipcRenderer || !track?.filePath) return;
    try {
      await ipcRenderer.invoke('reveal-in-finder', track.filePath);
    } catch (err) {
      console.error('Failed to reveal in Finder:', err);
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format listening time
  const formatListeningTime = (seconds) => {
    if (!seconds) return '0 min';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  if (loading) {
    return (
      <div className="track-detail-panel">
        <div className="track-detail-loading">Loading...</div>
      </div>
    );
  }

  if (!track) {
    return (
      <div className="track-detail-panel">
        <div className="track-detail-empty">Track not found</div>
      </div>
    );
  }

  const coverUrl = track.coverPath ? `local://${track.coverPath}` : null;

  return (
    <div className="track-detail-panel">
      {/* Header - Large cover with info beside it */}
      <div className="track-detail-header">
        <div className="track-detail-cover-column">
          <div className="track-detail-cover-large">
            {coverUrl ? (
              <img src={coverUrl} alt={track.title} />
            ) : (
              <span className="track-detail-cover-placeholder">🎵</span>
            )}
          </div>
          {track.filePath && (
            <button
              className="track-detail-reveal-btn"
              onClick={handleRevealInFinder}
              title="Reveal in Finder"
            >
              Reveal in Finder
            </button>
          )}
        </div>
        <div className="track-detail-meta">
          <InlineEditField
            value={track.title}
            onChange={(v) => handleUpdate('title', v)}
            placeholder="Untitled Track"
            variant="title"
          />
          <div className="track-detail-info">
            {formatDuration(track.duration)}
            {track.disc && track.trackNumber && ` · Disc ${track.disc}, Track ${track.trackNumber}`}
          </div>
          <div className="track-detail-meta-table">
            <div className="meta-row">
              <span className="meta-label">Track Artist</span>
              <span className="meta-value">
                <InlineEditField
                  value={track.trackArtist}
                  onChange={(v) => handleUpdate('trackArtist', v)}
                  placeholder="Unknown Artist"
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Album</span>
              <span className="meta-value">{track.album || '—'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Album Artist</span>
              <span className="meta-value">{track.albumArtist || '—'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Disc</span>
              <span className="meta-value">
                <InlineEditField
                  value={track.disc?.toString() || ''}
                  onChange={(v) => handleUpdate('disc', v ? parseInt(v, 10) : null)}
                  placeholder="—"
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Track Number</span>
              <span className="meta-value">
                <InlineEditField
                  value={track.trackNumber?.toString() || ''}
                  onChange={(v) => handleUpdate('trackNumber', v ? parseInt(v, 10) : null)}
                  placeholder="—"
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Format</span>
              <span className="meta-value">{track.format || track.codec || '—'}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Bitrate</span>
              <span className="meta-value">{formatBitrate(track.bitrate)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Added</span>
              <span className="meta-value">
                {track.addedAt ? new Date(track.addedAt).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">ID</span>
              <span className="meta-value meta-mono">{track.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Parent record link */}
      {track.parentRecord && (
        <div
          className="track-detail-parent-record"
          onClick={() => onNavigateToRecord?.(track.parentRecord.id)}
          title="Go to parent record"
        >
          <span className="parent-icon">💿</span>
          <div className="parent-info">
            <span className="parent-name">{track.parentRecord.name}</span>
            <span className="parent-artist">{track.parentRecord.artist}</span>
          </div>
          <span className="parent-arrow">→</span>
        </div>
      )}

      {/* Horizontal divider */}
      <div className="track-detail-divider" />

      {/* Two-column layout for stats and visibility */}
      <div className="track-detail-two-col">
        {/* Left column: Listening stats */}
        <div className="track-detail-col">
          <div className="track-detail-section">
            <div className="track-detail-section-title">LISTENING</div>
            <div className="track-detail-stats">
              <div className="stat-row">
                <span className="stat-label">Plays</span>
                <span className="stat-value">{track.plays || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Total Time</span>
                <span className="stat-value">{formatListeningTime(track.totalListeningTime)}</span>
              </div>
              {track.lastPlayed && (
                <div className="stat-row">
                  <span className="stat-label">Last Played</span>
                  <span className="stat-value">{new Date(track.lastPlayed).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="track-detail-col-divider" />

        {/* Right column: Visibility */}
        <div className="track-detail-col">
          <div className="track-detail-section">
            <div className="track-detail-section-title">VISIBILITY</div>
            <label className="track-detail-toggle">
              <input
                type="checkbox"
                checked={track.includeInLedgers !== false}
                onChange={(e) => handleUpdate('includeInLedgers', e.target.checked)}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Include in Ledgers</span>
            </label>
          </div>
        </div>
      </div>

      {/* Horizontal divider */}
      <div className="track-detail-divider" />

      {/* Ephemera */}
      <div className="track-detail-section">
        <div className="track-detail-section-title">EPHEMERA</div>
        <EphemeraBox
          entityType="track"
          entityId={track.id}
          attachments={attachments}
          onAttachmentsChange={reloadAttachments}
          variant="medium"
          showHeader={false}
          showSizeSlider={false}
        />
      </div>

      {/* Metadata footer */}
      <div className="track-detail-section track-detail-meta-footer">
        <div className="meta-row">
          <span className="meta-label">File</span>
          <span className="meta-value meta-mono" title={track.filePath}>
            {track.filename || track.filePath?.split('/').pop() || '—'}
          </span>
        </div>
      </div>

      {/* Dangerous actions */}
      <div className="track-detail-actions">
        <div className="track-detail-danger-buttons">
          {!showResetLedgerConfirm ? (
            <button
              className="track-detail-delete-btn"
              onClick={() => setShowResetLedgerConfirm(true)}
            >
              Reset Ledger Counts for Track
            </button>
          ) : (
            <div className="track-detail-delete-confirm">
              <span>Reset all listening history for this track?</span>
              <div className="delete-confirm-buttons">
                <button onClick={() => setShowResetLedgerConfirm(false)}>Cancel</button>
                <button className="danger" onClick={handleResetLedger}>Reset</button>
              </div>
            </div>
          )}

          {!showDeleteConfirm ? (
            <button
              className="track-detail-delete-btn"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Track
            </button>
          ) : (
            <div className="track-detail-delete-confirm">
              <span>Delete this track from the library?</span>
              <label className="delete-file-option">
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                />
                <span>Also delete audio file from disk</span>
              </label>
              <div className="delete-confirm-buttons">
                <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                <button className="danger" onClick={handleDelete}>Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TrackDetailPanel;
