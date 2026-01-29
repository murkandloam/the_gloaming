/**
 * Panopticon - Asset Management Interface
 *
 * "Opening the hood to change the oil."
 * Full-screen takeover with cosmic void aesthetic.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './PanopticonView.css';
import RecordDetailPanel from '../components/RecordDetailPanel';
import TrackDetailPanel from '../components/TrackDetailPanel';
import MixtapeDetailPanel from '../components/MixtapeDetailPanel';
import NascentSleeveModal from '../components/NascentSleeveModal';

// Eye assets
import eyecentre from '../assets/panopticon/eyecentre.png';
import eyeleft from '../assets/panopticon/eyeleft.png';
import eyeright from '../assets/panopticon/eyeright.png';
import eyeblink from '../assets/panopticon/eyeblink.png';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// ============================================
// The Eye Component
// ============================================
function TheEye() {
  const [eyeState, setEyeState] = useState('centre'); // 'left' | 'centre' | 'right' | 'blink'
  const blinkTimeoutRef = useRef(null);
  const isBlinkingRef = useRef(false);
  const preBlinkStateRef = useRef('centre'); // Remember state before blink

  // Cursor tracking
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isBlinkingRef.current) return;

      const third = window.innerWidth / 3;
      let newState;
      if (e.clientX < third) {
        newState = 'left';
      } else if (e.clientX > third * 2) {
        newState = 'right';
      } else {
        newState = 'centre';
      }
      setEyeState(newState);
      preBlinkStateRef.current = newState; // Track for blink recovery
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Blink animation (every 13-17 seconds)
  // Blink persists for 250ms and is not interruptible
  useEffect(() => {
    let blinkReturnTimeout = null;

    const scheduleBlink = () => {
      const delay = 13000 + Math.random() * 4000; // 13-17 seconds
      blinkTimeoutRef.current = setTimeout(() => {
        isBlinkingRef.current = true;
        setEyeState('blink');

        // Return to previous state after 250ms
        blinkReturnTimeout = setTimeout(() => {
          isBlinkingRef.current = false;
          setEyeState(preBlinkStateRef.current); // Restore pre-blink state
          scheduleBlink();
        }, 250);
      }, delay);
    };

    scheduleBlink();
    return () => {
      if (blinkTimeoutRef.current) clearTimeout(blinkTimeoutRef.current);
      if (blinkReturnTimeout) clearTimeout(blinkReturnTimeout);
    };
  }, []);

  const eyeImages = {
    left: eyeleft,
    centre: eyecentre,
    right: eyeright,
    blink: eyeblink
  };

  return (
    <div className="panopticon-eye">
      <img src={eyeImages[eyeState]} alt="The Eye" />
    </div>
  );
}

// ============================================
// List View Component
// ============================================
function PanopticonListView({ items, selectedIds, linkedIds, onItemClick, getThumbnailUrl, formatSize, isFiltered, onEmptyClick, onDisplayOrderChange }) {
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'

  // Handle column header click for sorting
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get sortable name/title for any item
  const getItemName = (item) => {
    if (item.entityType === 'attachment') return item.filename || '';
    return item.title || '';
  };

  // Get type display for any item
  const getItemType = (item) => {
    if (item.entityType === 'record') return 'RECORD';
    if (item.entityType === 'track') return 'TRACK';
    if (item.entityType === 'mixtape') return 'CASSETTE';
    if (!item.type) return '—';
    const parts = item.type.split('/');
    return parts[1]?.toUpperCase() || parts[0].toUpperCase();
  };

  // Sort items - memoized to prevent unnecessary recalculations
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let aVal, bVal;

      switch (sortColumn) {
        case 'name':
          aVal = getItemName(a).toLowerCase();
          bVal = getItemName(b).toLowerCase();
          break;
        case 'type':
          aVal = getItemType(a);
          bVal = getItemType(b);
          break;
        case 'size':
          aVal = a.fileSize || 0;
          bVal = b.fileSize || 0;
          break;
        case 'artist':
          aVal = a.artist?.toLowerCase() || '';
          bVal = b.artist?.toLowerCase() || '';
          break;
        case 'linked':
          aVal = a.linkedTo?.length || 0;
          bVal = b.linkedTo?.length || 0;
          break;
        case 'added':
          aVal = a.addedAt ? new Date(a.addedAt).getTime() : 0;
          bVal = b.addedAt ? new Date(b.addedAt).getTime() : 0;
          break;
        default:
          aVal = '';
          bVal = '';
      }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return sortDirection === 'asc' ? cmp : -cmp;
      } else {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });
  }, [items, sortColumn, sortDirection]);

  // Report sorted order to parent for correct shift-click range selection
  // Use a ref to track previous order and only update when IDs actually change
  const prevSortedIdsRef = useRef('');
  useEffect(() => {
    if (onDisplayOrderChange) {
      const currentIds = sortedItems.map(item => item.id).join(',');
      if (currentIds !== prevSortedIdsRef.current) {
        prevSortedIdsRef.current = currentIds;
        onDisplayOrderChange(sortedItems);
      }
    }
  }, [sortedItems, onDisplayOrderChange]);

  // Format linked count
  const formatLinked = (item) => {
    if (item.entityType !== 'attachment') return '—';
    if (!item.linkedTo || item.linkedTo.length === 0) return '—';
    return `${item.linkedTo.length} item${item.linkedTo.length !== 1 ? 's' : ''}`;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };

  // Format size or info
  const formatInfo = (item) => {
    if (item.entityType === 'attachment') {
      return formatSize(item.fileSize);
    } else if (item.entityType === 'record') {
      return `${item.trackCount || 0} tracks`;
    } else if (item.entityType === 'track') {
      if (!item.duration) return '—';
      const mins = Math.floor(item.duration / 60);
      const secs = Math.floor(item.duration % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    } else if (item.entityType === 'mixtape') {
      return `${item.trackCount || 0} tracks`;
    }
    return '—';
  };

  // Sort indicator
  const SortIndicator = ({ column }) => {
    if (sortColumn !== column) return null;
    return <span className="panopticon-sort-indicator">{sortDirection === 'asc' ? '▲' : '▼'}</span>;
  };

  if (items.length === 0) {
    return (
      <div className="panopticon-list-empty">
        {isFiltered
          ? "No items match filters"
          : "No items in library"}
      </div>
    );
  }

  return (
    <div
      className="panopticon-list"
      onClick={(e) => {
        // If clicking on the list container (not a row), deselect
        if (e.target === e.currentTarget) {
          onEmptyClick?.();
        }
      }}
    >
      {/* Header row */}
      <div className="panopticon-list-header">
        <div className="panopticon-list-col panopticon-list-col-thumb"></div>
        <div
          className="panopticon-list-col panopticon-list-col-filename sortable"
          onClick={() => handleSort('name')}
        >
          Name <SortIndicator column="name" />
        </div>
        <div
          className="panopticon-list-col panopticon-list-col-artist sortable"
          onClick={() => handleSort('artist')}
        >
          Artist <SortIndicator column="artist" />
        </div>
        <div
          className="panopticon-list-col panopticon-list-col-type sortable"
          onClick={() => handleSort('type')}
        >
          Type <SortIndicator column="type" />
        </div>
        <div
          className="panopticon-list-col panopticon-list-col-size sortable"
          onClick={() => handleSort('size')}
        >
          Info <SortIndicator column="size" />
        </div>
        <div
          className="panopticon-list-col panopticon-list-col-added sortable"
          onClick={() => handleSort('added')}
        >
          Added <SortIndicator column="added" />
        </div>
      </div>

      {/* Data rows */}
      {sortedItems.map(item => {
        const isSelected = selectedIds.has(item.id);
        const isLinked = linkedIds?.has(item.id);
        const isStray = item.entityType === 'attachment' &&
          (!item.linkedTo || item.linkedTo.length === 0) &&
          (!item.isCoverFor || item.isCoverFor.length === 0);

        // Get thumbnail URL based on entity type (prefer small thumbnail for list view)
        let thumbUrl = null;
        if (item.entityType === 'attachment') {
          thumbUrl = getThumbnailUrl(item, true); // true = prefer small
        } else if (item.thumbnailPath) {
          // Try small thumbnail first, fall back to regular thumbnail
          const smallThumbPath = item.thumbnailPath.replace('thumbnail.jpg', 'thumbnail-small.jpg');
          thumbUrl = `local://${smallThumbPath}`;
        }

        // Get placeholder icon
        const getPlaceholder = () => {
          if (item.entityType === 'record') return '💿';
          if (item.entityType === 'track') return '🎵';
          return item.filename?.endsWith('.pdf') ? '📄' : '📎';
        };

        // Handle drag start - set dataTransfer with item info
        const handleDragStart = (e) => {
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('application/x-panopticon-item', JSON.stringify({
            id: item.id,
            entityType: item.entityType,
            // Include relevant data for drop handling
            title: getItemName(item),
            artist: item.artist,
            path: item.path,
            thumbnailPath: item.thumbnailPath,
            type: item.type,
            filename: item.filename,
            // For tracks, include audio path and album info
            audioPath: item.audioPath,
            albumId: item.albumId,
            duration: item.duration,
            trackNumber: item.trackNumber
          }));
          // Also set text for fallback
          e.dataTransfer.setData('text/plain', getItemName(item));
        };

        return (
          <div
            key={`${item.entityType}-${item.id}`}
            data-item-id={item.id}
            className={`panopticon-list-row ${isSelected ? 'selected' : ''} ${isStray ? 'stray' : ''} ${isLinked ? 'linked' : ''}`}
            onClick={(e) => onItemClick(e, item.id, item.entityType)}
            draggable
            onDragStart={handleDragStart}
          >
            <div className="panopticon-list-col panopticon-list-col-thumb">
              <div className="panopticon-list-thumb">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={getItemName(item)}
                    onError={(e) => {
                      // Fall back to large thumbnail if small doesn't exist
                      if (e.target.src.includes('thumbnail-small.jpg')) {
                        e.target.src = e.target.src.replace('thumbnail-small.jpg', 'thumbnail.jpg');
                      }
                    }}
                  />
                ) : (
                  <span className="panopticon-list-thumb-placeholder">
                    {getPlaceholder()}
                  </span>
                )}
              </div>
            </div>
            <div className="panopticon-list-col panopticon-list-col-filename">
              {getItemName(item)}
            </div>
            <div className="panopticon-list-col panopticon-list-col-artist">
              {item.artist || '—'}
            </div>
            <div className="panopticon-list-col panopticon-list-col-type">
              {getItemType(item)}
            </div>
            <div className="panopticon-list-col panopticon-list-col-size">
              {formatInfo(item)}
            </div>
            <div className="panopticon-list-col panopticon-list-col-added">
              {formatDate(item.addedAt)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Single Track Induction View Component
// ============================================
function SingleTrackInductionView({ track, records, onAbort, onDeposit, onAddToRecord }) {
  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [title, setTitle] = useState(track?.title || '');
  const [artist, setArtist] = useState(track?.artist || '');
  const [year, setYear] = useState(track?.year || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [depositing, setDepositing] = useState(false);

  // Search records for "add to existing"
  const filteredRecords = records.filter(r => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return r.title?.toLowerCase().includes(query) ||
           r.artist?.toLowerCase().includes(query);
  }).slice(0, 10);

  // Check if track's album matches an existing record (smart default)
  useEffect(() => {
    if (track?.album) {
      const matchingRecord = records.find(r =>
        r.title?.toLowerCase() === track.album.toLowerCase()
      );
      if (matchingRecord) {
        setMode('existing');
        setSelectedRecordId(matchingRecord.id);
      }
    }
  }, [track, records]);

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDeposit = async () => {
    setDepositing(true);
    try {
      if (mode === 'existing' && selectedRecordId) {
        await onAddToRecord(selectedRecordId, [track.path]);
      } else {
        await onDeposit({
          trackPath: track.path,
          title: title || track.title,
          artist: artist || track.artist,
          year
        });
      }
    } catch (err) {
      console.error('Single track deposit failed:', err);
      setDepositing(false);
    }
  };

  const canDeposit = mode === 'existing'
    ? selectedRecordId !== null
    : title && artist;

  return (
    <div className="panopticon-induction">
      {/* Header */}
      <div className="panopticon-induction-header">
        <div className="panopticon-induction-title">
          <TheEye />
          <span className="panopticon-induction-label">INDUCTION — SINGLE TRACK</span>
        </div>
      </div>

      {/* Content */}
      <div className="panopticon-single-track-content">
        {/* Track Info */}
        <div className="panopticon-single-track-info">
          <div className="panopticon-single-track-filename">
            Track: "{track?.filename}"
          </div>
          {track?.album && (
            <div className="panopticon-single-track-detected">
              Detected: {track.artist} — {track.title}
              {track.album && ` (from: ${track.album})`}
            </div>
          )}
        </div>

        {/* Mode Selection */}
        <div className="panopticon-single-track-options">
          {/* Add to existing record */}
          <label className="panopticon-single-track-option">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            <span className="panopticon-single-track-option-label">
              Add to existing record:
            </span>
          </label>

          {mode === 'existing' && (
            <div className="panopticon-single-track-search">
              <input
                type="text"
                placeholder="Search records..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="panopticon-single-track-search-input"
              />
              <div className="panopticon-single-track-results">
                {filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className={`panopticon-single-track-result ${selectedRecordId === record.id ? 'selected' : ''}`}
                    onClick={() => setSelectedRecordId(record.id)}
                  >
                    <span className="panopticon-single-track-result-title">{record.title}</span>
                    <span className="panopticon-single-track-result-artist">{record.artist}</span>
                  </div>
                ))}
                {filteredRecords.length === 0 && searchQuery && (
                  <div className="panopticon-single-track-no-results">No matching records</div>
                )}
              </div>
            </div>
          )}

          {/* Create new record */}
          <label className="panopticon-single-track-option">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span className="panopticon-single-track-option-label">
              Create new single-track record
            </span>
          </label>

          {mode === 'new' && (
            <div className="panopticon-single-track-form">
              <div className="panopticon-induction-field">
                <label>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Record title"
                />
              </div>
              <div className="panopticon-induction-field">
                <label>Artist</label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Artist name"
                />
              </div>
              <div className="panopticon-induction-field">
                <label>Year</label>
                <input
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Release year"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="panopticon-induction-footer">
        <button className="panopticon-cancel-btn" onClick={onAbort}>
          Cancel
        </button>
        <button
          className="panopticon-deposit-action-btn"
          onClick={handleDeposit}
          disabled={depositing || !canDeposit}
        >
          {depositing ? 'DEPOSITING...' : 'DEPOSIT TO LIBRARY →'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Induction Summary View Component
// The unified entry point for all inductions
// Shows summary, warnings, and Trust/Review/Cancel options
// ============================================
function InductionSummaryView({
  analysisResults, // Array of analysis results (one per folder/file group)
  onTrustTheEye,   // Import all with defaults
  onReview,        // Go to per-item review
  onCancel         // Abort induction
}) {
  // Calculate summary statistics
  const summary = useMemo(() => {
    let totalRecords = 0;
    let totalTracks = 0;
    let totalImages = 0;
    let strayCandidates = [];
    let duplicates = [];
    let compilations = [];

    for (const result of analysisResults) {
      if (result.hasMultipleAlbums && result.albumGroups) {
        totalRecords += result.albumGroups.length;
        for (const group of result.albumGroups) {
          totalTracks += group.tracks?.length || 0;
          totalImages += group.images?.length || 0;
        }
        // If there are also stray candidates, they become a separate record
        if (result.strayCandidates?.length > 0) {
          totalRecords += 1;
          totalTracks += result.strayCandidates.length;
        }
      } else if (result.strayCandidates?.length > 0 && result.tracks?.length === result.strayCandidates?.length) {
        // All tracks are strays - still counts as 1 record
        totalRecords += 1;
        totalTracks += result.strayCandidates.length;
        totalImages += result.images?.length || 0;
      } else {
        totalRecords += 1;
        totalTracks += result.tracks?.length || 0;
        totalImages += result.images?.length || 0;
      }

      if (result.strayCandidates?.length > 0) {
        strayCandidates.push(...result.strayCandidates);
      }

      // Collect duplicates - check both folder-level and per-album-group duplicates
      if (result.hasPotentialDuplicate) {
        if (result.duplicateAlbums?.length > 0) {
          // Multi-album case: each duplicate album group
          for (const dupAlbum of result.duplicateAlbums) {
            duplicates.push({
              title: dupAlbum.album,
              artist: dupAlbum.albumArtist,
              existingRecord: dupAlbum.matchingRecord
            });
          }
        } else if (result.matchingRecord) {
          // Single album case
          duplicates.push({
            title: result.suggestedTitle,
            artist: result.suggestedArtist,
            existingRecord: result.matchingRecord
          });
        }
      }

      // Also check albumGroups directly for duplicates (artist folder case)
      if (result.albumGroups) {
        for (const group of result.albumGroups) {
          if (group.hasPotentialDuplicate && group.matchingRecord) {
            // Avoid adding duplicates we already added from duplicateAlbums
            const alreadyAdded = duplicates.some(d =>
              d.title === group.album && d.artist === group.albumArtist
            );
            if (!alreadyAdded) {
              duplicates.push({
                title: group.album,
                artist: group.albumArtist,
                existingRecord: group.matchingRecord
              });
            }
          }
        }
      }

      if (result.isLikelyCompilation) {
        compilations.push({
          title: result.suggestedTitle,
          artistCount: Object.keys(result.artistCounts || {}).length
        });
      }
    }

    return {
      totalRecords,
      totalTracks,
      totalImages,
      strayCandidates,
      duplicates,
      compilations,
      hasWarnings: strayCandidates.length > 0 || duplicates.length > 0
    };
  }, [analysisResults]);

  return (
    <div className="panopticon-induction induction-summary">
      {/* Header with Eye */}
      <div className="panopticon-induction-header">
        <div className="panopticon-induction-title">
          <TheEye />
          <span className="panopticon-induction-label">INDUCTION</span>
        </div>
      </div>

      {/* Summary Content */}
      <div className="induction-summary-content">
        {/* Main stats */}
        <div className="induction-summary-stats">
          <div className="induction-stat">
            <span className="induction-stat-value">{summary.totalRecords}</span>
            <span className="induction-stat-label">{summary.totalRecords === 1 ? 'Record' : 'Records'}</span>
          </div>
          <div className="induction-stat">
            <span className="induction-stat-value">{summary.totalTracks}</span>
            <span className="induction-stat-label">{summary.totalTracks === 1 ? 'Track' : 'Tracks'}</span>
          </div>
          {summary.totalImages > 0 && (
            <div className="induction-stat">
              <span className="induction-stat-value">{summary.totalImages}</span>
              <span className="induction-stat-label">{summary.totalImages === 1 ? 'Image' : 'Images'}</span>
            </div>
          )}
        </div>

        {/* Warnings section */}
        {summary.hasWarnings && (
          <div className="induction-summary-warnings">
            {summary.duplicates.length > 0 && (
              <div className="induction-warning duplicate-warning">
                <span className="induction-warning-icon">⚠</span>
                <span className="induction-warning-text">
                  {summary.duplicates.length === 1
                    ? `"${summary.duplicates[0].title}" may already exist in your library`
                    : `${summary.duplicates.length} potential duplicates detected`
                  }
                </span>
              </div>
            )}
            {summary.strayCandidates.length > 0 && (
              <div className="induction-warning stray-warning">
                <span className="induction-warning-icon">○</span>
                <span className="induction-warning-text">
                  {summary.strayCandidates.length} {summary.strayCandidates.length === 1 ? 'track has' : 'tracks have'} no album metadata (will become strays)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Record list preview */}
        <div className="induction-summary-records">
          {analysisResults.map((result, idx) => {
            if (result.hasMultipleAlbums && result.albumGroups) {
              return result.albumGroups.map((group, gIdx) => (
                <div key={`${idx}-${gIdx}`} className="induction-record-preview">
                  <div className="induction-record-cover">
                    {group.images?.[0]?.dataUrl ? (
                      <img src={group.images[0].dataUrl} alt="" />
                    ) : group.images?.[0]?.path ? (
                      <img src={`local://${group.images[0].path}`} alt="" />
                    ) : (
                      <span className="induction-record-no-cover">♪</span>
                    )}
                  </div>
                  <div className="induction-record-info">
                    <span className="induction-record-title">{group.album || 'Unknown Album'}</span>
                    <span className="induction-record-artist">{group.albumArtist || 'Unknown Artist'}</span>
                    <span className="induction-record-tracks">{group.tracks?.length || 0} tracks</span>
                  </div>
                </div>
              ));
            } else {
              return (
                <div key={idx} className="induction-record-preview">
                  <div className="induction-record-cover">
                    {result.images?.[0]?.dataUrl ? (
                      <img src={result.images[0].dataUrl} alt="" />
                    ) : result.images?.[0]?.path ? (
                      <img src={`local://${result.images[0].path}`} alt="" />
                    ) : (
                      <span className="induction-record-no-cover">♪</span>
                    )}
                  </div>
                  <div className="induction-record-info">
                    <span className="induction-record-title">{result.suggestedTitle || 'Unknown Album'}</span>
                    <span className="induction-record-artist">{result.suggestedArtist || 'Unknown Artist'}</span>
                    <span className="induction-record-tracks">{result.tracks?.length || 0} tracks</span>
                  </div>
                </div>
              );
            }
          })}
        </div>
      </div>

      {/* Footer with action buttons */}
      <div className="panopticon-induction-footer induction-summary-footer">
        <button className="panopticon-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <div className="induction-summary-actions">
          <button
            className="panopticon-secondary-btn"
            onClick={onReview}
          >
            Review
          </button>
          <button
            className="panopticon-deposit-action-btn trust-the-eye-btn"
            onClick={onTrustTheEye}
          >
            Trust the Eye
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Multi-Album Split View Component
// ============================================
function MultiAlbumSplitView({ data, onAbort, onContinue }) {
  const [mode, setMode] = useState('separate'); // 'separate' | 'merge'
  const [selectedGroups, setSelectedGroups] = useState(
    new Set(data?.albumGroups?.map((_, i) => i) || [])
  );

  const toggleGroup = (index) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleContinue = () => {
    const selectedAlbumGroups = data.albumGroups.filter((_, i) => selectedGroups.has(i));
    onContinue({
      mode,
      selectedGroups: selectedAlbumGroups,
      mergeAll: mode === 'merge'
    });
  };

  return (
    <div className="panopticon-induction">
      {/* Header */}
      <div className="panopticon-induction-header">
        <div className="panopticon-induction-title">
          <TheEye />
          <span className="panopticon-induction-label">INDUCTION — MULTIPLE ALBUMS DETECTED</span>
        </div>
      </div>

      {/* Content */}
      <div className="panopticon-multi-album-content">
        <div className="panopticon-multi-album-intro">
          {data?.isLooseFiles
            ? `These files contain tracks from ${data?.albumGroups?.length || 0} different albums:`
            : `This folder contains tracks from ${data?.albumGroups?.length || 0} different albums:`
          }
        </div>

        {/* Album list with checkboxes */}
        <div className="panopticon-multi-album-list">
          {data?.albumGroups?.map((group, index) => (
            <label key={index} className="panopticon-multi-album-item">
              <input
                type="checkbox"
                checked={selectedGroups.has(index)}
                onChange={() => toggleGroup(index)}
              />
              <span className="panopticon-multi-album-name">
                {group.album} ({group.tracks.length} tracks)
              </span>
              <span className="panopticon-multi-album-artist">
                — {group.albumArtist || 'Unknown Artist'}
              </span>
            </label>
          ))}
        </div>

        {/* Mode selection */}
        <div className="panopticon-multi-album-options">
          <label className="panopticon-multi-album-option">
            <input
              type="radio"
              name="multi-album-mode"
              checked={mode === 'separate'}
              onChange={() => setMode('separate')}
            />
            <span className="panopticon-multi-album-option-label">
              Import as separate records (recommended)
            </span>
          </label>
          <label className="panopticon-multi-album-option">
            <input
              type="radio"
              name="multi-album-mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            <span className="panopticon-multi-album-option-label">
              Import as single record (merge all tracks)
            </span>
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="panopticon-induction-footer">
        <button className="panopticon-cancel-btn" onClick={onAbort}>
          Cancel
        </button>
        <button
          className="panopticon-deposit-action-btn"
          onClick={handleContinue}
          disabled={selectedGroups.size === 0}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ============================================
// Induction View Component
// ============================================
function InductionView({ data, onAbort, onDeposit, queuePosition, queueTotal, onSkip }) {
  // Editable record metadata
  const [title, setTitle] = useState(data?.suggestedTitle || '');
  const [artist, setArtist] = useState(data?.suggestedArtist || '');
  const [year, setYear] = useState(data?.suggestedYear || '');
  const [isCompilation, setIsCompilation] = useState(data?.isLikelyCompilation || false);
  const [selectedCover, setSelectedCover] = useState(data?.images?.[0]?.path || null);
  const [browsedCover, setBrowsedCover] = useState(null); // External cover selected via browse
  const [trackOrder, setTrackOrder] = useState(data?.tracks?.map(t => t.path) || []);
  const [depositing, setDepositing] = useState(false);
  // Text ephemera - checkboxes for which text files to import
  const [selectedTextFiles, setSelectedTextFiles] = useState(
    new Set(data?.textFiles?.map((_, i) => i) || [])
  );

  // Reset form state when data changes (new queue item)
  useEffect(() => {
    setTitle(data?.suggestedTitle || '');
    setArtist(data?.suggestedArtist || '');
    setYear(data?.suggestedYear || '');
    setIsCompilation(data?.isLikelyCompilation || false);
    setSelectedCover(data?.images?.[0]?.path || null);
    setBrowsedCover(null);
    setTrackOrder(data?.tracks?.map(t => t.path) || []);
    setDepositing(false);
    setSelectedTextFiles(new Set(data?.textFiles?.map((_, i) => i) || []));
  }, [data]);

  // Toggle text file selection
  const toggleTextFile = (index) => {
    setSelectedTextFiles(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Determine actual cover path - browsed cover takes precedence
  const effectiveCover = browsedCover || selectedCover;

  // Handle deposit
  const handleDeposit = async () => {
    setDepositing(true);
    try {
      // Get selected text files to import
      const textFilesToImport = data?.textFiles
        ?.filter((_, i) => selectedTextFiles.has(i))
        .map(tf => tf.path) || [];

      await onDeposit({
        folderPath: data.folderPath,
        title,
        artist: isCompilation ? 'Various Artists' : artist,
        year,
        isCompilation,
        coverPath: effectiveCover,
        trackOrder,
        importImages: data.images?.map(img => img.path) || [],
        importTextFiles: textFilesToImport
      });
    } catch (err) {
      console.error('Deposit failed:', err);
      setDepositing(false);
    }
  };

  // Handle browse for cover image
  const handleBrowseCover = async () => {
    if (!ipcRenderer) return;
    try {
      const result = await ipcRenderer.invoke('dialog:open-image', {
        title: 'Select cover image',
        buttonLabel: 'Use as Cover'
      });
      if (result && result.path) {
        setBrowsedCover(result.path);
        setSelectedCover(null); // Clear folder-based selection
      }
    } catch (err) {
      console.error('Failed to browse for cover:', err);
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine header label based on queue
  const headerLabel = queueTotal > 1
    ? `INDUCTION ${queuePosition} OF ${queueTotal}`
    : 'INDUCTION';

  return (
    <div className="panopticon-induction">
      {/* Induction Header */}
      <div className="panopticon-induction-header">
        <div className="panopticon-induction-title">
          <TheEye />
          <span className="panopticon-induction-label">{headerLabel}</span>
        </div>
        {queueTotal > 1 && queuePosition < queueTotal && (
          <button className="panopticon-skip-btn" onClick={onSkip}>
            Skip →
          </button>
        )}
      </div>

      {/* Induction Content */}
      <div className="panopticon-induction-content">
        {/* Left Panel: Found Assets */}
        <div className="panopticon-induction-left">
          <div className="panopticon-induction-section">
            <div className="panopticon-induction-section-title">FOUND IMAGES</div>
            <div className="panopticon-induction-images">
              {data?.images?.length > 0 ? (
                data.images.map((img, idx) => {
                  // Use dataUrl for embedded covers, local:// for file images
                  const imgSrc = img.isEmbedded ? img.dataUrl : `local://${img.path}`;
                  // Check if this image is selected (and no browsed cover is active)
                  const isSelected = !browsedCover && selectedCover === img.path;
                  return (
                    <div
                      key={idx}
                      className={`panopticon-induction-image ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedCover(img.path);
                        setBrowsedCover(null); // Clear browsed cover when selecting from folder
                      }}
                    >
                      <img src={imgSrc} alt={img.filename} />
                      <span className="panopticon-induction-image-name">{img.filename}</span>
                    </div>
                  );
                })
              ) : (
                <div className="panopticon-induction-empty">No images found</div>
              )}
            </div>
          </div>

          <div className="panopticon-induction-section">
            <div className="panopticon-induction-section-title">TRACKS FOUND</div>
            <div className="panopticon-induction-tracks-list">
              {data?.tracks?.length > 0 ? (
                data.tracks.map((track, idx) => (
                  <div key={idx} className="panopticon-induction-track-item">
                    <span className="panopticon-induction-track-num">{idx + 1}.</span>
                    <span className="panopticon-induction-track-title">{track.title || track.filename}</span>
                    <span className="panopticon-induction-track-duration">{formatDuration(track.duration)}</span>
                  </div>
                ))
              ) : (
                <div className="panopticon-induction-empty">No audio tracks found</div>
              )}
            </div>
          </div>

          {/* Text Ephemera Section */}
          {data?.textFiles?.length > 0 && (
            <div className="panopticon-induction-section">
              <div className="panopticon-induction-section-title">
                TEXT EPHEMERA
                <span className="panopticon-induction-section-hint">
                  ({data.textFiles.length} file{data.textFiles.length !== 1 ? 's' : ''})
                </span>
              </div>
              <div className="panopticon-induction-text-list">
                {data.textFiles.map((tf, idx) => (
                  <label key={idx} className="panopticon-induction-text-item">
                    <input
                      type="checkbox"
                      checked={selectedTextFiles.has(idx)}
                      onChange={() => toggleTextFile(idx)}
                    />
                    <span className="panopticon-induction-text-name">{tf.filename}</span>
                    <span className="panopticon-induction-text-type">.{tf.type}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Record Configuration */}
        <div className="panopticon-induction-right">
          <div className="panopticon-induction-section">
            <div className="panopticon-induction-section-title">RECORD CONFIGURATION</div>

            <div className="panopticon-induction-field">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Album title"
              />
            </div>

            <div className="panopticon-induction-field">
              <label>Artist</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist name"
                disabled={isCompilation}
              />
            </div>

            <div className="panopticon-induction-field">
              <label>Year</label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Release year"
              />
            </div>

            <div className="panopticon-induction-checkbox">
              <input
                type="checkbox"
                id="compilation"
                checked={isCompilation}
                onChange={(e) => setIsCompilation(e.target.checked)}
              />
              <label htmlFor="compilation">Compilation (Various Artists)</label>
            </div>
          </div>

          <div className="panopticon-induction-section">
            <div className="panopticon-induction-section-title">COVER ART</div>
            <div className="panopticon-induction-cover-preview">
              {effectiveCover ? (
                (() => {
                  // If browsed cover, use local:// directly
                  if (browsedCover) {
                    return <img src={`local://${browsedCover}`} alt="Selected cover" />;
                  }
                  // Otherwise find the selected image from data to get its src
                  const selectedImg = data?.images?.find(img => img.path === selectedCover);
                  const coverSrc = selectedImg?.isEmbedded
                    ? selectedImg.dataUrl
                    : `local://${selectedCover}`;
                  return <img src={coverSrc} alt="Selected cover" />;
                })()
              ) : (
                <div className="panopticon-induction-no-cover">No cover selected</div>
              )}
            </div>
            <div className="panopticon-induction-cover-actions">
              <button className="panopticon-browse-cover-btn" onClick={handleBrowseCover}>
                Browse...
              </button>
              <span className="panopticon-induction-cover-hint">
                or click an image on the left
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Induction Footer */}
      <div className="panopticon-induction-footer">
        <button className="panopticon-cancel-btn" onClick={onAbort}>
          Cancel Induction
        </button>
        <button
          className="panopticon-deposit-action-btn"
          onClick={handleDeposit}
          disabled={depositing || !title || (!artist && !isCompilation) || !data?.tracks?.length}
        >
          {depositing ? 'DEPOSITING...' : 'DEPOSIT TO LIBRARY →'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Main Panopticon Component
// ============================================
function PanopticonView({ onDataChange, onOpenSleeve, initialAttachmentId, initialRecordId, initialTrackId, initialMixtapeId, initialInductionPath }) {
  // State
  const [attachments, setAttachments] = useState([]);
  const [records, setRecords] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [mixtapes, setMixtapes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedType, setSelectedType] = useState(null); // 'attachment' | 'record' | 'track'
  const [lastClickedId, setLastClickedId] = useState(null);
  const gridRef = useRef(null);

  // Filters - pills are now a Set for multi-select
  // Filter mode - exclusive selection
  // 'all' | 'some' | 'ephemera' | 'records' | 'tracks' | 'mixtapes'
  const [filterMode, setFilterMode] = useState('all');
  // For 'some' mode - which types are checked
  const [someFilters, setSomeFilters] = useState({
    images: true,
    documents: true,
    records: true,
    tracks: true,
    mixtapes: true
  });
  const [showSomeDropdown, setShowSomeDropdown] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Grid view removed - list view only
  const [displayOrder, setDisplayOrder] = useState(null); // Sorted items from list view for shift-click

  // Delete confirmation (attachments)
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Delete tracks confirmation
  const [deleteTracksConfirm, setDeleteTracksConfirm] = useState(null); // { ids: [], count: number }
  const [deleteTracksFiles, setDeleteTracksFiles] = useState(false);

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);

  // Link modal state
  const [linkModal, setLinkModal] = useState(null); // { type: 'record'|'mixtape'|'track', attachmentIds: [] }

  // Nascent Sleeve modal state
  const [showNascentSleeveModal, setShowNascentSleeveModal] = useState(false);

  // Induction mode state
  const [inductionMode, setInductionMode] = useState(false);
  const [inductionData, setInductionData] = useState(null); // Current folder analysis result
  const [inductionQueue, setInductionQueue] = useState([]); // Queue of folder paths to induct
  const [inductionQueueIndex, setInductionQueueIndex] = useState(0); // Current position in queue

  // Induction Summary mode - shows all analysis results before editing
  const [inductionSummaryMode, setInductionSummaryMode] = useState(false);
  const [analysisResults, setAnalysisResults] = useState([]); // All folder analysis results

  // Single/Multi track file induction state
  const [singleTrackMode, setSingleTrackMode] = useState(false);
  const [singleTrackData, setSingleTrackData] = useState(null); // Single track to import
  const [fileInductionQueue, setFileInductionQueue] = useState([]); // For multiple loose files (grouped)

  // Multi-album split state
  const [multiAlbumMode, setMultiAlbumMode] = useState(false);
  const [multiAlbumData, setMultiAlbumData] = useState(null); // Folder analysis with multiple albums

  // Import v2 state (fast and dumb)
  const [importInProgress, setImportInProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ stage: '', message: '', progress: 0 });
  const [importResult, setImportResult] = useState(null); // Error result to display

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragType, setDragType] = useState(null); // 'folder' | 'image' | null

  // Ref for SOME dropdown (click-outside-to-close)
  const someDropdownRef = useRef(null);

  // Close SOME dropdown when clicking outside
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

  // Load all data function (reusable for refresh)
  const reloadData = useCallback(async () => {
    if (!ipcRenderer) return;

    try {
      const [attachmentResult, recordResult, trackResult, mixtapeResult] = await Promise.all([
        ipcRenderer.invoke('panopticon:get-all-attachments'),
        ipcRenderer.invoke('panopticon:get-all-records'),
        ipcRenderer.invoke('panopticon:get-all-tracks'),
        ipcRenderer.invoke('panopticon:get-all-mixtapes')
      ]);

      setAttachments(attachmentResult || []);
      setRecords(recordResult || []);
      setTracks(trackResult || []);
      setMixtapes(mixtapeResult || []);
    } catch (err) {
      console.error('Failed to reload data:', err);
    }
  }, []);

  // Load all data on mount
  useEffect(() => {
    async function loadData() {
      if (!ipcRenderer) {
        setLoading(false);
        return;
      }

      try {
        const [attachmentResult, recordResult, trackResult, mixtapeResult] = await Promise.all([
          ipcRenderer.invoke('panopticon:get-all-attachments'),
          ipcRenderer.invoke('panopticon:get-all-records'),
          ipcRenderer.invoke('panopticon:get-all-tracks'),
          ipcRenderer.invoke('panopticon:get-all-mixtapes')
        ]);

        setAttachments(attachmentResult || []);
        setRecords(recordResult || []);
        setTracks(trackResult || []);
        setMixtapes(mixtapeResult || []);

        // Handle initial selection by type priority
        if (initialRecordId && recordResult?.some(r => r.id === initialRecordId)) {
          setSelectedIds(new Set([initialRecordId]));
          setSelectedType('record');
          setLastClickedId(initialRecordId);
        } else if (initialTrackId && trackResult?.some(t => t.id === initialTrackId)) {
          setSelectedIds(new Set([initialTrackId]));
          setSelectedType('track');
          setLastClickedId(initialTrackId);
        } else if (initialMixtapeId && mixtapeResult?.some(m => m.id === initialMixtapeId)) {
          setSelectedIds(new Set([initialMixtapeId]));
          setSelectedType('mixtape');
          setLastClickedId(initialMixtapeId);
        } else if (initialAttachmentId && attachmentResult?.some(a => a.id === initialAttachmentId)) {
          setSelectedIds(new Set([initialAttachmentId]));
          setSelectedType('attachment');
          setLastClickedId(initialAttachmentId);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [initialAttachmentId, initialRecordId, initialTrackId, initialMixtapeId]);

  // Handle initial induction path - import v2 (fast and dumb)
  // initialInductionPath can be: { folders: string[], files: string[] } or string (legacy)
  useEffect(() => {
    async function startImport() {
      if (!initialInductionPath || !ipcRenderer) return;

      // Normalize to new format
      const isLegacy = typeof initialInductionPath === 'string';
      const folders = isLegacy ? [initialInductionPath] : (initialInductionPath.folders || []);
      const files = isLegacy ? [] : (initialInductionPath.files || []);

      // Combine all paths
      const allPaths = [...folders, ...files];
      if (allPaths.length === 0) return;

      console.log('[Panopticon] Import v2 starting - paths:', allPaths.length);

      setImportInProgress(true);
      setImportProgress({ stage: 'starting', message: 'Starting import...', progress: 0 });

      try {
        const result = await ipcRenderer.invoke('import-files', allPaths);
        console.log('[Panopticon] Import result:', result);

        if (result.failed > 0 || result.error) {
          // Show error result
          setImportResult(result);
        }

        // Refresh data
        await reloadData();

      } catch (err) {
        console.error('Import failed:', err);
        setImportResult({ success: false, error: err.message, imported: 0, failed: 0 });
      } finally {
        setImportInProgress(false);
      }
    }

    startImport();
  }, [initialInductionPath]);

  // Listen for import progress updates
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleProgress = (event, data) => {
      setImportProgress(data);
    };

    ipcRenderer.on('import-progress', handleProgress);

    return () => {
      ipcRenderer.removeListener('import-progress', handleProgress);
    };
  }, []);

  // Scroll to initially selected attachment after loading
  useEffect(() => {
    if (!loading && initialAttachmentId && gridRef.current) {
      // Small delay to allow DOM to render
      setTimeout(() => {
        const element = gridRef.current?.querySelector(`[data-attachment-id="${initialAttachmentId}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [loading, initialAttachmentId]);

  // Scroll to initially selected track after loading
  useEffect(() => {
    if (!loading && initialTrackId && gridRef.current) {
      setTimeout(() => {
        const element = gridRef.current?.querySelector(`[data-track-id="${initialTrackId}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [loading, initialTrackId]);

  // Scroll to initially selected record after loading
  useEffect(() => {
    if (!loading && initialRecordId && gridRef.current) {
      setTimeout(() => {
        const element = gridRef.current?.querySelector(`[data-record-id="${initialRecordId}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [loading, initialRecordId]);

  // Toggle a filter in SOME mode
  const toggleSomeFilter = useCallback((filter) => {
    setSomeFilters(prev => ({
      ...prev,
      [filter]: !prev[filter]
    }));
  }, []);

  // Reveal selection - clears filters to make selected item(s) visible
  const revealSelection = useCallback(() => {
    // Switch to the appropriate exclusive mode based on selected type
    if (selectedType === 'record') {
      setFilterMode('records');
    } else if (selectedType === 'track') {
      setFilterMode('tracks');
    } else if (selectedType === 'mixtape') {
      setFilterMode('mixtapes');
    } else if (selectedType === 'attachment') {
      setFilterMode('ephemera');
    } else {
      setFilterMode('all');
    }
    setStatusFilter('all');
    setSearchQuery('');
  }, [selectedType]);

  // Compute which types are currently shown based on filterMode
  const showImages = filterMode === 'all' || filterMode === 'ephemera' || (filterMode === 'some' && someFilters.images);
  const showDocuments = filterMode === 'all' || filterMode === 'ephemera' || (filterMode === 'some' && someFilters.documents);
  const showRecords = filterMode === 'all' || filterMode === 'records' || (filterMode === 'some' && someFilters.records);
  const showTracks = filterMode === 'all' || filterMode === 'tracks' || (filterMode === 'some' && someFilters.tracks);
  const showMixtapes = filterMode === 'all' || filterMode === 'mixtapes' || (filterMode === 'some' && someFilters.mixtapes);

  // Filter all items based on filter mode and create unified list
  const filteredItems = [];

  // Filter attachments (images/documents)
  if (showImages || showDocuments) {
    for (const att of attachments) {
      const isPhoto = att.type?.startsWith('image');
      const isDocument = !isPhoto;

      // Check filter
      if (isPhoto && !showImages) continue;
      if (isDocument && !showDocuments) continue;

      // Status filter (only for attachments)
      if (statusFilter !== 'all') {
        const hasLinks = att.linkedTo && att.linkedTo.length > 0;
        const isCover = att.isCoverFor && att.isCoverFor.length > 0;

        if (statusFilter === 'linked' && !hasLinks) continue;
        if (statusFilter === 'strays' && (hasLinks || isCover)) continue;
        if (statusFilter === 'covers' && !isCover) continue;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!att.filename?.toLowerCase().includes(query)) continue;
      }

      filteredItems.push({ ...att, entityType: 'attachment' });
    }
  }

  // Filter records - exclude when strays/linked/covers filter is active (these only apply to attachments)
  if (showRecords && statusFilter === 'all') {
    for (const rec of records) {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = rec.title?.toLowerCase().includes(query);
        const matchesArtist = rec.artist?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesArtist) continue;
      }

      filteredItems.push(rec);
    }
  }

  // Filter tracks - show all when 'all', or only strays when 'strays' filter
  if (showTracks && (statusFilter === 'all' || statusFilter === 'strays')) {
    for (const track of tracks) {
      // For strays filter, only show tracks without a parent record
      if (statusFilter === 'strays' && track.recordId) continue;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = track.title?.toLowerCase().includes(query);
        const matchesArtist = track.artist?.toLowerCase().includes(query);
        const matchesAlbum = track.album?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesArtist && !matchesAlbum) continue;
      }

      filteredItems.push(track);
    }
  }

  // Filter mixtapes - exclude when strays/linked/covers filter is active (these only apply to attachments)
  if (showMixtapes && statusFilter === 'all') {
    for (const mixtape of mixtapes) {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = mixtape.title?.toLowerCase().includes(query);
        if (!matchesTitle) continue;
      }

      filteredItems.push(mixtape);
    }
  }

  // Legacy alias for detail panel compatibility
  const filteredAttachments = filteredItems.filter(i => i.entityType === 'attachment');

  // Selection handlers
  const handleItemClick = useCallback((e, id, entityType) => {
    if (e.shiftKey && lastClickedId) {
      // Range select - use display order (sorted) for correct shift-click range
      const itemsForRange = displayOrder || filteredItems;
      const ids = itemsForRange.map(a => a.id);
      const startIdx = ids.indexOf(lastClickedId);
      const endIdx = ids.indexOf(id);
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rangeIds = ids.slice(from, to + 1);

      setSelectedIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(rid => next.add(rid));
        return next;
      });
      setSelectedType(entityType);
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setSelectedType(entityType);
    } else {
      // Single select
      setSelectedIds(new Set([id]));
      setSelectedType(entityType);
    }
    setLastClickedId(id);
  }, [lastClickedId, filteredItems, displayOrder]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+A to select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = new Set(filteredItems.map(a => a.id));
        setSelectedIds(allIds);
      }
      // Escape to clear selection
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
          setSelectedType(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, selectedIds.size]);

  // Get selected items for detail panel - look at ALL items, not just filtered
  // This allows the detail panel to persist even when filters hide the selection
  const allItemsWithType = [
    ...attachments.map(a => ({ ...a, entityType: 'attachment' })),
    ...records,
    ...tracks,
    ...mixtapes
  ];
  const selectedItems = allItemsWithType.filter(item => selectedIds.has(item.id));
  const selectedAttachments = selectedItems.filter(item => item.entityType === 'attachment');
  const selectedTracks = selectedItems.filter(item => item.entityType === 'track');

  // Check if the current selection is visible in the filtered view
  const selectionIsFiltered = selectedIds.size > 0 &&
    !filteredItems.some(item => selectedIds.has(item.id));

  // Compute linked item IDs for highlighting
  // - Record selected → its tracks and attachments glow
  // - Track selected → its parent record glows
  // - Attachment selected → its linked records/tracks glow
  const linkedIds = new Set();
  for (const item of selectedItems) {
    if (item.entityType === 'record') {
      // Record selected - link to its tracks
      if (item.trackIds) {
        for (const trackId of item.trackIds) {
          linkedIds.add(trackId);
        }
      }
      // Record selected - link to its attachments (covers, ephemera)
      if (item.attachmentIds) {
        for (const attId of item.attachmentIds) {
          linkedIds.add(attId);
        }
      }
    } else if (item.entityType === 'track' && item.recordId) {
      // Track selected - link to its parent record
      linkedIds.add(item.recordId);
    } else if (item.entityType === 'attachment') {
      // Attachment selected - link to its parent records/tracks
      if (item.linkedTo) {
        for (const link of item.linkedTo) {
          linkedIds.add(link.id);
        }
      }
      if (item.isCoverFor) {
        for (const link of item.isCoverFor) {
          linkedIds.add(link.id);
        }
      }
    }
  }

  // Toggle link
  const handleToggleLink = async (attachmentId, targetType, targetId, currentlyLinked) => {
    if (!ipcRenderer) return;

    try {
      await ipcRenderer.invoke('panopticon:update-links', {
        attachmentIds: [attachmentId],
        action: currentlyLinked ? 'remove' : 'add',
        targetType,
        targetId
      });

      // Reload attachments
      const result = await ipcRenderer.invoke('panopticon:get-all-attachments');
      setAttachments(result || []);
    } catch (err) {
      console.error('Failed to update link:', err);
    }
  };

  // Add link to target
  const handleAddLink = async (targetType, targetId) => {
    if (!ipcRenderer || !linkModal) return;

    try {
      await ipcRenderer.invoke('panopticon:update-links', {
        attachmentIds: linkModal.attachmentIds,
        action: 'add',
        targetType,
        targetId
      });

      // Reload attachments and close modal
      const result = await ipcRenderer.invoke('panopticon:get-all-attachments');
      setAttachments(result || []);
      setLinkModal(null);
    } catch (err) {
      console.error('Failed to add link:', err);
    }
  };

  // Nascent Sleeve created handler - auto-select the new record
  const handleNascentSleeveCreated = async (recordId) => {
    // Reload data to include the new record
    await reloadData();
    // Auto-select the new record
    setSelectedIds(new Set([recordId]));
    setSelectedType('record');
    setLastClickedId(recordId);
    // Switch to Records filter so it's visible
    setFilterMode('records');
  };

  // Delete handler
  const handleDelete = async () => {
    if (!ipcRenderer || !deleteConfirm) return;

    try {
      await ipcRenderer.invoke('panopticon:delete-attachments', {
        attachmentIds: deleteConfirm.ids
      });

      // Clear selection and reload
      setSelectedIds(new Set());
      const result = await ipcRenderer.invoke('panopticon:get-all-attachments');
      setAttachments(result || []);
    } catch (err) {
      console.error('Failed to delete attachments:', err);
    } finally {
      setDeleteConfirm(null);
    }
  };

  // Delete tracks handler
  const handleDeleteTracks = async () => {
    if (!ipcRenderer || !deleteTracksConfirm) return;

    try {
      await ipcRenderer.invoke('panopticon:delete-tracks', {
        trackIds: deleteTracksConfirm.ids,
        deleteFiles: deleteTracksFiles
      });

      // Clear selection and reload tracks
      setSelectedIds(new Set());
      const result = await ipcRenderer.invoke('panopticon:get-all-tracks');
      setTracks(result || []);
    } catch (err) {
      console.error('Failed to delete tracks:', err);
    } finally {
      setDeleteTracksConfirm(null);
      setDeleteTracksFiles(false);
    }
  };

  // Copy path to clipboard
  const handleCopyPath = async (path) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  // Reveal in Finder
  const handleReveal = async (path) => {
    if (!ipcRenderer) return;
    await ipcRenderer.invoke('reveal-in-finder', path);
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIdx = 0;
    while (size >= 1024 && unitIdx < units.length - 1) {
      size /= 1024;
      unitIdx++;
    }
    return `${size.toFixed(unitIdx > 0 ? 1 : 0)} ${units[unitIdx]}`;
  };

  // Format duration (seconds to mm:ss)
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle abort/cancel induction
  const handleAbortInduction = () => {
    // If in a queue, ask about remaining items
    const remaining = inductionQueue.length - inductionQueueIndex - 1;
    if (remaining > 0) {
      // For now, just cancel all (TODO: add modal for cancel all vs skip)
      console.log(`[Panopticon] Canceling induction with ${remaining} remaining in queue`);
    }
    setInductionMode(false);
    setInductionData(null);
    setInductionQueue([]);
    setInductionQueueIndex(0);
    setSingleTrackMode(false);
    setSingleTrackData(null);
    setFileInductionQueue([]);
    setMultiAlbumMode(false);
    setMultiAlbumData(null);
    setInductionSummaryMode(false);
    setAnalysisResults([]);
  };

  // Handle "Trust the Eye" - import all with defaults
  const handleTrustTheEye = async () => {
    if (!ipcRenderer || analysisResults.length === 0) return;

    try {
      // Build a queue of all items to import
      const importQueue = [];

      for (const result of analysisResults) {
        if (result.hasMultipleAlbums && result.albumGroups?.length > 0) {
          // Multiple albums - add each group
          for (const group of result.albumGroups) {
            importQueue.push({
              folderPath: group.folderPath || result.folderPath,
              tracks: group.tracks,
              images: group.images || result.images || [],
              title: group.album || 'Unknown Album',
              artist: group.albumArtist || 'Unknown Artist',
              year: group.year || '',
              isCompilation: false
            });
          }
          // Also handle stray candidates (tracks with no album metadata)
          if (result.strayCandidates?.length > 0) {
            importQueue.push({
              folderPath: result.folderPath,
              tracks: result.strayCandidates,
              images: result.images || [],
              title: 'Singles',
              artist: result.suggestedArtist || 'Various Artists',
              year: '',
              isCompilation: true
            });
          }
        } else if (result.strayCandidates?.length > 0 && result.tracks?.length === result.strayCandidates?.length) {
          // All tracks are strays (no album metadata) - create a Singles record
          importQueue.push({
            folderPath: result.folderPath,
            tracks: result.strayCandidates,
            images: result.images || [],
            title: result.suggestedTitle || result.folderName || 'Singles',
            artist: result.suggestedArtist || 'Various Artists',
            year: result.suggestedYear || '',
            isCompilation: true
          });
        } else {
          // Single album
          importQueue.push({
            folderPath: result.folderPath,
            tracks: result.tracks,
            images: result.images || [],
            title: result.suggestedTitle || 'Unknown Album',
            artist: result.suggestedArtist || 'Unknown Artist',
            year: result.suggestedYear || '',
            isCompilation: result.isLikelyCompilation || false
          });
        }
      }

      // Import all at once
      for (const item of importQueue) {
        // Use first image as cover if available (check both .filename and .name)
        const coverImage = item.images.find(img => {
          const name = (img.filename || img.name || '').toLowerCase();
          return name.includes('cover') || name.includes('front') || name.includes('folder');
        }) || item.images[0];

        await ipcRenderer.invoke('panopticon:deposit', {
          folderPath: item.folderPath,
          title: item.title,
          artist: item.artist,
          year: item.year,
          isCompilation: item.isCompilation,
          isLP: (item.tracks?.length || 0) >= 5,
          coverPath: coverImage?.path || null,
          coverDataUrl: coverImage?.dataUrl || null,
          tracks: item.tracks,
          selectedImages: item.images,
          selectedTextFiles: []
        });
      }

      // Clear state and reload
      setInductionSummaryMode(false);
      setAnalysisResults([]);
      setInductionQueue([]);
      setInductionQueueIndex(0);
      await reloadData();
    } catch (err) {
      console.error('Trust the Eye import failed:', err);
    }
  };

  // Handle "Review" - go to per-item editing
  const handleReviewInduction = () => {
    if (analysisResults.length === 0) return;

    // Take first result and set up for editing
    const first = analysisResults[0];

    // Check if it has multiple albums
    if (first.hasMultipleAlbums && first.albumGroups?.length > 1) {
      setMultiAlbumData(first);
      setMultiAlbumMode(true);
    } else {
      setInductionData(first);
      setInductionMode(true);
    }

    // Keep analysisResults for queue tracking but exit summary mode
    setInductionSummaryMode(false);
  };

  // Handle cancel from summary view
  const handleCancelSummary = () => {
    setInductionSummaryMode(false);
    setAnalysisResults([]);
    setInductionQueue([]);
    setInductionQueueIndex(0);
  };

  // Handle multi-album split continue
  const handleMultiAlbumContinue = ({ mode, selectedGroups, mergeAll }) => {
    if (!multiAlbumData) return;

    const isLooseFiles = multiAlbumData.isLooseFiles || false;

    if (mergeAll) {
      // Merge all - combine all tracks into single induction
      const allTracks = selectedGroups.flatMap(g => g.tracks);
      // Combine images from all groups if available, otherwise use top-level
      const allImages = selectedGroups.some(g => g.images?.length > 0)
        ? selectedGroups.flatMap(g => g.images || [])
        : (multiAlbumData.images || []);
      setInductionData({
        folderPath: multiAlbumData.folderPath,
        tracks: allTracks,
        images: allImages,
        suggestedTitle: selectedGroups[0]?.album || 'Combined',
        suggestedArtist: selectedGroups[0]?.albumArtist || '',
        suggestedYear: selectedGroups[0]?.year || '',
        isLikelyCompilation: selectedGroups.length > 1,
        isLooseFiles
      });
      setInductionMode(true);
      setMultiAlbumMode(false);
      setMultiAlbumData(null);
    } else {
      // Separate records - queue each selected album group
      // Use per-album images if available (artist folder case), otherwise fall back to top-level
      const queue = selectedGroups.map(group => ({
        type: 'group',
        albumArtist: group.albumArtist,
        album: group.album,
        year: group.year,
        tracks: group.tracks,
        images: group.images || multiAlbumData.images || [],
        folderPath: group.folderPath || multiAlbumData.folderPath
      }));

      setFileInductionQueue(queue);
      if (queue.length > 0) {
        const first = queue[0];
        setInductionData({
          folderPath: first.folderPath,
          tracks: first.tracks,
          images: first.images || [],
          suggestedTitle: first.album,
          suggestedArtist: first.albumArtist,
          suggestedYear: first.year || '',
          isLikelyCompilation: false,
          isLooseFiles
        });
        setInductionQueue([]);
        setInductionQueueIndex(0);
        setInductionMode(true);
      }
      setMultiAlbumMode(false);
      setMultiAlbumData(null);
    }
  };

  // Handle abort single track mode
  const handleAbortSingleTrack = () => {
    setSingleTrackMode(false);
    setSingleTrackData(null);
  };

  // Handle single track deposit (create new record)
  const handleSingleTrackDeposit = async (depositData) => {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:deposit-single-track', depositData);

      if (result && result.success) {
        // Reload records and tracks
        const [recordResult, trackResult] = await Promise.all([
          ipcRenderer.invoke('panopticon:get-all-records'),
          ipcRenderer.invoke('panopticon:get-all-tracks')
        ]);
        setRecords(recordResult || []);
        setTracks(trackResult || []);

        // Exit single track mode
        setSingleTrackMode(false);
        setSingleTrackData(null);
      }
    } catch (err) {
      console.error('Single track deposit failed:', err);
    }
  };

  // Handle adding track to existing record
  const handleAddToRecord = async (recordId, trackPaths) => {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:add-to-record', { recordId, trackPaths });

      if (result && result.success) {
        // Reload records and tracks
        const [recordResult, trackResult] = await Promise.all([
          ipcRenderer.invoke('panopticon:get-all-records'),
          ipcRenderer.invoke('panopticon:get-all-tracks')
        ]);
        setRecords(recordResult || []);
        setTracks(trackResult || []);

        // Exit single track mode
        setSingleTrackMode(false);
        setSingleTrackData(null);
      }
    } catch (err) {
      console.error('Add to record failed:', err);
    }
  };

  // Advance to next item in induction queue
  const advanceInductionQueue = async () => {
    const nextIndex = inductionQueueIndex + 1;

    // Check if we're working with file induction queue (loose files)
    if (fileInductionQueue.length > 0) {
      if (nextIndex >= fileInductionQueue.length) {
        // File queue complete - exit induction mode
        console.log('[Panopticon] File induction queue complete');
        setInductionMode(false);
        setInductionData(null);
        setFileInductionQueue([]);
        setInductionQueueIndex(0);
        return;
      }

      // Move to next item in file queue
      setInductionQueueIndex(nextIndex);
      const nextItem = fileInductionQueue[nextIndex];
      setInductionData({
        folderPath: nextItem.folderPath || null,
        tracks: nextItem.tracks,
        images: nextItem.images || [],
        suggestedTitle: nextItem.album || 'Singles',
        suggestedArtist: nextItem.albumArtist || '',
        suggestedYear: nextItem.year || '',
        isLikelyCompilation: false,
        isLooseFiles: nextItem.type === 'group' ? false : true
      });
      return;
    }

    // Folder-based queue
    if (nextIndex >= inductionQueue.length) {
      // Queue complete - exit induction mode
      console.log('[Panopticon] Induction queue complete');
      setInductionMode(false);
      setInductionData(null);
      setInductionQueue([]);
      setInductionQueueIndex(0);
      return;
    }

    // Analyze next folder
    setInductionQueueIndex(nextIndex);
    try {
      const result = await ipcRenderer.invoke('panopticon:analyze-folder', inductionQueue[nextIndex]);
      if (result && !result.error) {
        setInductionData(result);
      } else {
        console.error('Failed to analyze next folder:', result?.error);
        // Skip to next on error
        advanceInductionQueue();
      }
    } catch (err) {
      console.error('Error analyzing next folder:', err);
      advanceInductionQueue();
    }
  };

  // Handle skip to next in queue
  const handleSkipInduction = () => {
    advanceInductionQueue();
  };

  // Handle deposit action - create record from induction data
  const handleDeposit = async (depositData) => {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:deposit', depositData);

      if (result && result.success) {
        // Small delay to ensure filesystem operations complete before reload
        await new Promise(resolve => setTimeout(resolve, 100));

        // Reload all data (records, tracks, attachments) to update list view
        await reloadData();

        // Advance to next in queue (or exit if done)
        await advanceInductionQueue();
      }
    } catch (err) {
      console.error('Deposit failed:', err);
    }
  };

  // Get thumbnail URL (preferSmall for list views, uses 80x80 thumbnail)
  const getThumbnailUrl = (att, preferSmall = false) => {
    if (att.thumbnailPath) {
      if (preferSmall) {
        // Try small thumbnail for list views
        return `local://${att.thumbnailPath.replace('thumbnail.jpg', 'thumbnail-small.jpg')}`;
      }
      return `local://${att.thumbnailPath}`;
    }
    if (att.path && att.type?.startsWith('image')) {
      return `local://${att.path}`;
    }
    return null;
  };

  // Drag and drop handlers
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check what's being dragged
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // Check first item - could be file or folder
      const item = items[0];
      if (item.kind === 'file') {
        setIsDragOver(true);
        // We can't know if it's a folder until drop, so show generic
        setDragType('unknown');
      }
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
      setDragType(null);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragType(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    try {
      // Categorize dropped items
      const folderPaths = [];
      const imagePaths = [];
      const audioPaths = [];

      for (const file of files) {
        const stats = await ipcRenderer.invoke('fs:stat', file.path);
        if (stats?.isDirectory) {
          folderPaths.push(file.path);
        } else if (stats?.isFile) {
          const ext = file.path.toLowerCase().slice(file.path.lastIndexOf('.'));
          if (IMAGE_EXTENSIONS.includes(ext)) {
            imagePaths.push(file.path);
          } else {
            const audioExts = ['.m4a', '.flac', '.mp3', '.wav', '.aiff', '.aac', '.ogg', '.wma'];
            if (audioExts.includes(ext)) {
              audioPaths.push(file.path);
            }
          }
        }
      }

      console.log('[Panopticon Drop] Folders:', folderPaths.length, 'Images:', imagePaths.length, 'Audio:', audioPaths.length);

      // Handle folders and audio files - import v2 (fast and dumb)
      const importPaths = [...folderPaths, ...audioPaths];
      if (importPaths.length > 0) {
        setImportInProgress(true);
        setImportProgress({ stage: 'starting', message: 'Starting import...', progress: 0 });

        try {
          const result = await ipcRenderer.invoke('import-files', importPaths);
          console.log('[Panopticon] Import result:', result);

          if (result.failed > 0 || result.error) {
            // Show error result
            setImportResult(result);
          }

          // Refresh data
          await reloadData();

        } catch (err) {
          console.error('Import failed:', err);
          setImportResult({ success: false, error: err.message, imported: 0, failed: 0 });
        } finally {
          setImportInProgress(false);
        }
        return;
      }

      // Handle images - import as stray attachments (unchanged)
      if (imagePaths.length > 0) {
        const newIds = [];
        for (const imagePath of imagePaths) {
          const result = await ipcRenderer.invoke('add-attachment', { filePath: imagePath });
          if (result?.success && result.attachment?.id) {
            newIds.push(result.attachment.id);
          }
        }
        // Reload attachments and select the new ones
        if (newIds.length > 0) {
          const attachmentResult = await ipcRenderer.invoke('panopticon:get-all-attachments');
          setAttachments(attachmentResult || []);
          setSelectedIds(new Set(newIds));
          setSelectedType('attachment');
          setLastClickedId(newIds[newIds.length - 1]);
        }
      }
    } catch (err) {
      console.error('Drop handling error:', err);
    }
  }, []);

  // If in induction summary mode, show the summary view
  if (inductionSummaryMode && analysisResults.length > 0) {
    return (
      <div className="panopticon">
        <InductionSummaryView
          analysisResults={analysisResults}
          onTrustTheEye={handleTrustTheEye}
          onReview={handleReviewInduction}
          onCancel={handleCancelSummary}
        />
      </div>
    );
  }

  // If in multi-album split mode, show the split UI
  if (multiAlbumMode && multiAlbumData) {
    return (
      <div className="panopticon">
        <MultiAlbumSplitView
          data={multiAlbumData}
          onAbort={handleAbortInduction}
          onContinue={handleMultiAlbumContinue}
        />
      </div>
    );
  }

  // If in single track mode, show simplified UI
  if (singleTrackMode && singleTrackData) {
    return (
      <div className="panopticon">
        <SingleTrackInductionView
          track={singleTrackData}
          records={records}
          onAbort={handleAbortSingleTrack}
          onDeposit={handleSingleTrackDeposit}
          onAddToRecord={handleAddToRecord}
        />
      </div>
    );
  }

  // If in induction mode, show the induction UI
  if (inductionMode && inductionData) {
    return (
      <div className="panopticon">
        <InductionView
          data={inductionData}
          onAbort={handleAbortInduction}
          onDeposit={handleDeposit}
          queuePosition={inductionQueueIndex + 1}
          queueTotal={inductionQueue.length > 0 ? inductionQueue.length : fileInductionQueue.length}
          onSkip={handleSkipInduction}
        />
      </div>
    );
  }

  return (
    <div className="panopticon">
      {/* Filter Bar */}
      <div className="panopticon-filters">
        <div className="panopticon-filters-left">
          {/* Filter Pills - Exclusive selection */}
          <div className="panopticon-pills">
            <button
              className={`panopticon-pill ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => { setFilterMode('all'); setShowSomeDropdown(false); }}
            >
              ALL
            </button>
            <div className="panopticon-pill-wrapper" ref={someDropdownRef}>
              <button
                className={`panopticon-pill ${filterMode === 'some' ? 'active' : ''}`}
                onClick={() => {
                  if (filterMode === 'some') {
                    setShowSomeDropdown(!showSomeDropdown);
                  } else {
                    setFilterMode('some');
                    setShowSomeDropdown(true);
                  }
                }}
              >
                SOME ▾
              </button>
              {showSomeDropdown && (
                <div className="panopticon-some-dropdown">
                  <label className="panopticon-some-option">
                    <input
                      type="checkbox"
                      checked={someFilters.images}
                      onChange={() => toggleSomeFilter('images')}
                    />
                    Images
                  </label>
                  <label className="panopticon-some-option">
                    <input
                      type="checkbox"
                      checked={someFilters.documents}
                      onChange={() => toggleSomeFilter('documents')}
                    />
                    Documents
                  </label>
                  <label className="panopticon-some-option">
                    <input
                      type="checkbox"
                      checked={someFilters.records}
                      onChange={() => toggleSomeFilter('records')}
                    />
                    Records
                  </label>
                  <label className="panopticon-some-option">
                    <input
                      type="checkbox"
                      checked={someFilters.tracks}
                      onChange={() => toggleSomeFilter('tracks')}
                    />
                    Tracks
                  </label>
                  <label className="panopticon-some-option">
                    <input
                      type="checkbox"
                      checked={someFilters.mixtapes}
                      onChange={() => toggleSomeFilter('mixtapes')}
                    />
                    Cassettes
                  </label>
                </div>
              )}
            </div>
            <button
              className={`panopticon-pill ${filterMode === 'ephemera' ? 'active' : ''}`}
              onClick={() => { setFilterMode('ephemera'); setShowSomeDropdown(false); }}
            >
              EPHEMERA
            </button>
            <button
              className={`panopticon-pill ${filterMode === 'records' ? 'active' : ''}`}
              onClick={() => { setFilterMode('records'); setShowSomeDropdown(false); }}
            >
              RECORDS
            </button>
            <button
              className={`panopticon-pill ${filterMode === 'tracks' ? 'active' : ''}`}
              onClick={() => { setFilterMode('tracks'); setShowSomeDropdown(false); }}
            >
              TRACKS
            </button>
            <button
              className={`panopticon-pill ${filterMode === 'mixtapes' ? 'active' : ''}`}
              onClick={() => { setFilterMode('mixtapes'); setShowSomeDropdown(false); }}
            >
              CASSETTES
            </button>
          </div>

          {/* Status Filter - always visible, but strays/linked/covers only applies to attachments */}
          <div className="panopticon-filter-group">
            <select
              className="panopticon-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="linked">Linked</option>
              <option value="strays">Strays</option>
              <option value="covers">Covers</option>
            </select>
          </div>

        </div>

        <div className="panopticon-filters-right">
          {/* Nascent Sleeve Button */}
          <button
            className="panopticon-nascent-sleeve-btn"
            onClick={() => setShowNascentSleeveModal(true)}
          >
            + Nascent Sleeve
          </button>

          {/* Search */}
          <div className="panopticon-search-wrapper">
            <input
              type="text"
              className="panopticon-search-input"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="panopticon-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="panopticon-loading">Loading...</div>
      ) : (
        <div className="panopticon-content">
          {/* Grid or List */}
          <div
            className={`panopticon-grid-container ${isDragOver ? 'drag-over' : ''}`}
            ref={gridRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={(e) => {
              // Don't deselect when clicking empty space - keep selection visible in detail panel
            }}
          >
            {/* Drop Zone Overlay - inside grid container only */}
            {isDragOver && (
              <div className="panopticon-dropzone">
                <div className="panopticon-dropzone-content">
                  <TheEye />
                  <div className="panopticon-dropzone-text">
                    Drop folder to induct, or image to import
                  </div>
                </div>
              </div>
            )}
            <PanopticonListView
              items={filteredItems}
              selectedIds={selectedIds}
              linkedIds={linkedIds}
              onItemClick={handleItemClick}
              getThumbnailUrl={getThumbnailUrl}
              formatSize={formatSize}
              isFiltered={filterMode !== 'all' || statusFilter !== 'all' || searchQuery !== ''}
              onEmptyClick={() => {
                // Don't deselect when clicking empty space - keep selection visible in detail panel
              }}
              onDisplayOrderChange={setDisplayOrder}
            />
          </div>

          {/* Detail Panel */}
          <div className="panopticon-detail">
            {selectedItems.length === 0 ? (
              <div className="panopticon-detail-empty">
                Select an item to view details
              </div>
            ) : selectedItems.length === 1 ? (
              // Single item selected
              selectedItems[0].entityType === 'attachment' ? (
                <SingleAttachmentDetail
                  attachment={selectedItems[0]}
                  formatSize={formatSize}
                  getThumbnailUrl={getThumbnailUrl}
                  onToggleLink={handleToggleLink}
                  onCopyPath={handleCopyPath}
                  onReveal={handleReveal}
                  onDelete={(att) => setDeleteConfirm({
                    ids: [att.id],
                    count: 1,
                    linkedCount: att.linkedTo?.length || 0
                  })}
                  onOpenLightbox={(url, filename) => setLightboxImage({ url, filename })}
                  onOpenLinkModal={(type) => setLinkModal({
                    type,
                    attachmentIds: [selectedItems[0].id]
                  })}
                />
              ) : selectedItems[0].entityType === 'record' ? (
                <RecordDetailPanel
                  record={selectedItems[0]}
                  onUpdate={() => {
                    reloadData();
                    onDataChange?.(); // Notify parent to refresh sleeve views
                  }}
                  onDelete={() => {
                    setSelectedIds(new Set());
                    setSelectedType(null);
                    reloadData();
                    onDataChange?.();
                  }}
                  onOpenSleeve={onOpenSleeve}
                  onNavigateToTrack={(trackId) => {
                    // Navigate to the track
                    setSelectedIds(new Set([trackId]));
                    setSelectedType('track');
                    setLastClickedId(trackId);
                  }}
                />
              ) : selectedItems[0].entityType === 'mixtape' ? (
                <MixtapeDetailPanel
                  mixtape={selectedItems[0]}
                  onUpdate={() => {
                    reloadData();
                    onDataChange?.();
                  }}
                  onDelete={() => {
                    setSelectedIds(new Set());
                    setSelectedType(null);
                    reloadData();
                    onDataChange?.();
                  }}
                  onOpenSleeve={onOpenSleeve}
                />
              ) : (
                <TrackDetailPanel
                  track={selectedItems[0]}
                  onUpdate={() => {
                    reloadData();
                    onDataChange?.();
                  }}
                  onDelete={() => {
                    setSelectedIds(new Set());
                    setSelectedType(null);
                    reloadData();
                    onDataChange?.();
                  }}
                  onNavigateToRecord={(recordId) => {
                    // Navigate to the parent record
                    setSelectedIds(new Set([recordId]));
                    setSelectedType('record');
                    setLastClickedId(recordId);
                  }}
                />
              )
            ) : (
              // Multiple items selected
              <MultiItemDetail
                items={selectedItems}
                formatSize={formatSize}
                onDelete={selectedAttachments.length > 0 ? () => {
                  const totalLinks = selectedAttachments.reduce(
                    (sum, a) => sum + (a.linkedTo?.length || 0), 0
                  );
                  setDeleteConfirm({
                    ids: selectedAttachments.map(a => a.id),
                    count: selectedAttachments.length,
                    linkedCount: totalLinks
                  });
                } : null}
                onOpenLinkModal={selectedAttachments.length > 0 ? (type) => setLinkModal({
                  type,
                  attachmentIds: selectedAttachments.map(a => a.id)
                }) : null}
                onDeleteTracks={selectedTracks.length > 0 ? () => {
                  setDeleteTracksConfirm({
                    ids: selectedTracks.map(t => t.id),
                    count: selectedTracks.length
                  });
                } : null}
              />
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="panopticon-footer">
        <span className="panopticon-selection-count">
          {selectedIds.size > 0
            ? `${selectedIds.size} selected`
            : `${filteredItems.length} items`}
        </span>
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="panopticon-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="panopticon-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="panopticon-confirm-title">
              Delete {deleteConfirm.count === 1 ? 'Attachment' : `${deleteConfirm.count} Attachments`}?
            </div>
            <div className="panopticon-confirm-message">
              {deleteConfirm.linkedCount > 0
                ? `This will remove ${deleteConfirm.count === 1 ? 'the file' : 'these files'} from disk and unlink from ${deleteConfirm.linkedCount} item${deleteConfirm.linkedCount === 1 ? '' : 's'}. This cannot be undone.`
                : `This will permanently delete ${deleteConfirm.count === 1 ? 'this file' : 'these files'} from disk. This cannot be undone.`}
            </div>
            <div className="panopticon-confirm-buttons">
              <button
                className="panopticon-confirm-cancel"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="panopticon-confirm-delete"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Tracks Confirmation */}
      {deleteTracksConfirm && (
        <div className="panopticon-confirm-overlay" onClick={() => {
          setDeleteTracksConfirm(null);
          setDeleteTracksFiles(false);
        }}>
          <div className="panopticon-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="panopticon-confirm-title">
              Remove {deleteTracksConfirm.count === 1 ? 'Track' : `${deleteTracksConfirm.count} Tracks`} from Library?
            </div>
            <div className="panopticon-confirm-message">
              This will remove {deleteTracksConfirm.count === 1 ? 'this track' : 'these tracks'} from all records and clear listening history. This cannot be undone.
            </div>
            <label className="panopticon-confirm-checkbox">
              <input
                type="checkbox"
                checked={deleteTracksFiles}
                onChange={e => setDeleteTracksFiles(e.target.checked)}
              />
              Also delete audio files from disk
            </label>
            <div className="panopticon-confirm-buttons">
              <button
                className="panopticon-confirm-cancel"
                onClick={() => {
                  setDeleteTracksConfirm(null);
                  setDeleteTracksFiles(false);
                }}
              >
                Cancel
              </button>
              <button
                className="panopticon-confirm-delete"
                onClick={handleDeleteTracks}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Progress Overlay */}
      {importInProgress && (
        <div className="panopticon-import-overlay">
          <div className="panopticon-import-modal">
            <div className="panopticon-import-spinner" />
            <div className="panopticon-import-message">{importProgress.message || 'Importing...'}</div>
            {importProgress.progress > 0 && (
              <div className="panopticon-import-progress">
                <div
                  className="panopticon-import-progress-fill"
                  style={{ width: `${(importProgress.progress || 0) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Error Modal */}
      {importResult && (
        <div className="panopticon-import-overlay" onClick={() => setImportResult(null)}>
          <div className="panopticon-import-modal panopticon-import-result" onClick={e => e.stopPropagation()}>
            <div className="panopticon-import-result-header">
              <h3>Import Results</h3>
              <button className="panopticon-import-close" onClick={() => setImportResult(null)}>×</button>
            </div>
            <div className="panopticon-import-result-content">
              {importResult.imported > 0 && (
                <div className="panopticon-import-success">
                  ✓ Imported {importResult.imported} track{importResult.imported !== 1 ? 's' : ''}
                </div>
              )}
              {importResult.failed > 0 && (
                <div className="panopticon-import-failure">
                  ✗ Failed: {importResult.failed} file{importResult.failed !== 1 ? 's' : ''}
                </div>
              )}
              {importResult.error && !importResult.errors && (
                <div className="panopticon-import-error">{importResult.error}</div>
              )}
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="panopticon-import-errors">
                  {importResult.errors.map((err, i) => (
                    <div key={i} className="panopticon-import-error-item">
                      <span className="file">{err.file}</span>
                      <span className="reason">{err.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panopticon-import-result-footer">
              <button className="panopticon-btn" onClick={() => setImportResult(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxImage && (
        <div className="panopticon-lightbox" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage.url} alt={lightboxImage.filename} />
          <div className="panopticon-lightbox-filename">{lightboxImage.filename}</div>
        </div>
      )}

      {/* Link Modal */}
      {linkModal && (
        <PanopticonLinkModal
          type={linkModal.type}
          attachmentIds={linkModal.attachmentIds}
          onSelect={handleAddLink}
          onClose={() => setLinkModal(null)}
        />
      )}

      {/* Nascent Sleeve Modal */}
      <NascentSleeveModal
        isOpen={showNascentSleeveModal}
        onClose={() => setShowNascentSleeveModal(false)}
        onCreated={handleNascentSleeveCreated}
      />
    </div>
  );
}

// ============================================
// Link Modal Component
// ============================================
function PanopticonLinkModal({ type, attachmentIds, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Only search when user has typed something
  useEffect(() => {
    // Don't search if query is empty - start with empty results
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    async function search() {
      if (!ipcRenderer) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await ipcRenderer.invoke('panopticon:search-targets', {
          targetType: type,
          query: query
        });
        setResults(data || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    }
    search();
  }, [type, query]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item) {
        onSelect(type, item.id);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const typeLabel = type === 'record' ? 'Record' : type === 'mixtape' ? 'Cassette' : 'Track';

  // Format display name - for tracks show "Artist - Song", for others just show name
  const formatItemName = (item) => {
    if (type === 'track' && item.artist) {
      return `${item.artist} — ${item.name}`;
    }
    return item.name;
  };

  return (
    <div className="panopticon-link-modal-overlay" onClick={onClose}>
      <div className="panopticon-link-modal" onClick={e => e.stopPropagation()}>
        <div className="panopticon-link-modal-header">
          Link to {typeLabel}
          <span className="panopticon-link-modal-count">
            ({attachmentIds.length} attachment{attachmentIds.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="panopticon-link-modal-search">
          <input
            ref={inputRef}
            type="text"
            placeholder={`Search ${type}s...`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="panopticon-link-modal-results">
          {loading ? (
            <div className="panopticon-link-modal-empty">Searching...</div>
          ) : !query.trim() ? (
            <div className="panopticon-link-modal-empty">
              Type to search {type}s
            </div>
          ) : results.length === 0 ? (
            <div className="panopticon-link-modal-empty">
              No matches found
            </div>
          ) : (
            results.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className={`panopticon-link-modal-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(type, item.id)}
              >
                <span className="panopticon-link-modal-item-name">{formatItemName(item)}</span>
                {type !== 'track' && item.artist && (
                  <span className="panopticon-link-modal-item-artist">{item.artist}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Single Attachment Detail
// ============================================
function SingleAttachmentDetail({
  attachment,
  formatSize,
  getThumbnailUrl,
  onToggleLink,
  onCopyPath,
  onReveal,
  onDelete,
  onOpenLightbox,
  onOpenLinkModal
}) {
  const thumbUrl = getThumbnailUrl(attachment);
  const isImage = attachment.type?.startsWith('image');

  // Format the type for display
  const typeDisplay = attachment.type
    ? attachment.type.split('/')[1]?.toUpperCase() || attachment.type
    : 'FILE';

  return (
    <>
      {/* Header: Preview + Meta side by side */}
      <div className="panopticon-detail-header">
        <div
          className={`panopticon-preview-small ${isImage ? 'clickable' : ''}`}
          onClick={() => isImage && thumbUrl && onOpenLightbox(thumbUrl, attachment.filename)}
        >
          {thumbUrl ? (
            <img src={thumbUrl} alt={attachment.filename} />
          ) : (
            <span className="panopticon-preview-placeholder-small">
              {attachment.filename?.endsWith('.pdf') ? '📄' : '📎'}
            </span>
          )}
        </div>
        <div className="panopticon-detail-meta-block">
          <div className="panopticon-detail-filename">{attachment.filename}</div>
          <div className="panopticon-detail-meta">
            {formatSize(attachment.fileSize)} · {typeDisplay}
          </div>
          {attachment.addedAt && (
            <div className="panopticon-detail-meta">
              Added {new Date(attachment.addedAt).toLocaleDateString()}
            </div>
          )}
          <div className="panopticon-detail-id">ID: {attachment.id}</div>
        </div>
      </div>

      {/* Cover For */}
      {attachment.isCoverFor && attachment.isCoverFor.length > 0 && (
        <div className="panopticon-section">
          <div className="panopticon-section-title">Cover For</div>
          {attachment.isCoverFor.map(item => (
            <div key={`${item.type}-${item.id}`} className="panopticon-link-item">
              <span className="panopticon-link-label">{item.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Linked To */}
      <div className="panopticon-section">
        <div className="panopticon-section-title">Linked To</div>
        {attachment.linkedTo && attachment.linkedTo.length > 0 ? (
          attachment.linkedTo.map(link => (
            <div key={`${link.type}-${link.id}`} className="panopticon-link-item">
              <input
                type="checkbox"
                className="panopticon-link-checkbox"
                checked={true}
                onChange={() => onToggleLink(attachment.id, link.type, link.id, true)}
              />
              <span className="panopticon-link-label">{link.name}</span>
              <span className="panopticon-link-type">({link.type})</span>
            </div>
          ))
        ) : (
          <div className="panopticon-no-links">No links (stray)</div>
        )}
      </div>

      {/* Add Link Buttons */}
      <div className="panopticon-section">
        <div className="panopticon-link-buttons">
          <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('record')}>+ Record</button>
          <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('mixtape')}>+ Cassette</button>
          <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('track')}>+ Track</button>
        </div>
      </div>

      {/* Action Buttons - all in one row */}
      <div className="panopticon-section">
        <div className="panopticon-action-buttons">
          <button
            className="panopticon-util-btn"
            onClick={() => onCopyPath(attachment.path)}
          >
            Copy Path
          </button>
          <button
            className="panopticon-util-btn"
            onClick={() => onReveal(attachment.path)}
          >
            Reveal
          </button>
          <button
            className="panopticon-delete-btn-inline"
            onClick={() => onDelete(attachment)}
          >
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

// ============================================
// Multi Item Detail (mixed types)
// ============================================
function MultiItemDetail({ items, formatSize, onDelete, onOpenLinkModal, onDeleteTracks }) {
  // Count by type
  const attachmentCount = items.filter(i => i.entityType === 'attachment').length;
  const recordCount = items.filter(i => i.entityType === 'record').length;
  const trackCount = items.filter(i => i.entityType === 'track').length;
  const mixtapeCount = items.filter(i => i.entityType === 'mixtape').length;

  // Total size (attachments only)
  const attachments = items.filter(i => i.entityType === 'attachment');
  const totalSize = attachments.reduce((sum, a) => sum + (a.fileSize || 0), 0);

  return (
    <>
      <div className="panopticon-multi-header">
        {items.length} ITEMS SELECTED
      </div>

      <div className="panopticon-multi-size">
        {attachmentCount > 0 && <div>{attachmentCount} attachment{attachmentCount !== 1 ? 's' : ''}</div>}
        {recordCount > 0 && <div>{recordCount} record{recordCount !== 1 ? 's' : ''}</div>}
        {trackCount > 0 && <div>{trackCount} track{trackCount !== 1 ? 's' : ''}</div>}
        {mixtapeCount > 0 && <div>{mixtapeCount} cassette{mixtapeCount !== 1 ? 's' : ''}</div>}
        {attachmentCount > 0 && <div style={{ marginTop: 4 }}>Total size: {formatSize(totalSize)}</div>}
      </div>

      {/* Add Link Buttons (only for attachments) */}
      {attachmentCount > 0 && onOpenLinkModal && (
        <div className="panopticon-section">
          <div className="panopticon-link-buttons">
            <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('record')}>+ Record</button>
            <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('mixtape')}>+ Mixtape</button>
            <button className="panopticon-link-btn" onClick={() => onOpenLinkModal('track')}>+ Track</button>
          </div>
          <div className="panopticon-detail-meta" style={{ marginTop: 8 }}>
            (applies to {attachmentCount} attachment{attachmentCount !== 1 ? 's' : ''})
          </div>
        </div>
      )}

      {/* Delete Button (only for attachments) */}
      {attachmentCount > 0 && onDelete && (
        <button className="panopticon-delete-btn" onClick={onDelete}>
          DELETE {attachmentCount} ATTACHMENT{attachmentCount !== 1 ? 'S' : ''}
        </button>
      )}

      {/* Remove from Library Button (only for tracks) */}
      {trackCount > 0 && onDeleteTracks && (
        <button className="panopticon-delete-btn" onClick={onDeleteTracks}>
          REMOVE {trackCount} TRACK{trackCount !== 1 ? 'S' : ''} FROM LIBRARY
        </button>
      )}
    </>
  );
}

export default PanopticonView;
