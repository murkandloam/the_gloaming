import React, { useEffect } from 'react';
import './ManifestModal.css';

/**
 * ManifestModal - Shared modal wrapper for Track and Album manifests
 * Provides the smokey glass aesthetic and common modal behavior
 */
function ManifestModal({ 
  isOpen, 
  onClose, 
  title,
  children,
  width = '480px'
}) {
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="manifest-overlay" onClick={onClose}>
      <div 
        className="manifest-modal" 
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manifest-header">
          <h2 className="manifest-title">{title}</h2>
          <button className="manifest-close" onClick={onClose}>×</button>
        </div>
        <div className="manifest-content">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Form field components for use within manifests
 */
export function ManifestField({ label, children, hint }) {
  return (
    <div className="manifest-field">
      <label className="manifest-label">{label}</label>
      {children}
      {hint && <span className="manifest-hint">{hint}</span>}
    </div>
  );
}

export function ManifestInput({ value, onChange, placeholder, disabled, type = 'text' }) {
  return (
    <input
      type={type}
      className="manifest-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

export function ManifestTextarea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      className="manifest-textarea"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
    />
  );
}

export function ManifestToggle({ checked, onChange, label }) {
  return (
    <label className="manifest-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function ManifestSlider({ value, onChange, min, max, label, showValue }) {
  return (
    <div className="manifest-slider-container">
      {label && <span className="slider-label">{label}</span>}
      <input
        type="range"
        className="manifest-slider"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
      />
      {showValue && <span className="slider-value">{value}px</span>}
    </div>
  );
}

export function ManifestReadOnly({ label, value }) {
  return (
    <div className="manifest-readonly">
      <span className="readonly-label">{label}</span>
      <span className="readonly-value">{value || '—'}</span>
    </div>
  );
}

export function ManifestDivider() {
  return <div className="manifest-divider" />;
}

export function ManifestActions({ children }) {
  return <div className="manifest-actions">{children}</div>;
}

export function ManifestButton({ onClick, variant = 'default', children, disabled }) {
  return (
    <button 
      className={`manifest-button ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default ManifestModal;
