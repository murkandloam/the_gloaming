import React, { useState, useEffect, useRef } from 'react';
import './FacetPicker.css'; // Reuse FacetPicker styles

const { ipcRenderer } = window.require ? window.require('electron') : {};

/**
 * Modal for adding tracks to a mixtape
 * Styled to match FacetPicker
 */
function AddToMixtapeModal({
  isOpen,
  onClose,
  trackIds = [],
  albumId = null,
  albumName = null,
  onSuccess
}) {
  const [mixtapes, setMixtapes] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addingTo, setAddingTo] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      loadMixtapes();
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Global ESC handler - closes modal and prevents App from handling ESC
  useEffect(() => {
    if (!isOpen) return;
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true); // capture phase
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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

  async function getTrackIdsToAdd() {
    if (trackIds.length > 0) return trackIds;
    if (albumId && ipcRenderer) {
      const result = await ipcRenderer.invoke('get-album-track-ids', albumId);
      if (result.success) return result.trackIds;
    }
    return [];
  }

  async function handleSelect(mixtapeId) {
    if (!ipcRenderer || addingTo) return;
    try {
      setAddingTo(mixtapeId);
      const idsToAdd = await getTrackIdsToAdd();
      if (idsToAdd.length === 0) return;

      const result = await ipcRenderer.invoke('add-tracks-to-mixtape', {
        mixtapeId,
        trackIds: idsToAdd
      });

      if (result.success) {
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      console.error('Error adding to mixtape:', err);
    } finally {
      setAddingTo(null);
    }
  }

  async function handleCreateAndAdd(name) {
    if (!ipcRenderer || !name.trim()) return;
    try {
      const createResult = await ipcRenderer.invoke('create-mixtape', {
        name: name.trim()
      });

      if (createResult.success) {
        const idsToAdd = await getTrackIdsToAdd();
        if (idsToAdd.length > 0) {
          await ipcRenderer.invoke('add-tracks-to-mixtape', {
            mixtapeId: createResult.mixtape.id,
            trackIds: idsToAdd
          });
        }
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      console.error('Error creating mixtape:', err);
    }
  }

  function handleKeyDown(e) {
    const items = getDisplayItems();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item?.isNew) {
        handleCreateAndAdd(item.name);
      } else if (item) {
        handleSelect(item.id);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  function getDisplayItems() {
    const trimmed = query.trim().toLowerCase();
    let filtered = mixtapes;

    if (trimmed) {
      filtered = mixtapes.filter(m =>
        m.name.toLowerCase().includes(trimmed)
      );
    }

    const results = filtered.map(m => ({
      id: m.id,
      name: m.name,
      count: m.trackCount || 0,
      color: m.color?.bg
    }));

    // Add create option if no exact match
    if (trimmed && !mixtapes.some(m => m.name.toLowerCase() === trimmed)) {
      results.unshift({
        id: null,
        name: query.trim(),
        isNew: true
      });
    }

    return results;
  }

  if (!isOpen) return null;

  const displayItems = getDisplayItems();

  return (
    <div className="facet-picker-overlay" onClick={onClose}>
      <div className="facet-picker" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="facet-picker-search">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or create cassette..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Results list */}
        <div className="facet-picker-list">
          {loading ? (
            <div className="facet-picker-empty">Loading...</div>
          ) : displayItems.length === 0 ? (
            <div className="facet-picker-empty">
              No cassettes yet. Type to create one!
            </div>
          ) : (
            displayItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const isAdding = addingTo === item.id;

              return (
                <div
                  key={item.id || `new-${item.name}`}
                  className={`facet-picker-item ${isSelected ? 'selected' : ''} ${isAdding ? 'disabled' : ''}`}
                  onClick={() => item.isNew ? handleCreateAndAdd(item.name) : handleSelect(item.id)}
                >
                  {item.isNew ? (
                    <span className="facet-picker-item-icon">＋</span>
                  ) : (
                    <span
                      className="facet-picker-item-icon"
                      style={{ color: item.color || 'var(--accent-primary)' }}
                    >
                      ■
                    </span>
                  )}
                  <span className="facet-picker-item-name">
                    {item.isNew ? `Create "${item.name}"` : item.name}
                  </span>
                  {!item.isNew && (
                    <span className="facet-picker-item-count">
                      {isAdding ? 'Adding...' : `(${item.count})`}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default AddToMixtapeModal;
