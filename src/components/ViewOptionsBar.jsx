/**
 * ViewOptionsBar - Bottom bar for Records view with sorting and display options
 *
 * Features:
 * - Separators button with popup menu (Group by + Distinguish)
 * - Sort pills (up to 3, draggable)
 * - Grid size slider
 *
 * Note: Filtering is now handled by RecordFilterBar at the top of the grid.
 */

import React, { useState, useRef, useEffect } from 'react';
import './ViewOptionsBar.css';

const SORT_FIELDS = [
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'releaseDate', label: 'Year' },
  { id: 'dateAdded', label: 'Date Added' },
  { id: 'listenTime', label: 'Listen Time' },
];

const SEPARATOR_FIELDS = [
  { id: 'artist', label: 'Artist' },
  { id: 'releaseDate', label: 'Year' },
  { id: 'decade', label: 'Decade' },
];

const DISTINGUISH_OPTIONS = [
  { id: 'Soundtrack', label: 'Soundtracks' },
  { id: 'Compilation', label: 'Compilations' },
  { id: 'Concert', label: 'Concerts' },
  { id: 'ComposerWork', label: 'Composer Works' },
  { id: 'Miscellanea', label: 'Miscellanea' },
  { id: 'Reissue', label: 'Reissues' },
];

const DEFAULT_DISTINGUISH = {
  Soundtrack: false,
  Compilation: false,
  Concert: false,
  ComposerWork: false,
  Miscellanea: false,
  Reissue: false,
};

function ViewOptionsBar({
  // Separator state
  separatorsEnabled,
  onSeparatorsEnabledChange,
  separatorField,
  onSeparatorFieldChange,
  separatorDirection,
  onSeparatorDirectionChange,

  // Distinguish state (characteristics to separate at end)
  distinguishFilters = DEFAULT_DISTINGUISH,
  onDistinguishFiltersChange,

  // Sort state - array of { field, direction }
  sortPills,
  onSortPillsChange,

  // Honour "The" option - when true, "The Beatles" sorts under "B"
  honourThe,
  onHonourTheChange,

  // Grid size
  gridSize,
  onGridSizeChange,
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null); // 'separator' | index of pill | null
  const [separatorMenuOpen, setSeparatorMenuOpen] = useState(false);
  const pillsRef = useRef(null);
  const separatorMenuRef = useRef(null);

  // Close separator menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (separatorMenuRef.current && !separatorMenuRef.current.contains(e.target) &&
          !e.target.closest('.separators-btn')) {
        setSeparatorMenuOpen(false);
      }
    };

    if (separatorMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [separatorMenuOpen]);

  // Add a new sort pill
  const addSortPill = () => {
    if (sortPills.length >= 3) return;

    // Find first unused field
    const usedFields = sortPills.map(p => p.field);
    const availableField = SORT_FIELDS.find(f => !usedFields.includes(f.id));

    if (availableField) {
      onSortPillsChange([...sortPills, { field: availableField.id, direction: 'asc' }]);
    }
  };

  // Remove a sort pill
  const removeSortPill = (index) => {
    onSortPillsChange(sortPills.filter((_, i) => i !== index));
  };

  // Change sort pill field
  const changePillField = (index, newField) => {
    const updated = [...sortPills];
    updated[index] = { ...updated[index], field: newField };
    onSortPillsChange(updated);
    setOpenDropdown(null);
  };

  // Toggle sort direction
  const togglePillDirection = (index) => {
    const updated = [...sortPills];
    updated[index] = {
      ...updated[index],
      direction: updated[index].direction === 'asc' ? 'desc' : 'asc'
    };
    onSortPillsChange(updated);
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    // Reorder pills
    const updated = [...sortPills];
    const [dragged] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, dragged);
    onSortPillsChange(updated);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Get label for a field
  const getFieldLabel = (fieldId) => {
    const field = SORT_FIELDS.find(f => f.id === fieldId);
    return field ? field.label : fieldId;
  };

  // Close dropdowns when clicking outside
  const handleBarClick = (e) => {
    if (!e.target.closest('.pill-field-btn') && !e.target.closest('.pill-dropdown') &&
        !e.target.closest('.separators-btn') && !e.target.closest('.separators-menu')) {
      setOpenDropdown(null);
    }
  };

  // Toggle a distinguish filter
  const toggleDistinguish = (id) => {
    if (onDistinguishFiltersChange) {
      onDistinguishFiltersChange({
        ...distinguishFilters,
        [id]: !distinguishFilters[id]
      });
    }
  };

  // Check if any separators are active
  const hasActiveSeparators = separatorsEnabled || Object.values(distinguishFilters).some(v => v);

  return (
    <div className="view-options-bar" onClick={handleBarClick}>
      {/* Left section: Separators button */}
      <div className="options-section options-filters">
        <div className="separators-control">
          <button
            className={`separators-btn ${hasActiveSeparators ? 'active' : ''}`}
            onClick={() => setSeparatorMenuOpen(!separatorMenuOpen)}
          >
            Separators
            <span className="dropdown-arrow">{separatorMenuOpen ? '▴' : '▾'}</span>
          </button>

          {separatorMenuOpen && (
            <div className="separators-menu" ref={separatorMenuRef}>
              {/* Group By section */}
              <div className="menu-section">
                <div className="menu-section-header">Group by</div>
                <label className="menu-checkbox">
                  <input
                    type="checkbox"
                    checked={!separatorsEnabled}
                    onChange={() => onSeparatorsEnabledChange(false)}
                  />
                  <span>None</span>
                </label>
                {SEPARATOR_FIELDS.map(field => (
                  <label key={field.id} className="menu-checkbox">
                    <input
                      type="checkbox"
                      checked={separatorsEnabled && separatorField === field.id}
                      onChange={() => {
                        onSeparatorsEnabledChange(true);
                        onSeparatorFieldChange(field.id);
                      }}
                    />
                    <span>{field.label}</span>
                  </label>
                ))}
              </div>

              {/* Distinguish section */}
              <div className="menu-section">
                <div className="menu-section-header">Distinguish</div>
                {DISTINGUISH_OPTIONS.map(opt => (
                  <label key={opt.id} className="menu-checkbox">
                    <input
                      type="checkbox"
                      checked={distinguishFilters[opt.id] || false}
                      onChange={() => toggleDistinguish(opt.id)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center section: Sort pills */}
      <div className="options-section options-sort">
        <div className="sort-pills-track" ref={pillsRef}>
          {sortPills.map((pill, index) => (
            <div
              key={`${pill.field}-${index}`}
              className={`sort-pill ${draggedIndex === index ? 'dragging' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
            >
              <button
                className="pill-remove"
                onClick={() => removeSortPill(index)}
                title="Remove"
              >
                ×
              </button>

              <button
                className="pill-field-btn"
                onClick={() => setOpenDropdown(openDropdown === index ? null : index)}
              >
                {getFieldLabel(pill.field)}
                <span className="dropdown-arrow">▾</span>
              </button>

              {openDropdown === index && (
                <div className="pill-dropdown">
                  {SORT_FIELDS.filter(f =>
                    !sortPills.some((p, i) => i !== index && p.field === f.id)
                  ).map(field => (
                    <div
                      key={field.id}
                      className={`dropdown-item ${pill.field === field.id ? 'active' : ''}`}
                      onClick={() => changePillField(index, field.id)}
                    >
                      {field.label}
                    </div>
                  ))}
                </div>
              )}

              <button
                className="pill-direction"
                onClick={() => togglePillDirection(index)}
                title={pill.direction === 'asc' ? 'Ascending' : 'Descending'}
              >
                {pill.direction === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          ))}

          {sortPills.length < 3 && (
            <button
              className="sort-pill-add"
              onClick={addSortPill}
              title="Add sort"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Right section: Grid size */}
      <div className="options-section options-display">
        <div className="grid-size-control">
          <span className="grid-size-icon small">▪</span>
          <input
            type="range"
            min="100"
            max="400"
            step="25"
            value={gridSize}
            onChange={(e) => onGridSizeChange(parseInt(e.target.value))}
            className="grid-size-slider"
          />
          <span className="grid-size-icon large">■</span>
        </div>
      </div>
    </div>
  );
}

export default ViewOptionsBar;
