import React, { useState, useEffect } from 'react';
import '../styles/ImportModal.css';

/**
 * ImportModal - v2 Simplified
 *
 * Shows spinner during import, then either closes (success) or shows error modal.
 * No preview, no decisions - import fast and dumb, fix in Panopticon.
 */
function ImportModal({
  isOpen,
  onClose,
  importPaths,  // Array of paths to import
  onImportComplete
}) {
  const [status, setStatus] = useState('idle'); // idle, importing, complete, error
  const [progress, setProgress] = useState({ stage: '', message: '', progress: 0 });
  const [result, setResult] = useState(null);

  const { ipcRenderer } = window.require ? window.require('electron') : {};

  // Listen for progress updates from main process
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleProgress = (event, data) => {
      setProgress(data);
    };

    ipcRenderer.on('import-progress', handleProgress);

    return () => {
      ipcRenderer.removeListener('import-progress', handleProgress);
    };
  }, [ipcRenderer]);

  // Start import when modal opens with paths
  useEffect(() => {
    if (isOpen && importPaths && importPaths.length > 0 && status === 'idle') {
      startImport();
    }
  }, [isOpen, importPaths]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStatus('idle');
      setProgress({ stage: '', message: '', progress: 0 });
      setResult(null);
    }
  }, [isOpen]);

  const startImport = async () => {
    if (!ipcRenderer || !importPaths || importPaths.length === 0) return;

    setStatus('importing');
    setProgress({ stage: 'starting', message: 'Starting import...', progress: 0 });

    try {
      const result = await ipcRenderer.invoke('import-files', importPaths);
      setResult(result);

      if (result.success || (result.imported > 0 && result.failed === 0)) {
        // Success - notify parent and close
        setStatus('complete');
        if (onImportComplete) {
          onImportComplete(result);
        }
      } else if (result.imported > 0 && result.failed > 0) {
        // Partial success - show error modal
        setStatus('error');
        if (onImportComplete) {
          onImportComplete(result);
        }
      } else {
        // Complete failure
        setStatus('error');
      }
    } catch (err) {
      console.error('Import error:', err);
      setResult({ success: false, error: err.message, imported: 0, failed: 0 });
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'importing') {
      // Don't allow closing during import
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  // Don't show modal for success state - auto close
  if (status === 'complete' && result && !result.errors) {
    // Small delay to let parent handle the result
    setTimeout(() => onClose(), 100);
    return null;
  }

  return (
    <div className="import-modal-overlay" onClick={handleClose}>
      <div className="import-modal import-modal-v2" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="import-modal-header">
          <h2>
            {status === 'importing' && 'Importing...'}
            {status === 'complete' && 'Import Complete'}
            {status === 'error' && 'Import Results'}
          </h2>
          {status !== 'importing' && (
            <button className="import-modal-close" onClick={handleClose}>×</button>
          )}
        </div>

        {/* Content */}
        <div className="import-modal-content">
          {/* Importing state - spinner and progress */}
          {status === 'importing' && (
            <div className="import-progress-section">
              <div className="import-spinner" />
              <div className="import-progress-message">{progress.message}</div>
              {progress.progress > 0 && (
                <div className="import-progress-bar">
                  <div
                    className="import-progress-fill"
                    style={{ width: `${(progress.progress || 0) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error state - show what happened */}
          {status === 'error' && result && (
            <div className="import-results">
              {/* Summary */}
              <div className="import-result-summary">
                {result.imported > 0 && (
                  <div className="import-result-row success">
                    <span className="import-result-icon">✓</span>
                    <span>Successfully imported: {result.imported} track{result.imported !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="import-result-row failure">
                    <span className="import-result-icon">✗</span>
                    <span>Failed: {result.failed} file{result.failed !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {result.error && !result.errors && (
                  <div className="import-error-message">
                    <span className="import-error-icon">❌</span>
                    <span>{result.error}</span>
                  </div>
                )}
              </div>

              {/* Error details */}
              {result.errors && result.errors.length > 0 && (
                <div className="import-errors">
                  <div className="import-errors-title">Failed files:</div>
                  <div className="import-errors-list">
                    {result.errors.map((err, i) => (
                      <div key={i} className="import-error-item">
                        <span className="import-error-file">{err.file}</span>
                        <span className="import-error-reason">{err.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Records affected */}
              {result.records && result.records.length > 0 && (
                <div className="import-records-summary">
                  <div className="import-records-title">Records:</div>
                  {result.records.map((r, i) => (
                    <div key={i} className="import-record-item">
                      {r.isNew ? '+ ' : '→ '}
                      <span className="import-record-name">{r.name}</span>
                      <span className="import-record-artist">{r.artist}</span>
                      <span className="import-record-tracks">({r.trackCount} tracks)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Complete state with some results to show */}
          {status === 'complete' && result && result.records && (
            <div className="import-results">
              <div className="import-result-summary">
                <div className="import-result-row success">
                  <span className="import-result-icon">✓</span>
                  <span>Imported {result.imported} track{result.imported !== 1 ? 's' : ''}</span>
                </div>
              </div>
              {result.records.length > 0 && (
                <div className="import-records-summary">
                  {result.records.map((r, i) => (
                    <div key={i} className="import-record-item">
                      {r.isNew ? '+ ' : '→ '}
                      <span className="import-record-name">{r.name}</span>
                      <span className="import-record-artist">{r.artist}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="import-modal-footer">
          {status !== 'importing' && (
            <button className="modal-btn modal-btn-primary" onClick={handleClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportModal;
