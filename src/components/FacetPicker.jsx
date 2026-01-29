/**
 * FacetPicker - Popup for adding facets to tracks
 * 
 * Shows search, recent facets, and all facets with counts.
 * Type something new to create a new facet.
 */

import React, { useState, useEffect, useRef } from 'react';
import './FacetPicker.css';

const { ipcRenderer } = window.require('electron');

function FacetPicker({ onSelect, onClose, existingFacets = [] }) {
  const [query, setQuery] = useState('');
  const [allFacets, setAllFacets] = useState([]);
  const [recentFacets, setRecentFacets] = useState([]);
  const [starredFacets, setStarredFacets] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Load facets on mount
  useEffect(() => {
    loadFacets();
    inputRef.current?.focus();
  }, []);

  // Global ESC handler - closes modal and prevents App from handling ESC
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true); // capture phase
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [onClose]);

  // Search as user types (also re-search when allFacets loads)
  useEffect(() => {
    if (query.trim()) {
      // Search locally from allFacets (which includes empty facets)
      const q = query.toLowerCase();
      const results = allFacets.filter(f => f.name.toLowerCase().includes(q));
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
    setSelectedIndex(0);
  }, [query, allFacets]);

  async function loadFacets() {
    try {
      const facets = await ipcRenderer.invoke('get-all-facets');
      const config = await ipcRenderer.invoke('get-facets');

      // Merge in empty facets from the recent list that aren't already in allFacets
      const existingNames = new Set(facets.map(f => f.name));
      const emptyFacets = (config.recent || [])
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, count: 0 }));
      setAllFacets([...facets, ...emptyFacets]);

      // Recent facets now includes empty ones too
      setRecentFacets(config.recent || []);

      // Get starred facets (include empty ones from recent)
      const allFacetNames = new Set([...facets.map(f => f.name), ...(config.recent || [])]);
      const validStarred = (config.starred || []).filter(name => allFacetNames.has(name));
      setStarredFacets(validStarred);
    } catch (err) {
      console.error('Error loading facets:', err);
    }
  }

  function handleSelect(facetName) {
    if (!existingFacets.includes(facetName)) {
      onSelect(facetName);
    }
    onClose();
  }

  async function handleRemoveFromRecent(facetName, e) {
    e.stopPropagation();
    try {
      await ipcRenderer.invoke('remove-from-recent', facetName);
      setRecentFacets(prev => prev.filter(f => f !== facetName));
    } catch (err) {
      console.error('Error removing from recent:', err);
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
      if (items[selectedIndex]) {
        handleSelect(items[selectedIndex].name);
      } else if (query.trim()) {
        // Create new facet
        handleSelect(query.trim());
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  function getDisplayItems() {
    if (query.trim()) {
      // Show search results + create option (starred get star indicator)
      const starredSet = new Set(starredFacets);
      const results = searchResults.map(r => ({
        ...r,
        isStarred: starredSet.has(r.name)
      }));
      const trimmed = query.trim();
      const exactMatch = results.some(r => r.name.toLowerCase() === trimmed.toLowerCase());

      if (!exactMatch && trimmed) {
        results.push({ name: trimmed, count: 0, isNew: true });
      }

      return results;
    } else {
      // Show starred, then recent (excluding starred), then all others
      const starredSet = new Set(starredFacets);
      const recentSet = new Set(recentFacets);
      const usedSet = new Set([...starredFacets, ...recentFacets]);
      const others = allFacets.filter(f => !usedSet.has(f.name));

      return [
        // Starred facets first
        ...starredFacets.map(name => {
          const found = allFacets.find(f => f.name === name);
          return { name, count: found?.count || 0, isStarred: true };
        }),
        // Recent facets (excluding those already in starred)
        ...recentFacets.filter(name => !starredSet.has(name)).map(name => {
          const found = allFacets.find(f => f.name === name);
          return { name, count: found?.count || 0, isRecent: true };
        }),
        // All others
        ...others
      ];
    }
  }

  const displayItems = getDisplayItems();
  const hasStarred = !query.trim() && starredFacets.length > 0;
  const starredSet = new Set(starredFacets);
  const recentNotStarred = recentFacets.filter(f => !starredSet.has(f));
  const hasRecent = !query.trim() && recentNotStarred.length > 0;

  return (
    <div className="facet-picker-overlay" onClick={onClose}>
      <div className="facet-picker" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="facet-picker-search">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or create facet..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Results list */}
        <div className="facet-picker-list" ref={listRef}>
          {hasStarred && (
            <div className="facet-picker-section-header">
              ★ Starred ({starredFacets.length})
            </div>
          )}

          {displayItems.length === 0 && !query.trim() && (
            <div className="facet-picker-empty">
              No facets yet. Type to create one!
            </div>
          )}

          {displayItems.map((item, index) => {
            const isDisabled = existingFacets.includes(item.name);
            const isSelected = index === selectedIndex;

            // Calculate section boundaries
            const starredCount = starredFacets.length;
            const recentCount = recentNotStarred.length;

            // Show "Recently Used" header after starred section
            const showRecentHeader = hasRecent &&
              hasStarred &&
              index === starredCount;

            // Show "Recently Used" header at start if no starred
            const showRecentHeaderFirst = hasRecent &&
              !hasStarred &&
              index === 0;

            // Show "All Facets" header after starred+recent
            const showAllHeader = !query.trim() &&
              index === starredCount + recentCount &&
              displayItems.length > starredCount + recentCount;

            return (
              <React.Fragment key={item.name}>
                {showRecentHeaderFirst && (
                  <div className="facet-picker-section-header">
                    Recently Used ({recentCount})
                  </div>
                )}
                {showRecentHeader && (
                  <div className="facet-picker-section-header">
                    Recently Used ({recentCount})
                  </div>
                )}
                {showAllHeader && (
                  <div className="facet-picker-section-header">
                    All Facets
                  </div>
                )}
                <div
                  className={`facet-picker-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                  onClick={() => !isDisabled && handleSelect(item.name)}
                >
                  <span className={`facet-picker-item-icon ${item.isStarred ? 'starred' : ''}`}>
                    {item.isNew ? '＋' : item.isStarred ? '★' : '●'}
                  </span>
                  <span className="facet-picker-item-name">
                    {item.isNew ? `Create "${item.name}"` : item.name}
                  </span>
                  {!item.isNew && (
                    <span className="facet-picker-item-count">
                      {isDisabled ? '✓' : `(${item.count})`}
                    </span>
                  )}
                  {item.isRecent && !isDisabled && (
                    <span
                      className="facet-picker-item-remove"
                      onClick={(e) => handleRemoveFromRecent(item.name, e)}
                      title="Remove from recently used"
                    >
                      ×
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default FacetPicker;
