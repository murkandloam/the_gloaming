/**
 * DeleteRecordModal - Confirmation modal for deleting records
 *
 * Provides options for what to do with tracks:
 * - Keep as strays (default) - tracks remain in library, unassigned
 * - Delete from disk - permanently removes track files
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import './ManifestModal.css'; // Reuse ManifestModal styles

const { ipcRenderer } = window.require ? window.require('electron') : {};

function DeleteRecordModal({
  isOpen,
  onClose,
  record,
  onDeleted
}) {
  const [deleteOption, setDeleteOption] = useState('strays'); // 'strays' | 'disk'
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDeleteOption('strays');
      setIsDeleting(false);
    }
  }, [isOpen]);

  // Global ESC handler
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const handleDelete = async () => {
    if (!ipcRenderer || !record?.id || isDeleting) return;

    setIsDeleting(true);

    try {
      const result = await ipcRenderer.invoke('panopticon:delete-record', {
        recordId: record.id,
        deleteTracksFromDisk: deleteOption === 'disk'
      });

      if (result.success) {
        onDeleted?.();
        onClose();
      } else {
        console.error('Failed to delete record:', result.error);
        setIsDeleting(false);
      }
    } catch (err) {
      console.error('Failed to delete record:', err);
      setIsDeleting(false);
    }
  };

  if (!isOpen || !record) return null;

  const trackCount = record.tracks?.length || 0;

  return ReactDOM.createPortal(
    <div className="manifest-overlay" onClick={onClose}>
      <div
        className="manifest-modal"
        onClick={e => e.stopPropagation()}
        style={{ width: '440px', maxWidth: '90%' }}
      >
        <div className="manifest-header">
          <h2 className="manifest-title">Delete Record</h2>
          <button className="manifest-close" onClick={onClose}>×</button>
        </div>

        <div className="manifest-content">
          <p style={{
            color: 'var(--text-primary, #e8dcc8)',
            fontSize: '14px',
            marginBottom: '16px'
          }}>
            Are you sure you want to delete <strong>{record.name || record.title}</strong>?
          </p>

          {trackCount > 0 && (
            <div className="manifest-field">
              <label className="manifest-label">
                This record has {trackCount} track{trackCount !== 1 ? 's' : ''}
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                <label className="manifest-toggle" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={deleteOption === 'strays'}
                    onChange={() => setDeleteOption('strays')}
                    style={{ display: 'none' }}
                  />
                  <span
                    className="toggle-track"
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: deleteOption === 'strays'
                        ? 'var(--accent-amber, #d4843a)'
                        : 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid var(--border-light, rgba(107, 84, 68, 0.4))',
                      flexShrink: 0,
                      marginTop: '2px'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{
                      fontSize: '13px',
                      color: 'var(--text-primary, #e8dcc8)',
                      fontWeight: deleteOption === 'strays' ? '600' : '400'
                    }}>
                      Keep as strays
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-tertiary, #8b7355)'
                    }}>
                      Tracks remain in your library, unassigned
                    </span>
                  </div>
                </label>

                <label className="manifest-toggle" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={deleteOption === 'disk'}
                    onChange={() => setDeleteOption('disk')}
                    style={{ display: 'none' }}
                  />
                  <span
                    className="toggle-track"
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: deleteOption === 'disk'
                        ? 'rgba(180, 60, 60, 0.8)'
                        : 'rgba(0, 0, 0, 0.4)',
                      border: deleteOption === 'disk'
                        ? '1px solid rgba(180, 60, 60, 0.8)'
                        : '1px solid var(--border-light, rgba(107, 84, 68, 0.4))',
                      flexShrink: 0,
                      marginTop: '2px'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{
                      fontSize: '13px',
                      color: deleteOption === 'disk' ? '#e08080' : 'var(--text-primary, #e8dcc8)',
                      fontWeight: deleteOption === 'disk' ? '600' : '400'
                    }}>
                      Delete from disk
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-tertiary, #8b7355)'
                    }}>
                      Permanently delete track files. Cannot be undone.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="manifest-actions">
          <button
            className="manifest-button default"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            className="manifest-button danger"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Record'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default DeleteRecordModal;
