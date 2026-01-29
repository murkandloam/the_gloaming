import React, { useState, useCallback } from 'react';
import '../styles/DropZone.css';

function DropZone({ children, onDrop, disabled, showOverlay = true }) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (disabled) return;
    
    setDragCounter(prev => prev + 1);
    
    // Check if it's a file drag
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
    setDragCounter(0);

    if (disabled) return;

    const files = e.dataTransfer.files;

    if (files.length > 0) {
      // Get all dropped items' paths
      // In Electron, files have a 'path' property
      const filePaths = Array.from(files).map(f => f.path).filter(Boolean);

      if (filePaths.length > 0 && onDrop) {
        onDrop(filePaths);  // Now passes array of paths
      }
    }
  }, [disabled, onDrop]);

  return (
    <div
      className={`drop-zone-wrapper ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      
      {/* Drag overlay - only show on Records tab */}
      {isDragging && showOverlay && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content glass-panel">
            <div className="drop-zone-title">Drop to Import</div>
            <div className="drop-zone-subtitle">
              Folders or audio files
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DropZone;
