import React, { useState, useEffect } from 'react';
import ManifestModal, {
  ManifestField,
  ManifestInput,
  ManifestTextarea,
  ManifestToggle,
  ManifestSlider,
  ManifestDivider,
  ManifestActions,
  ManifestButton
} from './ManifestModal';
import { getCassetteImage, CASSETTE_COUNT } from '../assets/cassettes';
import './MixtapeManifest.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

/**
 * MixtapeManifest - Modal for editing mixtape metadata
 * Follows the same pattern as AlbumManifest
 */
function MixtapeManifest({
  isOpen,
  onClose,
  mixtape,
  onSave,
  onDelete
}) {
  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cassetteIndex, setCassetteIndex] = useState(0);
  const [coverImageId, setCoverImageId] = useState(null);
  const [useBackgroundImage, setUseBackgroundImage] = useState(true);
  const [backdropBlur, setBackdropBlur] = useState(40);
  const [backdropImageId, setBackdropImageId] = useState(null);
  const [imageAttachments, setImageAttachments] = useState([]);

  // State tracking
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Load mixtape data when opened
  useEffect(() => {
    if (mixtape && isOpen) {
      loadImageAttachments();

      setName(mixtape.name || '');
      setDescription(mixtape.description || '');
      setCassetteIndex(mixtape.cassetteIndex ?? 0);
      setCoverImageId(mixtape.coverImageId || null);
      setUseBackgroundImage(mixtape.useBackgroundImage !== false);
      setBackdropBlur(mixtape.backdropBlur ?? 40);
      setBackdropImageId(mixtape.backdropImageId || null);
      setIsDirty(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
    }
  }, [mixtape, isOpen]);

  // Load image attachments for pickers
  async function loadImageAttachments() {
    if (!ipcRenderer || !mixtape?.id) return;
    try {
      const attachments = await ipcRenderer.invoke('get-mixtape-attachments', mixtape.id);
      const images = (attachments || []).filter(att => att.type === 'image');
      setImageAttachments(images);
    } catch (err) {
      console.error('Error loading image attachments:', err);
      setImageAttachments([]);
    }
  }

  // Mark as dirty when any field changes
  const handleFieldChange = (setter) => (value) => {
    setter(value);
    setIsDirty(true);
  };

  // Cassette navigation
  function handlePrevCassette() {
    const newIndex = (cassetteIndex - 1 + CASSETTE_COUNT) % CASSETTE_COUNT;
    setCassetteIndex(newIndex);
    setIsDirty(true);
  }

  function handleNextCassette() {
    const newIndex = (cassetteIndex + 1) % CASSETTE_COUNT;
    setCassetteIndex(newIndex);
    setIsDirty(true);
  }

  // Handle save
  const handleSave = async () => {
    if (!mixtape?.id || !ipcRenderer) return;

    setIsSaving(true);

    try {
      const updates = {
        name: name.trim(),
        description: description.trim() || null,
        cassetteIndex,
        coverImageId: coverImageId || null,
        useBackgroundImage,
        backdropBlur,
        backdropImageId: backdropImageId || null
      };

      const result = await ipcRenderer.invoke('update-mixtape', {
        mixtapeId: mixtape.id,
        updates
      });

      if (result.success) {
        setIsDirty(false);
        onSave?.(result.mixtape);
        onClose();
      }
    } catch (err) {
      console.error('Error saving mixtape:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!mixtape?.id || !ipcRenderer) return;
    if (deleteConfirmText.toUpperCase() !== 'DELETE') return;

    try {
      const result = await ipcRenderer.invoke('delete-mixtape', mixtape.id);
      if (result.success) {
        onDelete?.(mixtape.id);
        onClose();
      }
    } catch (err) {
      console.error('Error deleting mixtape:', err);
    }
  };

  // Handle custom cover change
  const handleChangeCover = async () => {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      const result = await ipcRenderer.invoke('show-attachment-picker');
      if (!result.canceled && result.paths.length > 0) {
        const filePath = result.paths[0];
        const addResult = await ipcRenderer.invoke('add-attachment', { filePath });
        if (addResult.success) {
          await ipcRenderer.invoke('add-attachment-to-mixtape', {
            mixtapeId: mixtape.id,
            attachmentId: addResult.attachment.id
          });
          // Set as cover
          setCoverImageId(addResult.attachment.id);
          setIsDirty(true);
          // Add the new attachment to state immediately so preview works
          setImageAttachments(prev => [...prev, addResult.attachment]);
        }
      }
    } catch (err) {
      console.error('Error adding cover:', err);
    }
  };

  // Get preview images
  const cassetteImage = getCassetteImage(cassetteIndex);
  const customCoverPath = coverImageId
    ? imageAttachments.find(a => a.id === coverImageId)?.path
    : null;
  const coverPreview = customCoverPath ? `local://${customCoverPath}` : cassetteImage;

  const customBackdropPath = backdropImageId
    ? imageAttachments.find(a => a.id === backdropImageId)?.path
    : null;
  const backdropPreview = customBackdropPath ? `local://${customBackdropPath}` : coverPreview;

  if (!mixtape) return null;

  return (
    <ManifestModal
      isOpen={isOpen}
      onClose={onClose}
      title="Cassette Manifest"
      width="520px"
    >
      {/* Cover Preview & Cassette Selector */}
      <div className="mixtape-manifest-header">
        <div className="mixtape-manifest-cover-area">
          <div className="mixtape-manifest-cover-preview">
            <img src={coverPreview} alt={name} />
          </div>
          <div className="mixtape-manifest-cover-controls">
            {/* Cassette picker */}
            <div className="cassette-picker-row">
              <button className="cassette-nav-btn" onClick={handlePrevCassette}>‹</button>
              <span className="cassette-index">{cassetteIndex + 1} / {CASSETTE_COUNT}</span>
              <button className="cassette-nav-btn" onClick={handleNextCassette}>›</button>
            </div>
            <ManifestButton variant="default" onClick={handleChangeCover}>
              Custom Cover
            </ManifestButton>
            {coverImageId && (
              <ManifestButton
                variant="subtle"
                onClick={() => { setCoverImageId(null); setIsDirty(true); }}
              >
                Use Cassette
              </ManifestButton>
            )}
          </div>
        </div>
      </div>

      {/* Name */}
      <ManifestField label="Name">
        <ManifestInput
          value={name}
          onChange={handleFieldChange(setName)}
          placeholder="Cassette name"
        />
      </ManifestField>

      {/* Description */}
      <ManifestField label="Description">
        <ManifestTextarea
          value={description}
          onChange={handleFieldChange(setDescription)}
          placeholder="Songs for the highway after midnight..."
          rows={3}
        />
      </ManifestField>

      <ManifestDivider />

      {/* Display Options */}
      <div className="manifest-section-title">Display Options</div>

      <div className="manifest-toggles-row">
        <ManifestToggle
          checked={useBackgroundImage}
          onChange={handleFieldChange(setUseBackgroundImage)}
          label="Use art as sleeve backdrop"
        />
      </div>

      {useBackgroundImage && (
        <>
          <ManifestField label="Backdrop Blur">
            <div className="manifest-blur-preview">
              <img
                src={backdropPreview}
                alt=""
                style={{ filter: `blur(${backdropBlur}px) brightness(0.35) saturate(1.3)` }}
              />
              <div className="manifest-blur-preview-overlay">Preview</div>
            </div>
            <ManifestSlider
              value={backdropBlur}
              onChange={handleFieldChange(setBackdropBlur)}
              min={0}
              max={80}
              showValue
            />
          </ManifestField>

          {imageAttachments.length > 0 && (
            <ManifestField label="Backdrop Image">
              <select
                className="manifest-select"
                value={backdropImageId || ''}
                onChange={(e) => handleFieldChange(setBackdropImageId)(e.target.value || null)}
              >
                <option value="">Cover Image</option>
                {imageAttachments.map(att => (
                  <option key={att.id} value={att.id}>
                    {att.originalName}
                  </option>
                ))}
              </select>
            </ManifestField>
          )}
        </>
      )}

      <ManifestDivider />

      {/* Actions */}
      <ManifestActions>
        {!showDeleteConfirm ? (
          <>
            <ManifestButton variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete
            </ManifestButton>
            <div className="manifest-actions-right">
              <ManifestButton variant="secondary" onClick={onClose}>
                Cancel
              </ManifestButton>
              <ManifestButton
                variant="primary"
                onClick={handleSave}
                disabled={!name.trim() || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </ManifestButton>
            </div>
          </>
        ) : (
          <div className="manifest-delete-confirm">
            <p>Type DELETE to confirm:</p>
            <ManifestInput
              value={deleteConfirmText}
              onChange={setDeleteConfirmText}
              placeholder="DELETE"
            />
            <div className="manifest-delete-actions">
              <ManifestButton variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </ManifestButton>
              <ManifestButton
                variant="danger"
                onClick={handleDelete}
                disabled={deleteConfirmText.toUpperCase() !== 'DELETE'}
              >
                Confirm Delete
              </ManifestButton>
            </div>
          </div>
        )}
      </ManifestActions>
    </ManifestModal>
  );
}

export default MixtapeManifest;
