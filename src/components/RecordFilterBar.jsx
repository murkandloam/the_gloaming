/**
 * RecordFilterBar - Filter bar for Records grid view
 *
 * Panopticon-style pill filters for record format and characteristics.
 * Pills are mutually exclusive (like Panopticon), with SOME providing
 * multi-select via dropdown.
 *
 * Filter modes:
 * - all: Show all records (except those with showOnGrid: false)
 * - some: Show records matching checked filters in dropdown (includes Invisible option)
 * - lps/eps/singles: Show only that format
 * - soundtracks/compilations: Show only records with that characteristic
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './RecordFilterBar.css';

// Default checked items in SOME dropdown (top section)
const DEFAULT_SOME_FILTERS = {
  LPs: true,
  EPs: true,
  Singles: true,
  Soundtracks: true,
  Compilations: true,
  // Bottom section - unchecked by default
  Concerts: false,
  ComposerWorks: false,
  Miscellanea: false,
  Reissues: false,
  Invisible: false  // Records marked as hidden
};

function RecordFilterBar({
  filterMode = 'all',
  onFilterModeChange,
  someFilters = DEFAULT_SOME_FILTERS,
  onSomeFiltersChange
}) {
  const [showSomeDropdown, setShowSomeDropdown] = useState(false);
  const someDropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showSomeDropdown) return;

    const handleClickOutside = (e) => {
      if (someDropdownRef.current && !someDropdownRef.current.contains(e.target)) {
        setShowSomeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSomeDropdown]);

  // Toggle a filter in SOME dropdown
  const toggleSomeFilter = useCallback((filter) => {
    onSomeFiltersChange?.(prev => ({
      ...prev,
      [filter]: !prev[filter]
    }));
  }, [onSomeFiltersChange]);

  // Handle pill click - mutually exclusive
  const handlePillClick = (mode) => {
    onFilterModeChange?.(mode);
    setShowSomeDropdown(false);
  };

  // Handle SOME pill click - toggle dropdown if already active
  const handleSomePillClick = () => {
    if (filterMode === 'some') {
      setShowSomeDropdown(!showSomeDropdown);
    } else {
      onFilterModeChange?.('some');
      setShowSomeDropdown(true);
    }
  };

  return (
    <div className="record-filter-bar">
      <div className="record-filter-pills">
        {/* All pill */}
        <button
          className={`record-filter-pill ${filterMode === 'all' ? 'active' : ''}`}
          onClick={() => handlePillClick('all')}
        >
          All
        </button>

        {/* Some pill with dropdown */}
        <div className="record-filter-pill-wrapper" ref={someDropdownRef}>
          <button
            className={`record-filter-pill ${filterMode === 'some' ? 'active' : ''}`}
            onClick={handleSomePillClick}
          >
            Some ▾
          </button>
          {showSomeDropdown && (
            <div className="record-filter-some-dropdown">
              {/* Top section: Formats + common characteristics (default checked) */}
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.LPs}
                  onChange={() => toggleSomeFilter('LPs')}
                />
                LPs
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.EPs}
                  onChange={() => toggleSomeFilter('EPs')}
                />
                EPs
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Singles}
                  onChange={() => toggleSomeFilter('Singles')}
                />
                Singles
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Soundtracks}
                  onChange={() => toggleSomeFilter('Soundtracks')}
                />
                Soundtracks
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Compilations}
                  onChange={() => toggleSomeFilter('Compilations')}
                />
                Compilations
              </label>

              {/* Divider */}
              <div className="record-filter-some-divider" />

              {/* Bottom section: Less common (default unchecked) */}
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Concerts}
                  onChange={() => toggleSomeFilter('Concerts')}
                />
                Concerts
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.ComposerWorks}
                  onChange={() => toggleSomeFilter('ComposerWorks')}
                />
                Composer Works
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Miscellanea}
                  onChange={() => toggleSomeFilter('Miscellanea')}
                />
                Miscellanea
              </label>
              <label className="record-filter-some-option">
                <input
                  type="checkbox"
                  checked={someFilters.Reissues}
                  onChange={() => toggleSomeFilter('Reissues')}
                />
                Reissues
              </label>
              <label className="record-filter-some-option invisible-option">
                <input
                  type="checkbox"
                  checked={someFilters.Invisible}
                  onChange={() => toggleSomeFilter('Invisible')}
                />
                Invisible
              </label>
            </div>
          )}
        </div>

        {/* Individual format/characteristic pills */}
        <button
          className={`record-filter-pill ${filterMode === 'lps' ? 'active' : ''}`}
          onClick={() => handlePillClick('lps')}
        >
          LPs
        </button>
        <button
          className={`record-filter-pill ${filterMode === 'eps' ? 'active' : ''}`}
          onClick={() => handlePillClick('eps')}
        >
          EPs
        </button>
        <button
          className={`record-filter-pill ${filterMode === 'singles' ? 'active' : ''}`}
          onClick={() => handlePillClick('singles')}
        >
          Singles
        </button>
        <button
          className={`record-filter-pill ${filterMode === 'soundtracks' ? 'active' : ''}`}
          onClick={() => handlePillClick('soundtracks')}
        >
          Soundtracks
        </button>
        <button
          className={`record-filter-pill ${filterMode === 'compilations' ? 'active' : ''}`}
          onClick={() => handlePillClick('compilations')}
        >
          Compilations
        </button>
        <button
          className={`record-filter-pill invisible-pill ${filterMode === 'invisible' ? 'active' : ''}`}
          onClick={() => handlePillClick('invisible')}
        >
          Invisible
        </button>
      </div>
    </div>
  );
}

export default RecordFilterBar;
