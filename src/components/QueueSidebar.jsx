import React, { useState, useRef } from 'react';
import '../styles/QueueSidebar.css';

function QueueSidebar({
  queue,
  queuePosition = 0,
  onQueueChange,
  onTrackSelect,
  playbackHistory = [],
  // Playback controls
  isPlaying,
  onPlayPause,
  onStop,
  onSkipNext,
  onSkipPrev,
  volume,
  onVolumeChange,
  // Program state
  activeProgramId,
  onEndProgram,
  // Context menu
  onTrackContextMenu
}) {
  const [activeTab, setActiveTab] = useState('queue');
  const previousQueueRef = useRef(null); // Store queue before clear for undo
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Add a slight delay to allow the drag image to be captured
    setTimeout(() => {
      e.target.closest('.queue-item')?.classList.add('dragging');
    }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.closest('.queue-item')?.classList.remove('dragging');
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Determine if we're in the top or bottom half of the item
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const dropIndex = e.clientY < midpoint ? index : index + 1;
    if (dropIndex !== dragOverIndex) {
      setDragOverIndex(dropIndex);
    }
  };

  const handleDragLeave = (e) => {
    // Only clear if leaving the queue-item entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (draggedIndex === null || dragOverIndex === null) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Calculate actual insert position
    let insertIndex = dragOverIndex;
    // If dragging down, account for removal shifting indices
    if (draggedIndex < insertIndex) {
      insertIndex -= 1;
    }

    if (draggedIndex === insertIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newQueue = [...queue];
    const [draggedItem] = newQueue.splice(draggedIndex, 1);
    newQueue.splice(insertIndex, 0, draggedItem);

    onQueueChange(newQueue);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleRemoveTrack = (e, queueId) => {
    e.preventDefault();
    e.stopPropagation();
    // Store current state before removing (for undo)
    previousQueueRef.current = [...queue];
    // Filter by queueId (unique instance ID), not track id
    const newQueue = queue.filter(t => t.queueId !== queueId);
    console.log('Removing queueId:', queueId, 'Queue before:', queue.length, 'Queue after:', newQueue.length);
    onQueueChange(newQueue);
  };

  const handleTrackClick = (e, track) => {
    // Don't trigger if clicking on a button
    if (e.target.closest('button')) return;
    if (onTrackSelect) {
      onTrackSelect(track);
    }
  };

  const handleTrackRightClick = (e, track, context) => {
    e.preventDefault();
    e.stopPropagation();
    if (onTrackContextMenu) {
      onTrackContextMenu(e, track, context);
    }
  };

  const handleClearQueue = () => {
    // Allow clearing if queue has items OR if there's an active program to end
    if (queue.length === 0 && !activeProgramId) return;

    console.log('Clearing queue, current length:', queue.length, 'activeProgram:', activeProgramId);

    if (queue.length > 0) {
      previousQueueRef.current = [...queue]; // Store for undo
      onQueueChange([]);
    }

    // Also end any active program when clearing queue
    if (activeProgramId && onEndProgram) {
      onEndProgram();
    }
  };

  const handleUndoQueue = () => {
    if (previousQueueRef.current && previousQueueRef.current.length > 0) {
      console.log('Restoring queue, length:', previousQueueRef.current.length);
      onQueueChange(previousQueueRef.current);
      previousQueueRef.current = null; // Clear undo state
    }
  };

  const canUndo = previousQueueRef.current && previousQueueRef.current.length > 0;

  // Show history in reverse order (most recent first), limited to 50
  const history = [...playbackHistory].reverse().slice(0, 50);

  const items = activeTab === 'queue' ? queue : history;

  return (
    <div className="queue-sidebar">
      {/* Control Module - Transport & Volume */}
      <div className="control-module">
        <div className="transport-controls">
          <button
            className="transport-btn prev-btn"
            onClick={onSkipPrev}
            title="Previous"
          >
            ◀◀
          </button>
          <button
            className="transport-btn play-btn"
            onClick={onPlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            className="transport-btn stop-btn"
            onClick={onStop}
            title="Stop"
          >
            ■
          </button>
          <button
            className="transport-btn next-btn"
            onClick={onSkipNext}
            title="Next"
          >
            ▶▶
          </button>
        </div>
        
        <div className="volume-slider">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round((volume ?? 1) * 100)}
            onChange={(e) => onVolumeChange?.(Number(e.target.value) / 100)}
            title={`Volume: ${Math.round((volume ?? 1) * 100)}%`}
          />
        </div>
      </div>

      {/* Tab Headers */}
      <div className="queue-tabs">
        <button 
          className={`queue-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Queue
        </button>
        <button 
          className={`queue-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>
      
      {/* Queue actions - Clear/End Program, Undo */}
      {activeTab === 'queue' && (
        <div className="queue-actions">
          <button
            className={`clear-queue-btn ${activeProgramId ? 'end-program' : ''} ${queue.length === 0 && !activeProgramId ? 'disabled' : ''}`}
            onClick={handleClearQueue}
            disabled={queue.length === 0 && !activeProgramId}
            title={activeProgramId ? 'End program and clear queue' : 'Clear queue'}
          >
            {activeProgramId ? 'End Program' : 'Clear'}
          </button>
          <button
            className={`undo-queue-btn ${!canUndo ? 'disabled' : ''}`}
            onClick={handleUndoQueue}
            disabled={!canUndo}
            title="Undo last clear"
          >
            ↺
          </button>
        </div>
      )}
      
      <div className="queue-list">
        {items.length > 0 ? (
          items.map((track, index) => (
            <React.Fragment key={track.queueId || `history-${track.id}`}>
              {/* Drop indicator line before this item */}
              {activeTab === 'queue' && dragOverIndex === index && draggedIndex !== index && draggedIndex !== index - 1 && (
                <div className="queue-drop-indicator" />
              )}
              <div
                className={`queue-item ${draggedIndex === index ? 'dragging' : ''} ${activeTab === 'queue' && index === queuePosition ? 'current' : ''} ${activeTab === 'queue' && index < queuePosition ? 'played' : ''}`}
                onClick={(e) => handleTrackClick(e, track)}
                onContextMenu={(e) => handleTrackRightClick(e, track, activeTab)}
                draggable={activeTab === 'queue'}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {activeTab === 'queue' && (
                  <div className="queue-item-drag" title="Drag to reorder">
                    <span>⋮⋮</span>
                  </div>
                )}
                <div className="queue-item-number">{index + 1}</div>
                <div className="queue-item-art">
                  {track.albumArt ? (
                    <img
                      src={`local://${track.albumArt.replace('thumbnail.jpg', 'thumbnail-small.jpg')}`}
                      alt=""
                      onError={(e) => {
                        // Fall back to large thumbnail if small doesn't exist
                        if (e.target.src.includes('thumbnail-small.jpg')) {
                          e.target.src = `local://${track.albumArt}`;
                        }
                      }}
                    />
                  ) : (
                    <div className="queue-item-art-placeholder" />
                  )}
                </div>
                <div className="queue-item-info">
                  <div className="queue-item-title">{track.title}</div>
                  <div className="queue-item-artist">{track.artist}</div>
                </div>
                {activeTab === 'queue' && (
                  <button
                    className="queue-item-remove"
                    onClick={(e) => handleRemoveTrack(e, track.queueId)}
                    title="Remove from queue"
                  >
                    ×
                  </button>
                )}
              </div>
            </React.Fragment>
          ))
        ) : null}
        {/* Drop indicator at end of list */}
        {activeTab === 'queue' && items.length > 0 && dragOverIndex === items.length && draggedIndex !== items.length - 1 && (
          <div className="queue-drop-indicator" />
        )}
      </div>
    </div>
  );
}

export default QueueSidebar;
