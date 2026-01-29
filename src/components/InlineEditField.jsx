/**
 * InlineEditField - Click-to-edit text field for Panopticon detail panels
 *
 * Click on the text to enter edit mode.
 * Changes save on blur or Enter.
 * Escape cancels the edit.
 */

import React, { useState, useRef, useEffect } from 'react';
import './InlineEditField.css';

function InlineEditField({
  value,
  onChange,
  placeholder = 'Untitled',
  label,
  className = '',
  variant = 'default', // 'default' | 'title' | 'subtitle'
  disabled = false,
  monospace = false
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const inputRef = useRef(null);

  // Sync editValue when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value || '');
    }
  }, [value, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (!disabled) {
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    // Compare with current value - use null coalescing to handle undefined/null
    const currentValue = value ?? '';
    if (trimmed !== currentValue) {
      // Pass null instead of empty string to clear the field in the database
      onChange(trimmed === '' ? null : trimmed);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditValue(value || '');
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      // Allow Tab to blur and save, then focus next field naturally
      handleBlur();
    }
  };

  const displayValue = value || '';
  const isEmpty = !displayValue;

  const variantClass = `inline-edit-${variant}`;
  const stateClass = isEditing ? 'editing' : '';
  const emptyClass = isEmpty ? 'empty' : '';
  const disabledClass = disabled ? 'disabled' : '';
  const monoClass = monospace ? 'monospace' : '';

  return (
    <div className={`inline-edit-field ${variantClass} ${stateClass} ${emptyClass} ${disabledClass} ${monoClass} ${className}`}>
      {label && <label className="inline-edit-label">{label}</label>}

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="inline-edit-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      ) : (
        <span
          className="inline-edit-display"
          onClick={handleClick}
          title={disabled ? undefined : 'Click to edit'}
        >
          {displayValue || placeholder}
        </span>
      )}
    </div>
  );
}

export default InlineEditField;
