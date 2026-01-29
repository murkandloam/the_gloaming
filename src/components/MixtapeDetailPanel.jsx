/**
 * MixtapeDetailPanel - Mixtape editing in Panopticon detail panel
 *
 * Features:
 * - Inline editable name
 * - Track list with reordering
 * - Cassette selector
 * - Display options
 * - Delete with confirmation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import InlineEditField from './InlineEditField';
import EphemeraBox from './EphemeraBox';
import { getCassetteImage, CASSETTE_COUNT } from '../assets/cassettes';
import './MixtapeDetailPanel.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// Default blur value
const DEFAULT_BLUR = 40;

function MixtapeDetailPanel({ mixtape: initialMixtape, onUpdate, onDelete, onOpenSleeve }) {
  const [mixtape, setMixtape] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCassetteSelector, setShowCassetteSelector] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Display options state
  const [backdropBlur, setBackdropBlur] = useState(DEFAULT_BLUR);
  const [useBackgroundImage, setUseBackgroundImage] = useState(true);
  const [backdropImageId, setBackdropImageId] = useState(null);
  const [allAttachments, setAllAttachments] = useState([]);
  const [imageAttachments, setImageAttachments] = useState([]);

  // Load full mixtape data
  useEffect(() => {
    async function loadMixtape() {
      if (!ipcRenderer || !initialMixtape?.id) {
        setLoading(false);
        return;
      }

      try {
        // Use existing load-mixtapes to get full data
        const mixtapes = await ipcRenderer.invoke('load-mixtapes');
        const fullMixtape = mixtapes.find(m => m.id === initialMixtape.id);

        if (fullMixtape) {
          setMixtape(fullMixtape);
          // Load display options from mixtape
          setBackdropBlur(fullMixtape.backdropBlur ?? DEFAULT_BLUR);
          setUseBackgroundImage(fullMixtape.useBackgroundImage !== false);
          setBackdropImageId(fullMixtape.backdropImageId || null);
        }

        // Load attachments
        const attachments = await ipcRenderer.invoke('get-mixtape-attachments', initialMixtape.id);
        setAllAttachments(attachments || []);
        const images = (attachments || []).filter(att => att.type === 'image');
        setImageAttachments(images);
      } catch (err) {
        console.error('Failed to load mixtape:', err);
      } finally {
        setLoading(false);
      }
    }

    loadMixtape();
  }, [initialMixtape?.id]);

  // Handle field updates
  const handleUpdate = useCallback(async (field, value) => {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:update-mixtape', {
        mixtapeId: mixtape.id,
        updates: { [field]: value }
      });

      if (result.success) {
        setMixtape(prev => ({ ...prev, [field]: value }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update mixtape:', err);
    }
  }, [mixtape?.id, onUpdate]);

  // Reload attachments (for EphemeraBox callbacks)
  const reloadAttachments = useCallback(async () => {
    if (!ipcRenderer || !mixtape?.id) return;
    try {
      const attachments = await ipcRenderer.invoke('get-mixtape-attachments', mixtape.id);
      setAllAttachments(attachments || []);
      const images = (attachments || []).filter(att => att.type === 'image');
      setImageAttachments(images);
      onUpdate?.();
    } catch (err) {
      console.error('Failed to reload attachments:', err);
    }
  }, [mixtape?.id, onUpdate]);

  // Handle track removal from mixtape
  const handleRemoveTrack = async (trackId) => {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      const result = await ipcRenderer.invoke('remove-from-mixtape', {
        mixtapeId: mixtape.id,
        trackId
      });

      if (result.success) {
        setMixtape(prev => ({
          ...prev,
          tracks: prev.tracks.filter(t => t.id !== trackId)
        }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to remove track from mixtape:', err);
    }
  };

  // Handle mixtape deletion
  const handleDelete = async () => {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      const result = await ipcRenderer.invoke('delete-mixtape', mixtape.id);

      if (result.success) {
        onDelete?.();
      }
    } catch (err) {
      console.error('Failed to delete mixtape:', err);
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format total duration
  const formatTotalDuration = () => {
    if (!mixtape?.tracks) return '—';
    const total = mixtape.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const mins = Math.floor(total / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  // Get the cover image (custom cover or cassette)
  const getCoverImage = useCallback(() => {
    if (mixtape?.coverImageId) {
      const coverAttachment = imageAttachments.find(a => a.id === mixtape.coverImageId);
      if (coverAttachment?.path) {
        return `local://${coverAttachment.path}`;
      }
    }
    return getCassetteImage(mixtape?.cassetteIndex || 0);
  }, [mixtape?.coverImageId, mixtape?.cassetteIndex, imageAttachments]);

  // Handle cover image drop
  const handleCoverDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCoverDragOver(false);
    dragCounterRef.current = 0;

    if (!ipcRenderer || !mixtape?.id) return;

    // Check for Panopticon attachment drop (from List View)
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only handle image attachment drops
        if (item.entityType === 'attachment' && item.type?.startsWith('image')) {
          // Link attachment to mixtape if not already linked
          await ipcRenderer.invoke('add-attachment-to-mixtape', {
            mixtapeId: mixtape.id,
            attachmentId: item.id
          });

          // Set as cover image
          await handleUpdate('coverImageId', item.id);

          // Reload attachments
          const attachments = await ipcRenderer.invoke('get-mixtape-attachments', mixtape.id);
          const images = (attachments || []).filter(att => att.type === 'image');
          setImageAttachments(images);
          setAllAttachments(attachments || []);
        }
      } catch (err) {
        console.error('Error setting cover from Panopticon:', err);
      }
      return;
    }

    // Check for internal drag (image path from Panopticon - legacy)
    const imagePath = e.dataTransfer.getData('text/image-path');

    // Check for file drop from Finder
    const files = e.dataTransfer.files;

    let filePath = null;

    if (imagePath) {
      // Internal drag from Panopticon
      filePath = imagePath;
    } else if (files.length > 0) {
      // File drop from Finder - find first image
      for (const file of files) {
        if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name)) {
          filePath = file.path;
          break;
        }
      }
    }

    if (!filePath) return;

    try {
      // Add the image as an attachment
      const addResult = await ipcRenderer.invoke('add-attachment', { filePath });
      if (!addResult.success) {
        console.error('Failed to add attachment:', addResult.error);
        return;
      }

      const attachmentId = addResult.attachment.id;

      // Link attachment to mixtape
      await ipcRenderer.invoke('add-attachment-to-mixtape', {
        mixtapeId: mixtape.id,
        attachmentId
      });

      // Set as cover image
      await handleUpdate('coverImageId', attachmentId);

      // Reload attachments
      const attachments = await ipcRenderer.invoke('get-mixtape-attachments', mixtape.id);
      const images = (attachments || []).filter(att => att.type === 'image');
      setImageAttachments(images);
      setAllAttachments(attachments || []);

    } catch (err) {
      console.error('Error setting cover image:', err);
    }
  }, [mixtape?.id, handleUpdate]);

  const handleCoverDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;

    // Check if it's an image (from Panopticon List View, legacy path, or Finder)
    const hasImage = e.dataTransfer.types.includes('application/x-panopticon-item') ||
                     e.dataTransfer.types.includes('text/image-path') ||
                     e.dataTransfer.types.includes('Files');
    if (hasImage) {
      setCoverDragOver(true);
    }
  }, []);

  const handleCoverDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setCoverDragOver(false);
    }
  }, []);

  const handleCoverDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Clear custom cover
  const handleClearCover = useCallback(async (e) => {
    e.stopPropagation();
    if (!ipcRenderer || !mixtape?.id) return;
    await handleUpdate('coverImageId', null);
  }, [mixtape?.id, handleUpdate]);

  if (loading) {
    return (
      <div className="mixtape-detail-panel">
        <div className="mixtape-detail-loading">Loading...</div>
      </div>
    );
  }

  if (!mixtape) {
    return (
      <div className="mixtape-detail-panel">
        <div className="mixtape-detail-empty">Cassette not found</div>
      </div>
    );
  }

  const tracks = mixtape.tracks || [];

  return (
    <div className="mixtape-detail-panel">
      {/* Header - Larger cassette with info beside it */}
      <div className="mixtape-detail-header">
        <div className="mixtape-detail-cover-column">
          <div
            className={`mixtape-detail-cassette-large ${coverDragOver ? 'drag-over' : ''} ${mixtape.coverImageId ? 'has-custom-cover' : ''}`}
            onClick={() => setShowCassetteSelector(!showCassetteSelector)}
            onDragEnter={handleCoverDragEnter}
            onDragLeave={handleCoverDragLeave}
            onDragOver={handleCoverDragOver}
            onDrop={handleCoverDrop}
            title="Click to change cover, or drop image"
          >
            <img src={getCoverImage()} alt="Cover" />
            {coverDragOver && (
              <div className="cover-drop-overlay">
                <span>Drop to set cover</span>
              </div>
            )}
            {mixtape.coverImageId && (
              <button
                className="cover-clear-btn"
                onClick={handleClearCover}
                title="Remove custom cover"
              >
                ×
              </button>
            )}
          </div>
          {onOpenSleeve && (
            <button
              className="mixtape-detail-open-sleeve-btn"
              onClick={() => onOpenSleeve({ ...mixtape, entityType: 'mixtape' })}
              title={`Open sleeve for ${mixtape.name}`}
            >
              Open J-Card...
            </button>
          )}
        </div>
        <div className="mixtape-detail-meta">
          <InlineEditField
            value={mixtape.name}
            onChange={(v) => handleUpdate('name', v)}
            placeholder="Untitled Cassette"
            variant="title"
          />
          <div className="mixtape-detail-info">
            {tracks.length} track{tracks.length !== 1 ? 's' : ''} · {formatTotalDuration()}
          </div>
          <div className="mixtape-detail-meta-table">
            <div className="meta-row">
              <span className="meta-label">Created</span>
              <span className="meta-value">
                {mixtape.createdAt ? new Date(mixtape.createdAt).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">ID</span>
              <span className="meta-value meta-mono">{mixtape.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cassette selector */}
      {showCassetteSelector && (
        <div className="mixtape-cassette-selector">
          <div className="cassette-selector-title">Choose Tape</div>
          <div className="cassette-selector-grid">
            {Array.from({ length: CASSETTE_COUNT }, (_, i) => (
              <button
                key={i}
                className={`cassette-option ${!mixtape.coverImageId && mixtape.cassetteIndex === i ? 'active' : ''}`}
                onClick={async () => {
                  // Clear custom cover if set, then set cassette index
                  if (mixtape.coverImageId) {
                    await handleUpdate('coverImageId', null);
                  }
                  await handleUpdate('cassetteIndex', i);
                  setShowCassetteSelector(false);
                }}
              >
                <img src={getCassetteImage(i)} alt={`Cassette ${i + 1}`} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="mixtape-detail-section">
        <div className="mixtape-detail-section-title">DESCRIPTION</div>
        <textarea
          className="mixtape-detail-textarea"
          value={mixtape.description || ''}
          onChange={(e) => handleUpdate('description', e.target.value)}
          placeholder="Add a description..."
          rows={3}
        />
      </div>

      {/* Track list */}
      <div className="mixtape-detail-section">
        <div className="mixtape-detail-section-title">TRACKS</div>
        <div className="mixtape-detail-track-list">
          {tracks.length === 0 ? (
            <div className="mixtape-detail-empty-tracks">No tracks yet</div>
          ) : (
            tracks.map((track, index) => (
              <div key={track.id} className="mixtape-detail-track">
                <span className="track-number">{index + 1}</span>
                <div className="track-info">
                  <span className="track-title">{track.title}</span>
                  <span className="track-artist">{track.artist}</span>
                </div>
                <span className="track-duration">{formatDuration(track.duration)}</span>
                <button
                  className="track-remove-btn"
                  onClick={() => handleRemoveTrack(track.id)}
                  title="Remove from cassette"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Horizontal divider after tracks */}
      <div className="mixtape-detail-divider" />

      {/* Display / Sleeve Backdrop Options */}
      <div className="mixtape-detail-section">
        <div className="mixtape-detail-section-title">SLEEVE BACKDROP</div>
        <label className="mixtape-detail-toggle">
          <input
            type="checkbox"
            checked={useBackgroundImage}
            onChange={(e) => {
              setUseBackgroundImage(e.target.checked);
              handleUpdate('useBackgroundImage', e.target.checked);
            }}
          />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">Use art as backdrop</span>
        </label>

        {useBackgroundImage && (
          <>
            {/* Blur preview */}
            <div className="mixtape-detail-blur-section">
              <div className="mixtape-detail-blur-label">Backdrop Blur</div>
              <div className="mixtape-detail-blur-preview">
                <img
                  src={backdropImageId
                    ? `local://${imageAttachments.find(a => a.id === backdropImageId)?.path}`
                    : getCassetteImage(mixtape.cassetteIndex || 0)
                  }
                  alt=""
                  style={{ filter: `blur(${backdropBlur}px) brightness(0.35) saturate(1.3)` }}
                />
                <div className="mixtape-detail-blur-preview-overlay">Preview</div>
              </div>
              <div className="mixtape-detail-blur-slider">
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={backdropBlur}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setBackdropBlur(val);
                    handleUpdate('backdropBlur', val);
                  }}
                />
                <span className="blur-value">{backdropBlur}px</span>
              </div>
            </div>

            {/* Backdrop image picker */}
            {imageAttachments.length > 0 && (
              <div className="mixtape-detail-field-row">
                <span className="field-label">Backdrop</span>
                <select
                  className="mixtape-detail-select"
                  value={backdropImageId || ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    setBackdropImageId(val);
                    handleUpdate('backdropImageId', val);
                  }}
                >
                  <option value="">Cassette Image</option>
                  {imageAttachments.map(att => (
                    <option key={att.id} value={att.id}>
                      {att.originalName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Horizontal divider after backdrop */}
      <div className="mixtape-detail-divider" />

      {/* Ephemera */}
      <div className="mixtape-detail-section">
        <div className="mixtape-detail-section-title">EPHEMERA</div>
        <EphemeraBox
          entityType="mixtape"
          entityId={mixtape.id}
          attachments={allAttachments}
          onAttachmentsChange={reloadAttachments}
          variant="medium"
          showHeader={false}
          showSizeSlider={false}
        />
      </div>

      {/* Delete button */}
      <div className="mixtape-detail-actions">
        {!showDeleteConfirm ? (
          <button
            className="mixtape-detail-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Cassette
          </button>
        ) : (
          <div className="mixtape-detail-delete-confirm">
            <span>Delete this cassette? Tracks will not be affected.</span>
            <div className="delete-confirm-buttons">
              <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MixtapeDetailPanel;
