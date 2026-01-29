/**
 * EphemeraBox - Universal attachment display/management component
 *
 * Used for albums, tracks, and mixtapes across:
 * - Record Sleeves
 * - Mixtape Sleeves
 * - Panopticon Detail Panels
 * - Inspector Sidebar
 *
 * Features:
 * - Display attached images, PDFs, and text files
 * - Drag-and-drop to add new files
 * - Drag-to-reorder attachments
 * - Click image to open in lightbox
 * - Click document to open in text viewer
 * - Remove button on hover
 * - Size slider (full variant)
 * - Compact mode for inspector
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import './EphemeraBox.css';

const { ipcRenderer, shell } = window.require ? window.require('electron') : {};

function EphemeraBox({
  entityType, // 'album' | 'track' | 'mixtape'
  entityId,
  attachments = [],
  onAttachmentsChange, // () => void - called after any change to reload
  variant = 'full', // 'compact' | 'medium' | 'full'
  readOnly = false,
  showHeader = true,
  showSizeSlider = true,
  className = '', // Additional CSS classes
  onOpenLightbox, // (attachmentIndex, allImageAttachments) => void
  onOpenTextViewer, // (attachment) => void
  onContextMenu, // (e, attachment, context) => void
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ephemeraSize, setEphemeraSize] = useState(variant === 'compact' ? 60 : 100);

  // Drag counter to handle nested element drag enter/leave
  const dragCounterRef = useRef(0);

  // Drag-to-reorder state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragPosition, setDragPosition] = useState(null); // 'before' | 'after'

  // Lightbox state (internal, used if no external handler)
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Text viewer state (internal)
  const [textViewerOpen, setTextViewerOpen] = useState(false);
  const [textViewerContent, setTextViewerContent] = useState({ title: '', content: '', format: 'plain' });

  // Normalize attachment data to handle different formats
  // Panopticon returns: { id, filename, type: mimeType, thumbnailPath }
  // Regular IPC returns: { id, originalName, type: 'image'|'pdf'|'text', path, thumbnailPath }
  const normalizeAttachment = (att) => {
    // Determine if it's an image based on type or mimeType
    let isImage = false;
    let simpleType = att.type;

    if (att.type?.startsWith('image') || att.type === 'image') {
      isImage = true;
      simpleType = 'image';
    } else if (att.type?.includes('pdf') || att.type === 'pdf') {
      simpleType = 'pdf';
    } else if (att.type?.startsWith('text') || att.type === 'text') {
      simpleType = 'text';
    }

    return {
      ...att,
      originalName: att.originalName || att.filename,
      type: simpleType,
      isImage
    };
  };

  // Get icon for document type
  const getDocIcon = (type, filename) => {
    if (type === 'pdf' || type?.includes('pdf')) return '📄';
    const ext = filename?.split('.').pop()?.toLowerCase();
    if (ext === 'md') return '📝';
    if (ext === 'rtf') return '📃';
    return '📝';
  };

  // IPC handler names for each entity type
  const ipcHandlers = {
    album: {
      add: 'add-attachment-to-album',
      remove: 'remove-attachment-from-album',
      reorder: 'reorder-album-attachments',
      idField: 'albumId'
    },
    track: {
      add: 'add-attachment-to-track',
      remove: 'remove-attachment-from-track',
      reorder: 'reorder-track-attachments',
      idField: 'trackId'
    },
    mixtape: {
      add: 'add-attachment-to-mixtape',
      remove: 'remove-attachment-from-mixtape',
      reorder: 'reorder-mixtape-attachments',
      idField: 'mixtapeId'
    }
  };

  const handlers = ipcHandlers[entityType];

  // Normalize all attachments
  const normalizedAttachments = attachments.map(normalizeAttachment);

  // Filter to just image attachments for lightbox
  const imageAttachments = normalizedAttachments.filter(att => att.isImage);

  // ============================================
  // File Drop Handlers (add new files)
  // ============================================

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Increment counter for every drag enter (handles nested elements)
    dragCounterRef.current++;

    // Handle external file drops or Panopticon attachment drops
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasPanopticonItem = e.dataTransfer.types.includes('application/x-panopticon-item');
    if ((hasFiles || hasPanopticonItem) && !readOnly) {
      setIsDragOver(true);
    }
  }, [readOnly]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Decrement counter for every drag leave
    dragCounterRef.current--;

    // Only clear drag state when we've left all nested elements
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasPanopticonItem = e.dataTransfer.types.includes('application/x-panopticon-item');
    if (hasFiles || hasPanopticonItem) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0; // Reset counter on drop

    if (readOnly || !ipcRenderer) {
      console.log('[EphemeraBox] Drop ignored: readOnly or no ipcRenderer');
      return;
    }

    if (!handlers) {
      console.error('[EphemeraBox] No handlers for entityType:', entityType);
      return;
    }

    // Check for Panopticon item drop first
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only handle attachment drops (images, documents)
        if (item.entityType === 'attachment') {
          console.log('[EphemeraBox] Dropping Panopticon attachment:', item.id, 'to', entityType, entityId);
          // Link the existing attachment to this entity
          await ipcRenderer.invoke(handlers.add, {
            [handlers.idField]: entityId,
            attachmentId: item.id
          });
          console.log('[EphemeraBox] Linked attachment', item.id, 'to', entityType, entityId);
          onAttachmentsChange?.();
        }
      } catch (err) {
        console.error('[EphemeraBox] Failed to handle Panopticon drop:', err);
      }
      return;
    }

    // Handle file drops
    if (!e.dataTransfer.types.includes('Files')) {
      console.log('[EphemeraBox] Drop ignored: not a file drop');
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    console.log('[EphemeraBox] Dropping', files.length, 'files to', entityType, entityId);

    let addedCount = 0;
    for (const file of files) {
      try {
        const result = await ipcRenderer.invoke('add-attachment', { filePath: file.path });
        if (result.success) {
          await ipcRenderer.invoke(handlers.add, {
            [handlers.idField]: entityId,
            attachmentId: result.attachment.id
          });
          addedCount++;
        } else {
          console.error('[EphemeraBox] Failed to add attachment:', result.error);
        }
      } catch (err) {
        console.error('[EphemeraBox] Error adding attachment:', err);
      }
    }
    console.log('[EphemeraBox] Added', addedCount, 'of', files.length, 'files');
    onAttachmentsChange?.();
  }, [readOnly, entityId, entityType, handlers, onAttachmentsChange]);

  // ============================================
  // Add via picker
  // ============================================

  const handleAddClick = useCallback(async () => {
    if (!ipcRenderer || readOnly) return;

    try {
      const result = await ipcRenderer.invoke('show-attachment-picker');
      if (!result.canceled && result.paths.length > 0) {
        for (const filePath of result.paths) {
          const addResult = await ipcRenderer.invoke('add-attachment', { filePath });
          if (addResult.success) {
            await ipcRenderer.invoke(handlers.add, {
              [handlers.idField]: entityId,
              attachmentId: addResult.attachment.id
            });
          }
        }
        onAttachmentsChange?.();
      }
    } catch (err) {
      console.error('Error adding attachment:', err);
    }
  }, [readOnly, entityId, handlers, onAttachmentsChange]);

  // ============================================
  // Remove attachment
  // ============================================

  const handleRemove = useCallback(async (attachmentId) => {
    if (!ipcRenderer || readOnly) return;

    try {
      await ipcRenderer.invoke(handlers.remove, {
        [handlers.idField]: entityId,
        attachmentId
      });
      onAttachmentsChange?.();
    } catch (err) {
      console.error('Error removing attachment:', err);
    }
  }, [readOnly, entityId, handlers, onAttachmentsChange]);

  // ============================================
  // Drag-to-reorder handlers
  // ============================================

  const handleItemDragStart = useCallback((e, index) => {
    if (readOnly) return;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Also set Panopticon attachment data for cross-component drops (e.g., to cover)
    const attachment = normalizedAttachments[index];
    if (attachment) {
      e.dataTransfer.setData('application/x-panopticon-item', JSON.stringify({
        entityType: 'attachment',
        id: attachment.id,
        type: attachment.type,
        originalName: attachment.originalName,
        isImage: attachment.isImage
      }));
    }

    setDraggedIndex(index);
  }, [readOnly, normalizedAttachments]);

  const handleItemDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedIndex === null || draggedIndex === index) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position = e.clientX < midpoint ? 'before' : 'after';

    setDragOverIndex(index);
    setDragPosition(position);
  }, [draggedIndex]);

  const handleItemDragLeave = useCallback(() => {
    setDragOverIndex(null);
    setDragPosition(null);
  }, []);

  const handleItemDrop = useCallback(async (e, targetIndex) => {
    e.preventDefault();

    // If this is a file drop (not internal reorder), let it bubble to container's handleDrop
    if (e.dataTransfer.types.includes('Files') && draggedIndex === null) {
      // Don't stop propagation - let the container handle file drops
      handleDrop(e);
      return;
    }

    e.stopPropagation();

    if (draggedIndex === null || !ipcRenderer || readOnly) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragPosition(null);
      return;
    }

    // Calculate new order (use normalizedAttachments which matches render order)
    const newOrder = [...normalizedAttachments];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);

    let insertIndex = targetIndex;
    if (draggedIndex < targetIndex) {
      insertIndex = dragPosition === 'after' ? targetIndex : targetIndex - 1;
    } else {
      insertIndex = dragPosition === 'after' ? targetIndex + 1 : targetIndex;
    }

    newOrder.splice(insertIndex, 0, draggedItem);

    // Save new order
    const attachmentIds = newOrder.map(att => att.id);
    try {
      await ipcRenderer.invoke(handlers.reorder, {
        [handlers.idField]: entityId,
        attachmentIds
      });
      onAttachmentsChange?.();
    } catch (err) {
      console.error('Error reordering attachments:', err);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragPosition(null);
  }, [draggedIndex, dragPosition, normalizedAttachments, handlers, entityId, readOnly, onAttachmentsChange, handleDrop]);

  const handleItemDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragPosition(null);
  }, []);

  // ============================================
  // Click handlers
  // ============================================

  const handleClick = useCallback((attachment, index) => {
    if (attachment.type === 'image') {
      if (onOpenLightbox) {
        const imageIndex = imageAttachments.findIndex(img => img.id === attachment.id);
        onOpenLightbox(imageIndex, imageAttachments);
      } else {
        // Use internal lightbox
        const imageIndex = imageAttachments.findIndex(img => img.id === attachment.id);
        setLightboxIndex(imageIndex);
        setLightboxOpen(true);
      }
    } else {
      // Text/document file
      if (onOpenTextViewer) {
        onOpenTextViewer(attachment);
      } else {
        // Use internal text viewer
        handleOpenTextFile(attachment);
      }
    }
  }, [imageAttachments, onOpenLightbox, onOpenTextViewer]);

  const handleOpenTextFile = async (attachment) => {
    try {
      const result = await ipcRenderer.invoke('read-text-file', attachment.path);
      if (result.success) {
        const ext = attachment.originalName?.split('.').pop()?.toLowerCase();
        setTextViewerContent({
          title: attachment.originalName,
          content: result.content,
          format: ext === 'md' ? 'markdown' : 'plain'
        });
        setTextViewerOpen(true);
      }
    } catch (err) {
      console.error('Failed to read text file:', err);
    }
  };

  // ============================================
  // Lightbox navigation
  // ============================================

  const closeLightbox = () => setLightboxOpen(false);
  const nextImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev + 1) % imageAttachments.length);
  };
  const prevImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev - 1 + imageAttachments.length) % imageAttachments.length);
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!lightboxOpen) return;

    const handleKey = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, imageAttachments.length]);

  // ============================================
  // Render
  // ============================================

  const isEmpty = normalizedAttachments.length === 0;
  const showSlider = showSizeSlider && variant === 'full' && !isEmpty;

  return (
    <>
      <div
        className={`ephemera-box ephemera-box-${variant} ${isDragOver ? 'drag-over' : ''} ${isEmpty ? 'empty' : ''} ${className}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {showHeader && variant === 'full' && (
          <div className="ephemera-box-header">─── Ephemera ───</div>
        )}


        <div className="ephemera-scroll">
          {!isEmpty && (
            <>
              {normalizedAttachments.map((att, index) => {
                const isDragging = draggedIndex === index;
                const isDragTarget = dragOverIndex === index;

                return (
                  <div
                    key={att.id}
                    className={`ephemera-item ${att.isImage ? '' : 'ephemera-item-document'} ${isDragging ? 'dragging' : ''} ${isDragTarget ? `drag-target-${dragPosition}` : ''}`}
                    style={{
                      width: variant === 'compact' ? 50 : ephemeraSize,
                      height: variant === 'compact' ? 50 : ephemeraSize
                    }}
                    draggable={!readOnly}
                    onDragStart={(e) => handleItemDragStart(e, index)}
                    onDragOver={(e) => handleItemDragOver(e, index)}
                    onDragLeave={handleItemDragLeave}
                    onDrop={(e) => handleItemDrop(e, index)}
                    onDragEnd={handleItemDragEnd}
                    onClick={() => handleClick(att, index)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu?.(e, att, {
                        entityType,
                        entityId,
                        onUpdate: onAttachmentsChange
                      });
                    }}
                    title={att.originalName}
                  >
                    {att.isImage ? (
                      <img
                        src={`local://${att.thumbnailPath || att.path}`}
                        alt={att.originalName}
                      />
                    ) : (
                      <div className="ephemera-item-icon-container">
                        <span className="ephemera-item-icon">{getDocIcon(att.type, att.originalName)}</span>
                        {variant !== 'compact' && (
                          <span className="ephemera-item-label">{att.originalName}</span>
                        )}
                      </div>
                    )}
                    {!readOnly && (
                      <button
                        className="ephemera-item-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(att.id);
                        }}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}

              </>
          )}
        </div>

        {showSlider && (
          <div className="ephemera-size-control">
            <input
              type="range"
              className="ephemera-size-slider"
              min={60}
              max={200}
              value={ephemeraSize}
              onChange={(e) => setEphemeraSize(Number(e.target.value))}
              title="Adjust thumbnail size"
            />
          </div>
        )}
      </div>

      {/* Internal Lightbox */}
      {lightboxOpen && imageAttachments.length > 0 && ReactDOM.createPortal(
        <div className="ephemera-lightbox-overlay" onClick={closeLightbox}>
          <button className="ephemera-lightbox-close" onClick={closeLightbox}>×</button>
          {imageAttachments.length > 1 && (
            <>
              <button className="ephemera-lightbox-prev" onClick={prevImage}>‹</button>
              <button className="ephemera-lightbox-next" onClick={nextImage}>›</button>
            </>
          )}
          <img
            src={`local://${imageAttachments[lightboxIndex]?.path}`}
            alt={imageAttachments[lightboxIndex]?.originalName}
            className="ephemera-lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="ephemera-lightbox-caption">
            {imageAttachments[lightboxIndex]?.originalName}
            {imageAttachments.length > 1 && ` (${lightboxIndex + 1}/${imageAttachments.length})`}
          </div>
        </div>,
        document.body
      )}

      {/* Internal Text Viewer */}
      {textViewerOpen && ReactDOM.createPortal(
        <div className="ephemera-text-viewer-overlay" onClick={() => setTextViewerOpen(false)}>
          <div className="ephemera-text-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="ephemera-text-viewer-header">
              <span className="ephemera-text-viewer-title">{textViewerContent.title}</span>
              <button className="ephemera-text-viewer-close" onClick={() => setTextViewerOpen(false)}>×</button>
            </div>
            <div className="ephemera-text-viewer-content">
              <pre>{textViewerContent.content}</pre>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default EphemeraBox;
