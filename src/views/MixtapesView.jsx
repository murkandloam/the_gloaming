import React, { useState, useEffect, useMemo } from 'react';
import '../styles/MixtapesView.css';
import { getCassetteImage } from '../assets/cassettes';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const SORT_FIELDS = [
  { id: 'name', label: 'Name' },
  { id: 'createdAt', label: 'Date Created' },
  { id: 'modifiedAt', label: 'Date Modified' },
  { id: 'trackCount', label: 'Track Count' },
];

function MixtapesView({ onMixtapeSelect, onTrackSelect, viewState, onViewStateChange, onMixtapeContextMenu, onMixtapesChanged }) {
  const [mixtapes, setMixtapes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewMixtapeModal, setShowNewMixtapeModal] = useState(false);
  const [newMixtapeName, setNewMixtapeName] = useState('');
  const [openDropdown, setOpenDropdown] = useState(false);

  // View state with defaults
  const sortField = viewState?.sortField ?? 'name';
  const sortDirection = viewState?.sortDirection ?? 'asc';
  const gridSize = viewState?.gridSize ?? 140;

  const setSortField = (value) => onViewStateChange?.(prev => ({ ...prev, sortField: value }));
  const setSortDirection = (value) => onViewStateChange?.(prev => ({ ...prev, sortDirection: value }));
  const setGridSize = (value) => onViewStateChange?.(prev => ({ ...prev, gridSize: value }));

  useEffect(() => {
    loadMixtapes();
  }, []);

  async function loadMixtapes() {
    if (!ipcRenderer) return;

    try {
      setLoading(true);
      const result = await ipcRenderer.invoke('load-mixtapes');
      setMixtapes(result || []);
    } catch (err) {
      console.error('Error loading mixtapes:', err);
    } finally {
      setLoading(false);
    }
  }

  // Sort mixtapes
  const sortedMixtapes = useMemo(() => {
    const sorted = [...mixtapes].sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'createdAt':
          aVal = a.createdAt || '';
          bVal = b.createdAt || '';
          break;
        case 'modifiedAt':
          aVal = a.modifiedAt || '';
          bVal = b.modifiedAt || '';
          break;
        case 'trackCount':
          aVal = a.trackCount || 0;
          bVal = b.trackCount || 0;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [mixtapes, sortField, sortDirection]);

  async function handleCreateMixtape() {
    if (!newMixtapeName.trim()) return;

    try {
      const result = await ipcRenderer.invoke('create-mixtape', {
        name: newMixtapeName.trim()
      });

      if (result.success) {
        setNewMixtapeName('');
        setShowNewMixtapeModal(false);
        loadMixtapes();
        onMixtapesChanged?.();
      }
    } catch (err) {
      console.error('Error creating mixtape:', err);
    }
  }

  function handleMixtapeClick(mixtape) {
    if (onMixtapeSelect) {
      onMixtapeSelect(mixtape);
    }
  }

  function toggleSortDirection() {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  }

  function getFieldLabel(fieldId) {
    const field = SORT_FIELDS.find(f => f.id === fieldId);
    return field ? field.label : fieldId;
  }

  // Get cover image for a mixtape (custom cover or cassette)
  function getMixtapeCoverImage(mixtape) {
    if (mixtape.coverPath) {
      return `local://${mixtape.coverPath}`;
    }
    // Fall back to cassette image
    return getCassetteImage(mixtape.cassetteIndex ?? 0);
  }

  // Grid style with dynamic size
  const gridStyle = {
    '--mixtape-width': `${gridSize}px`
  };

  if (loading) {
    return (
      <div className="mixtapes-view">
        <div className="mixtapes-loading">
          <span>Loading cassettes...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mixtapes-view">
      <div className="mixtapes-content">
        {/* Header with New button */}
        <div className="mixtapes-header">
          <button
            className="mixtapes-new-btn"
            onClick={() => setShowNewMixtapeModal(true)}
          >
            + New Cassette
          </button>
        </div>

        {mixtapes.length > 0 && (
          <div className="mixtapes-grid" style={gridStyle}>
            {sortedMixtapes.map(mixtape => (
              <div
                key={mixtape.id}
                className="mixtape-card"
                onClick={() => handleMixtapeClick(mixtape)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onMixtapeContextMenu) {
                    onMixtapeContextMenu(e, mixtape);
                  }
                }}
                title={mixtape.name}
              >
                <div className="mixtape-cover">
                  <img
                    src={getMixtapeCoverImage(mixtape)}
                    alt={mixtape.name}
                    className="mixtape-cover-image"
                  />
                  <div className="mixtape-name-pill">
                    <span className="mixtape-name">{mixtape.name}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Options Bar */}
      <div className="mixtapes-options-bar" onClick={(e) => {
        if (!e.target.closest('.sort-field-btn') && !e.target.closest('.sort-dropdown')) {
          setOpenDropdown(false);
        }
      }}>
        {/* Sort control */}
        <div className="options-section">
          <div className="sort-control">
            <span className="sort-label">Sort:</span>
            <div className="sort-pill">
              <button
                className="sort-field-btn"
                onClick={() => setOpenDropdown(!openDropdown)}
              >
                {getFieldLabel(sortField)}
                <span className="dropdown-arrow">▾</span>
              </button>
              {openDropdown && (
                <div className="sort-dropdown">
                  {SORT_FIELDS.map(field => (
                    <div
                      key={field.id}
                      className={`dropdown-item ${sortField === field.id ? 'active' : ''}`}
                      onClick={() => {
                        setSortField(field.id);
                        setOpenDropdown(false);
                      }}
                    >
                      {field.label}
                    </div>
                  ))}
                </div>
              )}
              <button
                className="sort-direction-btn"
                onClick={toggleSortDirection}
                title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>

        {/* Size slider */}
        <div className="options-section">
          <div className="grid-size-control">
            <span className="grid-size-icon small">▪</span>
            <input
              type="range"
              min="100"
              max="200"
              step="10"
              value={gridSize}
              onChange={(e) => setGridSize(parseInt(e.target.value))}
              className="grid-size-slider"
            />
            <span className="grid-size-icon large">▪</span>
          </div>
        </div>
      </div>

      {/* New Mixtape Modal */}
      {showNewMixtapeModal && (
        <div className="modal-overlay" onClick={() => setShowNewMixtapeModal(false)}>
          <div className="modal-content new-mixtape-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Cassette</h3>
              <button
                className="modal-close"
                onClick={() => setShowNewMixtapeModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-label">
                Name
                <input
                  type="text"
                  className="modal-input"
                  value={newMixtapeName}
                  onChange={e => setNewMixtapeName(e.target.value)}
                  placeholder="Late Night Drives"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateMixtape();
                    if (e.key === 'Escape') setShowNewMixtapeModal(false);
                  }}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="modal-btn modal-btn-secondary"
                onClick={() => setShowNewMixtapeModal(false)}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-primary"
                onClick={handleCreateMixtape}
                disabled={!newMixtapeName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MixtapesView;
