import React, { useState, useEffect, useRef } from 'react';
import ManifestModal, {
  ManifestField,
  ManifestInput,
  ManifestActions,
  ManifestButton
} from './ManifestModal';

const { ipcRenderer } = window.require ? window.require('electron') : {};

/**
 * NascentSleeveModal - Create a new empty record
 * Part of Murk & Loam Ordinator Applications
 */
function NascentSleeveModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const nameInputRef = useRef(null);

  // Focus name input when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setArtist('');
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const canCreate = name.trim() && artist.trim() && !creating;

  async function handleCreate() {
    if (!canCreate || !ipcRenderer) return;

    try {
      setCreating(true);
      setError(null);

      const result = await ipcRenderer.invoke('panopticon:create-record', {
        name: name.trim(),
        artist: artist.trim()
      });

      if (result.success) {
        onCreated?.(result.recordId);
        onClose();
      } else {
        setError(result.error || 'Failed to create record');
      }
    } catch (err) {
      console.error('Error creating record:', err);
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && canCreate) {
      e.preventDefault();
      handleCreate();
    }
  }

  return (
    <ManifestModal
      isOpen={isOpen}
      onClose={onClose}
      title="Nascent Sleeve"
      width="400px"
    >
      <ManifestField label="Title">
        <input
          ref={nameInputRef}
          type="text"
          className="manifest-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Album title"
          disabled={creating}
        />
      </ManifestField>

      <ManifestField label="Album Artist">
        <input
          type="text"
          className="manifest-input"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Artist name"
          disabled={creating}
        />
      </ManifestField>

      {error && (
        <div className="manifest-error" style={{ color: 'var(--error)', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <ManifestActions>
        <ManifestButton onClick={onClose} disabled={creating}>
          Cancel
        </ManifestButton>
        <ManifestButton
          variant="primary"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {creating ? 'Creating...' : 'Create Record'}
        </ManifestButton>
      </ManifestActions>
    </ManifestModal>
  );
}

export default NascentSleeveModal;
