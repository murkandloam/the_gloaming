/**
 * RecordDetailPanel - Full record editing in Panopticon detail panel
 *
 * Replaces AlbumManifest modal with inline editing.
 * Features:
 * - Inline editable title/artist
 * - Disc tabs with track list
 * - Track reordering via drag
 * - Ephemera attachment grid
 * - Display options
 * - Era linking
 * - Delete with confirmation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import InlineEditField from './InlineEditField';
import EphemeraBox from './EphemeraBox';
import DeleteRecordModal from './DeleteRecordModal';
import './RecordDetailPanel.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// Default library blur value
const DEFAULT_BLUR = 0;

function RecordDetailPanel({ record: initialRecord, onUpdate, onDelete, onOpenSleeve, onNavigateToTrack }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetLedgerConfirm, setShowResetLedgerConfirm] = useState(false);

  // Disc removal confirmation state
  const [discRemoveConfirm, setDiscRemoveConfirm] = useState(null); // { discNum, trackCount }

  // Drag state - now tracks disc context too
  const [draggedTrack, setDraggedTrack] = useState(null); // { id, disc, index }
  const [dragOverTarget, setDragOverTarget] = useState(null); // { disc, index, position: 'above'|'below' }

  // Display options state
  const [backdropBlur, setBackdropBlur] = useState(DEFAULT_BLUR);
  const [useBackgroundImage, setUseBackgroundImage] = useState(true);
  const [backdropImageId, setBackdropImageId] = useState(null);
  const [allAttachments, setAllAttachments] = useState([]);
  const [imageAttachments, setImageAttachments] = useState([]);

  // Cover drag state - use counter to handle nested element events
  const [coverDragOver, setCoverDragOver] = useState(false);
  const coverDragCounterRef = useRef(0);

  // Vessel linking state
  const [allRecords, setAllRecords] = useState([]); // For vessel picker
  const [vesselSearchQuery, setVesselSearchQuery] = useState('');
  const [showVesselPicker, setShowVesselPicker] = useState(false);

  // Subordinate drag state
  const [draggedSubordinate, setDraggedSubordinate] = useState(null); // childId being dragged
  const [subordinateDragOver, setSubordinateDragOver] = useState(null); // { index, position: 'above'|'below' }

  // Load full record data
  useEffect(() => {
    async function loadRecord() {
      if (!ipcRenderer || !initialRecord?.id) {
        setLoading(false);
        return;
      }

      try {
        const result = await ipcRenderer.invoke('panopticon:get-record-detail', {
          recordId: initialRecord.id
        });

        if (result.success) {
          setRecord(result.record);
          // Load display options from record
          setBackdropBlur(result.record.backdropBlur ?? DEFAULT_BLUR);
          setUseBackgroundImage(result.record.useBackgroundImage !== false);
          setBackdropImageId(result.record.backdropImageId || null);
        }

        // Load all attachments for ephemera box and backdrop picker
        const attachments = await ipcRenderer.invoke('get-album-attachments', initialRecord.id);
        setAllAttachments(attachments || []);
        const images = (attachments || []).filter(att => att.type === 'image');
        setImageAttachments(images);
      } catch (err) {
        console.error('Failed to load record:', err);
      } finally {
        setLoading(false);
      }
    }

    loadRecord();
  }, [initialRecord?.id]);

  // Reload attachments (for EphemeraBox callbacks)
  const reloadAttachments = useCallback(async () => {
    if (!ipcRenderer || !initialRecord?.id) return;
    try {
      const attachments = await ipcRenderer.invoke('get-album-attachments', initialRecord.id);
      setAllAttachments(attachments || []);
      const images = (attachments || []).filter(att => att.type === 'image');
      setImageAttachments(images);
      // Notify parent of changes
      onUpdate?.();
    } catch (err) {
      console.error('Failed to reload attachments:', err);
    }
  }, [initialRecord?.id, onUpdate]);

  // Load all records for vessel picker and name lookups
  const loadRecordsForVesselPicker = useCallback(async () => {
    if (!ipcRenderer) return;
    try {
      const result = await ipcRenderer.invoke('load-albums');
      if (result.albums) {
        // Store all records (for name lookups of children)
        setAllRecords(result.albums);
      }
    } catch (err) {
      console.error('Failed to load records for vessel picker:', err);
    }
  }, []);

  // Filter records for vessel picker - exclude self, own children, and albums that are already subordinates
  const getAvailableVessels = useCallback(() => {
    return allRecords.filter(a =>
      a.id !== initialRecord?.id &&
      !record?.eraChildren?.includes(a.id) &&
      !a.eraParent // Exclude albums that already have a parent vessel
    );
  }, [allRecords, initialRecord?.id, record?.eraChildren]);

  // Check if this record can become a child (has no children of its own)
  const canBeChild = !record?.eraChildren || record.eraChildren.length === 0;

  // Load records if we have an existing vessel parent or children (to display their names)
  useEffect(() => {
    if (record?.eraParent || (record?.eraChildren && record.eraChildren.length > 0)) {
      loadRecordsForVesselPicker();
    }
  }, [record?.eraParent, record?.eraChildren, loadRecordsForVesselPicker]);

  // Handle vessel change
  const handleVesselChange = async (vesselId) => {
    if (!ipcRenderer || !record?.id) return;
    try {
      const result = await ipcRenderer.invoke('panopticon:link-era', {
        recordId: record.id,
        vesselId: vesselId || null
      });
      if (result.success) {
        setRecord(prev => ({ ...prev, eraParent: vesselId || null }));
        setShowVesselPicker(false);
        setVesselSearchQuery('');
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to set vessel:', err);
    }
  };

  // Handle unlinking a subordinate from this vessel
  const handleUnlinkSubordinate = async (childId) => {
    if (!ipcRenderer) return;
    try {
      // Use the link-era handler with null to clear the child's vessel
      const result = await ipcRenderer.invoke('panopticon:link-era', {
        recordId: childId,
        vesselId: null
      });
      if (result.success) {
        // Update local state - remove from eraChildren
        setRecord(prev => ({
          ...prev,
          eraChildren: (prev.eraChildren || []).filter(id => id !== childId)
        }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to unlink subordinate:', err);
    }
  };

  // Handle subordinate drag start
  const handleSubordinateDragStart = (e, childId) => {
    setDraggedSubordinate(childId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', childId);
  };

  // Handle subordinate drag over
  const handleSubordinateDragOver = (e, index) => {
    e.preventDefault();
    if (!draggedSubordinate) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const position = e.clientY < midpoint ? 'above' : 'below';

    setSubordinateDragOver({ index, position });
  };

  // Handle subordinate drop
  const handleSubordinateDrop = async (e) => {
    e.preventDefault();
    if (!draggedSubordinate || !subordinateDragOver || !record?.eraChildren) {
      handleSubordinateDragEnd();
      return;
    }

    const children = [...record.eraChildren];
    const draggedIndex = children.indexOf(draggedSubordinate);
    const { index: targetIndex, position } = subordinateDragOver;

    // Calculate insert position
    let insertIndex = position === 'below' ? targetIndex + 1 : targetIndex;

    // Adjust for removal
    if (draggedIndex < insertIndex) {
      insertIndex -= 1;
    }

    // If same position, no change needed
    if (draggedIndex === insertIndex) {
      handleSubordinateDragEnd();
      return;
    }

    // Reorder the array
    children.splice(draggedIndex, 1);
    children.splice(insertIndex, 0, draggedSubordinate);

    // Save to backend
    try {
      const result = await ipcRenderer.invoke('panopticon:reorder-subordinates', {
        vesselId: record.id,
        childIds: children
      });
      if (result.success) {
        setRecord(prev => ({ ...prev, eraChildren: children }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to reorder subordinates:', err);
    }

    handleSubordinateDragEnd();
  };

  // Handle subordinate drag end
  const handleSubordinateDragEnd = () => {
    setDraggedSubordinate(null);
    setSubordinateDragOver(null);
  };

  // Get unique disc numbers from tracks (always include at least disc 1)
  const getDiscs = (tracks) => {
    const discs = new Set([1]);
    for (const track of tracks) {
      discs.add(track.disc || 1);
    }
    return Array.from(discs).sort((a, b) => a - b);
  };

  // Get tracks for a specific disc, sorted by position
  // Null trackNumbers sort to the end
  const getDiscTracks = (discNum) => {
    if (!record?.tracks) return [];
    return record.tracks
      .filter(t => (t.disc || 1) === discNum)
      .sort((a, b) => {
        // Null trackNumbers sort to end
        if (a.trackNumber == null && b.trackNumber == null) return 0;
        if (a.trackNumber == null) return 1;
        if (b.trackNumber == null) return -1;
        return a.trackNumber - b.trackNumber;
      });
  };

  // Handle field updates
  const handleUpdate = useCallback(async (field, value) => {
    if (!ipcRenderer || !record?.id) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:update-record', {
        recordId: record.id,
        updates: { [field]: value }
      });

      if (result.success) {
        setRecord(prev => ({ ...prev, [field]: value }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update record:', err);
    }
  }, [record?.id, onUpdate]);

  // Handle track field updates
  const handleTrackUpdate = useCallback(async (trackId, field, value) => {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:update-track', {
        trackId,
        updates: { [field]: value }
      });

      if (result.success) {
        // Update the track in local state
        setRecord(prev => ({
          ...prev,
          tracks: prev.tracks?.map(t =>
            t.id === trackId ? { ...t, [field]: value } : t
          )
        }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update track:', err);
    }
  }, [onUpdate]);

  // Handle track drag start
  const handleDragStart = (e, track, disc, index) => {
    setDraggedTrack({ id: track.id, disc, index });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', track.id);
  };

  // Check if event has Panopticon track data
  const hasPanopticonTrack = (e) => {
    return e.dataTransfer.types.includes('application/x-panopticon-item');
  };

  // Handle drag over a track
  const handleDragOver = (e, disc, index) => {
    e.preventDefault();

    // Allow external Panopticon drops or internal reorder
    if (!draggedTrack && !hasPanopticonTrack(e)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const position = e.clientY < midpoint ? 'above' : 'below';

    setDragOverTarget({ disc, index, position });
  };

  // Handle drag over disc header (drop at end of disc)
  const handleDragOverDisc = (e, disc) => {
    e.preventDefault();

    // Allow external Panopticon drops or internal reorder
    if (!draggedTrack && !hasPanopticonTrack(e)) return;

    const discTracks = getDiscTracks(disc);
    setDragOverTarget({ disc, index: discTracks.length, position: 'above' });
  };

  // Handle adding track from Panopticon
  const handleAddTrackFromPanopticon = async (trackData, targetDisc) => {
    if (!ipcRenderer || !record?.id) return;

    try {
      // Call IPC to add track to this record (handles removing from previous record)
      const result = await ipcRenderer.invoke('panopticon:add-tracks-to-record', {
        recordId: record.id,
        trackIds: [trackData.id],
        disc: targetDisc
      });

      if (result.success) {
        // Reload the record to get updated track list
        const reloadResult = await ipcRenderer.invoke('panopticon:get-record-detail', {
          recordId: record.id
        });
        if (reloadResult.success) {
          setRecord(reloadResult.record);
        }
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to add track from Panopticon:', err);
    }
  };

  // Handle drop
  const handleDrop = async (e) => {
    e.preventDefault();

    // Check for Panopticon item drop first
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only handle track drops
        if (item.entityType === 'track') {
          // Determine target disc from drop location
          const targetDisc = dragOverTarget?.disc || 1;
          handleAddTrackFromPanopticon(item, targetDisc);
        }
      } catch (err) {
        console.error('Failed to parse Panopticon item:', err);
      }
      handleDragEnd();
      return;
    }

    if (!draggedTrack || !dragOverTarget) {
      handleDragEnd();
      return;
    }

    const { disc: targetDisc, index: targetIndex, position } = dragOverTarget;
    const { id: trackId, disc: sourceDisc, index: sourceIndex } = draggedTrack;

    // Calculate insert position
    let insertIndex = position === 'below' ? targetIndex + 1 : targetIndex;

    // If same disc, adjust for removal
    if (sourceDisc === targetDisc && sourceIndex < insertIndex) {
      insertIndex -= 1;
    }

    // If same position, no change needed
    if (sourceDisc === targetDisc && sourceIndex === insertIndex) {
      handleDragEnd();
      return;
    }

    // Build new track order for all discs
    const discs = getDiscs(record.tracks || []);
    const trackOrder = [];

    for (const disc of discs) {
      let discTracks = getDiscTracks(disc).filter(t => t.id !== trackId);

      // If this is the target disc, insert the dragged track
      if (disc === targetDisc) {
        const draggedTrackData = record.tracks.find(t => t.id === trackId);
        discTracks.splice(insertIndex, 0, draggedTrackData);
      }

      // Add to track order with new positions
      discTracks.forEach((track, idx) => {
        trackOrder.push({
          trackId: track.id,
          disc: disc,
          position: idx + 1
        });
      });
    }

    try {
      const result = await ipcRenderer.invoke('panopticon:reorder-tracks', {
        recordId: record.id,
        trackOrder
      });

      if (result.success) {
        // Update local state
        const updatedTracks = trackOrder.map(item => {
          const original = record.tracks.find(t => t.id === item.trackId);
          return {
            ...original,
            disc: item.disc,
            trackNumber: item.position,
            position: item.disc * 1000 + item.position
          };
        });
        setRecord(prev => ({ ...prev, tracks: updatedTracks }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to reorder tracks:', err);
    }

    handleDragEnd();
  };

  const handleDragEnd = () => {
    setDraggedTrack(null);
    setDragOverTarget(null);
  };

  // Add a new disc
  const handleAddDisc = () => {
    const discs = getDiscs(record.tracks || []);
    const newDiscNum = discs.length > 0 ? Math.max(...discs) + 1 : 1;

    // We don't need to save anything - the disc appears when it has tracks
    // But we want to show it immediately, so add to local state
    setRecord(prev => ({
      ...prev,
      _emptyDiscs: [...(prev._emptyDiscs || []), newDiscNum]
    }));
  };

  // Initiate disc removal - shows confirmation if disc has tracks
  const handleRemoveDisc = (discNum) => {
    const discTracks = getDiscTracks(discNum);
    const allDiscs = getAllDiscs();

    // Can't remove the only disc
    if (allDiscs.length <= 1) return;

    if (discTracks.length > 0) {
      // Show confirmation dialog
      setDiscRemoveConfirm({ discNum, trackCount: discTracks.length });
    } else {
      // Empty disc - remove directly from local state
      setRecord(prev => ({
        ...prev,
        _emptyDiscs: (prev._emptyDiscs || []).filter(d => d !== discNum)
      }));
    }
  };

  // Confirm disc removal - either move tracks to previous disc or orphan them
  const confirmRemoveDisc = async (moveTracksToPrevious) => {
    if (!discRemoveConfirm || !ipcRenderer) return;

    const { discNum } = discRemoveConfirm;
    const discTracks = getDiscTracks(discNum);
    const allDiscs = getAllDiscs();
    const discIndex = allDiscs.indexOf(discNum);
    const previousDisc = discIndex > 0 ? allDiscs[discIndex - 1] : null;

    if (moveTracksToPrevious && previousDisc) {
      // Move tracks to the previous disc
      const previousDiscTracks = getDiscTracks(previousDisc);
      const startPosition = previousDiscTracks.length + 1;

      // Build track order with moved tracks appended to previous disc
      const trackOrder = [];

      for (const disc of allDiscs) {
        if (disc === discNum) continue; // Skip the disc being removed

        let discTrackList = getDiscTracks(disc);

        // If this is the previous disc, append the moved tracks
        if (disc === previousDisc) {
          discTrackList = [...discTrackList, ...discTracks];
        }

        discTrackList.forEach((track, idx) => {
          trackOrder.push({
            trackId: track.id,
            disc: disc,
            position: idx + 1
          });
        });
      }

      try {
        const result = await ipcRenderer.invoke('panopticon:reorder-tracks', {
          recordId: record.id,
          trackOrder
        });

        if (result.success) {
          // Update local state
          const updatedTracks = trackOrder.map(item => {
            const original = record.tracks.find(t => t.id === item.trackId);
            return {
              ...original,
              disc: item.disc,
              trackNumber: item.position,
              position: item.disc * 1000 + item.position
            };
          });
          setRecord(prev => ({
            ...prev,
            tracks: updatedTracks,
            _emptyDiscs: (prev._emptyDiscs || []).filter(d => d !== discNum)
          }));
          onUpdate?.();
        }
      } catch (err) {
        console.error('Failed to move tracks:', err);
      }
    } else {
      // Orphan tracks - remove them from this record
      for (const track of discTracks) {
        try {
          await ipcRenderer.invoke('panopticon:remove-track-from-record', {
            recordId: record.id,
            trackId: track.id
          });
        } catch (err) {
          console.error('Failed to orphan track:', err);
        }
      }

      // Update local state
      const orphanedIds = new Set(discTracks.map(t => t.id));
      setRecord(prev => ({
        ...prev,
        tracks: prev.tracks.filter(t => !orphanedIds.has(t.id)),
        _emptyDiscs: (prev._emptyDiscs || []).filter(d => d !== discNum)
      }));
      onUpdate?.();
    }

    setDiscRemoveConfirm(null);
  };

  // Get all discs including empty ones
  const getAllDiscs = () => {
    const trackDiscs = getDiscs(record?.tracks || []);
    const emptyDiscs = record?._emptyDiscs || [];
    const allDiscs = new Set([...trackDiscs, ...emptyDiscs]);
    return Array.from(allDiscs).sort((a, b) => a - b);
  };

  // Handle track removal
  const handleRemoveTrack = async (trackId) => {
    if (!ipcRenderer || !record?.id) return;

    try {
      const result = await ipcRenderer.invoke('panopticon:remove-track-from-record', {
        recordId: record.id,
        trackId
      });

      if (result.success) {
        setRecord(prev => ({
          ...prev,
          tracks: prev.tracks.filter(t => t.id !== trackId)
        }));
        onUpdate?.();
      }
    } catch (err) {
      console.error('Failed to remove track:', err);
    }
  };

  // Handle reset ledger counts for this record
  const handleResetLedger = async () => {
    if (!ipcRenderer || !record?.id) return;

    try {
      const result = await ipcRenderer.invoke('reset-album-listening-stats', record.id);

      if (result.success) {
        setShowResetLedgerConfirm(false);
        // Could show a toast/notification here
      }
    } catch (err) {
      console.error('Failed to reset ledger counts:', err);
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format total duration
  const formatTotalDuration = () => {
    if (!record?.tracks) return '—';
    const total = record.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const mins = Math.floor(total / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  // Cover drag handlers - for dropping images to set as album cover
  // Uses counter to handle nested element events without flickering
  const handleCoverDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    coverDragCounterRef.current++;
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasPanopticonItem = e.dataTransfer.types.includes('application/x-panopticon-item');
    if (hasFiles || hasPanopticonItem) {
      setCoverDragOver(true);
    }
  };

  const handleCoverDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    coverDragCounterRef.current--;
    // Only hide overlay when truly leaving the container
    if (coverDragCounterRef.current === 0) {
      setCoverDragOver(false);
    }
  };

  const handleCoverDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleCoverDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    coverDragCounterRef.current = 0; // Reset counter on drop
    setCoverDragOver(false);

    if (!ipcRenderer || !record?.id) return;

    // Check for Panopticon attachment drop
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only handle image attachment drops
        if (item.entityType === 'attachment' && item.type?.startsWith('image')) {
          console.log('[RecordDetailPanel] Setting cover from Panopticon attachment:', item.id);
          const result = await ipcRenderer.invoke('panopticon:set-record-cover-from-attachment', {
            recordId: record.id,
            attachmentId: item.id
          });
          if (result.success) {
            // Reload record to get updated cover
            const reloadResult = await ipcRenderer.invoke('panopticon:get-record-detail', {
              recordId: record.id
            });
            if (reloadResult.success) {
              setRecord(reloadResult.record);
            }
            onUpdate?.();
          }
        }
      } catch (err) {
        console.error('[RecordDetailPanel] Failed to set cover from Panopticon:', err);
      }
      return;
    }

    // Handle file drops
    if (e.dataTransfer.types.includes('Files')) {
      const files = Array.from(e.dataTransfer.files);
      const imageFile = files.find(f => f.type.startsWith('image/'));
      if (imageFile) {
        console.log('[RecordDetailPanel] Setting cover from file:', imageFile.path);
        try {
          const result = await ipcRenderer.invoke('panopticon:set-record-cover', {
            recordId: record.id,
            imagePath: imageFile.path
          });
          if (result.success) {
            // Reload record to get updated cover
            const reloadResult = await ipcRenderer.invoke('panopticon:get-record-detail', {
              recordId: record.id
            });
            if (reloadResult.success) {
              setRecord(reloadResult.record);
            }
            onUpdate?.();
          }
        } catch (err) {
          console.error('[RecordDetailPanel] Failed to set cover from file:', err);
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="record-detail-panel">
        <div className="record-detail-loading">Loading...</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="record-detail-panel">
        <div className="record-detail-empty">Record not found</div>
      </div>
    );
  }

  const allDiscs = getAllDiscs();
  const coverUrl = record.coverPath ? `local://${record.coverPath}` : null;

  return (
    <div className="record-detail-panel">
      {/* Header - Large cover with info beside it */}
      <div className="record-detail-header">
        <div className="record-detail-cover-column">
          <div
            className={`record-detail-cover-large ${coverDragOver ? 'drag-over' : ''}`}
            onDragEnter={handleCoverDragEnter}
            onDragLeave={handleCoverDragLeave}
            onDragOver={handleCoverDragOver}
            onDrop={handleCoverDrop}
          >
            {coverUrl ? (
              <img src={coverUrl} alt={record.name} />
            ) : (
              <span className="record-detail-cover-placeholder">💿</span>
            )}
            {coverDragOver && (
              <div className="record-detail-cover-drop-hint">Drop to set cover</div>
            )}
          </div>
          {onOpenSleeve && (
            <button
              className="record-detail-open-sleeve-btn"
              onClick={() => onOpenSleeve(record)}
              title={`Open sleeve for ${record.name}`}
            >
              Open Sleeve...
            </button>
          )}
        </div>
        <div className="record-detail-meta">
          <InlineEditField
            value={record.name}
            onChange={(v) => handleUpdate('name', v)}
            placeholder="Untitled Record"
            variant="title"
          />
          <div className="record-detail-info">
            {record.tracks?.length || 0} tracks · {formatTotalDuration()}
          </div>
          <div className="record-detail-meta-table">
            <div className="meta-row">
              <span className="meta-label">Album Artist</span>
              <span className="meta-value">
                <InlineEditField
                  value={record.artist}
                  onChange={(v) => handleUpdate('artist', v)}
                  placeholder="Unknown Artist"
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Sort Record As</span>
              <span className="meta-value">
                <InlineEditField
                  value={record.sortName}
                  onChange={(v) => handleUpdate('sortName', v)}
                  placeholder={record.name || 'Record name'}
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Sort Artist As</span>
              <span className="meta-value">
                <InlineEditField
                  value={record.sortArtist}
                  onChange={(v) => handleUpdate('sortArtist', v)}
                  placeholder={record.artist || 'Artist name'}
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Release Date</span>
              <span className="meta-value">
                <InlineEditField
                  value={record.releaseDate || record.year}
                  onChange={(v) => handleUpdate('releaseDate', v)}
                  placeholder="DD-MM-YYYY"
                  monospace
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Genre</span>
              <span className="meta-value">
                <InlineEditField
                  value={record.genre}
                  onChange={(v) => handleUpdate('genre', v)}
                  placeholder="—"
                />
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Added</span>
              <span className="meta-value">
                {record.addedAt ? new Date(record.addedAt).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">ID</span>
              <span className="meta-value meta-mono">{record.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Track list - all discs visible */}
      <div className="record-detail-section record-detail-tracks-section">
        <div className="record-detail-section-title">TRACKS</div>

        {/* Horizontally scrollable track list container */}
        <div className="record-detail-tracks-scroll-wrapper">
            {/* Column headers */}
            <div className="record-detail-track-header">
              <span className="track-header-handle"></span>
              <span className="track-header-number">#</span>
              <span className="track-header-title">Title</span>
              <span className="track-header-artist">Track Artist</span>
              <span className="track-header-duration">Time</span>
              <span className="track-header-format">Format</span>
              <span className="track-header-bitrate">Bitrate</span>
              <span className="track-header-ledgers">Ledgers</span>
              <span className="track-header-actions"></span>
            </div>

        {allDiscs.map(discNum => {
          const discTracks = getDiscTracks(discNum);
          const canRemoveDisc = allDiscs.length > 1;

          return (
            <div key={discNum} className="record-detail-disc-section">
              {/* Disc header */}
              <div
                className="record-detail-disc-header"
                onDragOver={(e) => handleDragOverDisc(e, discNum)}
                onDrop={handleDrop}
              >
                <span className="disc-label">DISC {discNum}</span>
                <button
                  className={`disc-remove-btn ${canRemoveDisc ? '' : 'disabled'}`}
                  onClick={() => handleRemoveDisc(discNum)}
                  disabled={!canRemoveDisc}
                  title={canRemoveDisc ? 'Remove disc' : 'Cannot remove only disc'}
                >
                  − Disc
                </button>
              </div>

              {/* Tracks for this disc */}
              <div className="record-detail-track-list">
                {discTracks.length === 0 ? (
                  <div
                    className="record-detail-empty-tracks"
                    onDragOver={(e) => handleDragOverDisc(e, discNum)}
                    onDrop={handleDrop}
                  >
                    Drag tracks here
                  </div>
                ) : (
                  <>
                    {discTracks.map((track, index) => {
                      const isDragging = draggedTrack?.id === track.id;
                      const isOver = dragOverTarget?.disc === discNum && dragOverTarget?.index === index;
                      const isOverBelow = dragOverTarget?.disc === discNum && dragOverTarget?.index === index && dragOverTarget?.position === 'below';
                      const isOverAbove = dragOverTarget?.disc === discNum && dragOverTarget?.index === index && dragOverTarget?.position === 'above';

                      // Track artist display: show if different from album artist, otherwise empty
                      const showTrackArtist = track.trackArtist && track.trackArtist !== record.artist;
                      const displayArtist = showTrackArtist ? track.trackArtist : record.artist;

                      // Format bitrate for display (e.g., 320000 -> "320k")
                      const formatBitrate = (bitrate) => {
                        if (!bitrate) return '—';
                        const kbps = Math.round(bitrate / 1000);
                        return `${kbps}k`;
                      };

                      return (
                        <div
                          key={track.id}
                          className={`record-detail-track ${isDragging ? 'dragging' : ''} ${isOverAbove ? 'drag-over-top' : ''} ${isOverBelow ? 'drag-over-bottom' : ''}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, track, discNum, index)}
                          onDragOver={(e) => handleDragOver(e, discNum, index)}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                        >
                          <span className="track-drag-handle">⠿</span>
                          <span className="track-number">{track.trackNumber || '—'}</span>
                          <span
                            className="track-title clickable"
                            onClick={() => onNavigateToTrack?.(track.id)}
                            title="Open track details"
                          >
                            {track.title}
                          </span>
                          <span className={`track-artist ${showTrackArtist ? 'different' : ''}`}>{displayArtist}</span>
                          <span className="track-duration">{formatDuration(track.duration)}</span>
                          <span className="track-format">{track.format || '—'}</span>
                          <span className="track-bitrate">{formatBitrate(track.bitrate)}</span>
                          <span className="track-ledgers">
                            <label className="record-detail-toggle">
                              <input
                                type="checkbox"
                                checked={track.includeInLedgers !== false}
                                onChange={(e) => handleTrackUpdate(track.id, 'includeInLedgers', e.target.checked)}
                              />
                              <span className="toggle-track">
                                <span className="toggle-thumb"></span>
                              </span>
                            </label>
                          </span>
                          <button
                            className="track-remove-btn"
                            onClick={() => handleRemoveTrack(track.id)}
                            title="Remove from record"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {/* Drop zone for adding tracks at end of disc */}
                    <div
                      className={`record-detail-track-drop-end ${dragOverTarget?.disc === discNum && dragOverTarget?.index === discTracks.length ? 'drag-over' : ''}`}
                      onDragOver={(e) => handleDragOverDisc(e, discNum)}
                      onDrop={handleDrop}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
        </div>

        {/* Add disc button */}
        <button className="record-detail-add-disc-btn-small" onClick={handleAddDisc}>
          + Disc
        </button>
      </div>

      {/* Horizontal divider under tracks */}
      <div className="record-detail-divider" />

      {/* Two-column layout for options */}
      <div className="record-detail-two-col">
        {/* Left column: Format, Characteristics, Visibility */}
        <div className="record-detail-col">
          {/* FORMAT - Radio buttons */}
          <div className="record-detail-section">
            <div className="record-detail-section-title">FORMAT</div>
            <label className="record-detail-radio">
              <input
                type="radio"
                name="format"
                checked={(record.format || 'LP') === 'LP'}
                onChange={() => handleUpdate('format', 'LP')}
              />
              <span className="radio-label">LP</span>
            </label>
            <label className="record-detail-radio">
              <input
                type="radio"
                name="format"
                checked={record.format === 'EP'}
                onChange={() => handleUpdate('format', 'EP')}
              />
              <span className="radio-label">EP</span>
            </label>
            <label className="record-detail-radio">
              <input
                type="radio"
                name="format"
                checked={record.format === 'Single'}
                onChange={() => handleUpdate('format', 'Single')}
              />
              <span className="radio-label">Single</span>
            </label>
          </div>

          {/* CHARACTERISTICS - Checkboxes */}
          <div className="record-detail-section">
            <div className="record-detail-section-title">CHARACTERISTICS</div>
            {[
              { id: 'Compilation', label: 'Compilation' },
              { id: 'Concert', label: 'Concert' },
              { id: 'Soundtrack', label: 'Soundtrack' },
              { id: 'ComposerWork', label: 'Composer Work' },
              { id: 'Miscellanea', label: 'Miscellanea' },
              { id: 'Reissue', label: 'Reissue' }
            ].map(({ id, label }) => (
              <label key={id} className="record-detail-toggle">
                <input
                  type="checkbox"
                  checked={(record.characteristics || []).includes(id)}
                  onChange={(e) => {
                    const current = record.characteristics || [];
                    const updated = e.target.checked
                      ? [...current, id]
                      : current.filter(c => c !== id);
                    handleUpdate('characteristics', updated);
                  }}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                <span className="toggle-label">{label}</span>
              </label>
            ))}
          </div>

          {/* VISIBILITY */}
          <div className="record-detail-section">
            <div className="record-detail-section-title">VISIBILITY</div>
            <label className="record-detail-toggle">
              <input
                type="checkbox"
                checked={record.showOnGrid !== false}
                onChange={(e) => handleUpdate('showOnGrid', e.target.checked)}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Show on Grid</span>
            </label>
            <label className="record-detail-toggle">
              <input
                type="checkbox"
                checked={record.includeInLedgers !== false}
                onChange={(e) => handleUpdate('includeInLedgers', e.target.checked)}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Include in Ledgers</span>
            </label>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="record-detail-col-divider" />

        {/* Right column: Sleeve Backdrop */}
        <div className="record-detail-col">
          <div className="record-detail-section">
            <div className="record-detail-section-title">SLEEVE BACKDROP</div>
            <label className="record-detail-toggle">
              <input
                type="checkbox"
                checked={useBackgroundImage}
                onChange={(e) => {
                  setUseBackgroundImage(e.target.checked);
                  handleUpdate('useBackgroundImage', e.target.checked);
                }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Use art as backdrop</span>
            </label>

            {useBackgroundImage && (
              <>
                {/* Blur preview */}
                <div className="record-detail-blur-section">
                  <div className="record-detail-blur-label">Backdrop Blur</div>
                  <div className="record-detail-blur-preview">
                    <img
                      src={backdropImageId
                        ? `local://${imageAttachments.find(a => a.id === backdropImageId)?.path}`
                        : coverUrl
                      }
                      alt=""
                      style={{ filter: `blur(${backdropBlur}px) brightness(0.35) saturate(1.3)` }}
                    />
                    <div className="record-detail-blur-preview-overlay">Preview</div>
                  </div>
                  <div className="record-detail-blur-slider">
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={backdropBlur}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBackdropBlur(val);
                        handleUpdate('backdropBlur', val);
                      }}
                    />
                    <span className="blur-value">{backdropBlur}px</span>
                  </div>
                </div>

                {/* Backdrop image picker */}
                {imageAttachments.length > 0 && (
                  <div className="record-detail-field-row">
                    <span className="field-label">Image</span>
                    <select
                      className="record-detail-select"
                      value={backdropImageId || ''}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        setBackdropImageId(val);
                        handleUpdate('backdropImageId', val);
                      }}
                    >
                      <option value="">Cover</option>
                      {imageAttachments.map(att => (
                        <option key={att.id} value={att.id}>
                          {att.originalName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Vessel Linking - in right column below Sleeve Backdrop */}
          <div className="record-detail-section">
            <div className="record-detail-section-title">VESSEL LINKING</div>
            <div className="vessel-linking-content">
              {/* Current vessel (parent) - only show if this record can be a child */}
              {canBeChild && (
                <div className="vessel-field">
                  <span className="vessel-label">Vessel</span>
                  {record.eraParent ? (
                    <div className="vessel-current">
                      <span className="vessel-name">
                        {allRecords.find(r => r.id === record.eraParent)?.title || record.eraParent}
                      </span>
                      <button
                        className="vessel-clear-btn"
                        onClick={() => handleVesselChange(null)}
                        title="Clear vessel"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="vessel-picker-wrapper">
                      {showVesselPicker ? (
                        <div className="vessel-picker">
                          <input
                            type="text"
                            className="vessel-search-input"
                            placeholder="Search records..."
                            value={vesselSearchQuery}
                            onChange={(e) => setVesselSearchQuery(e.target.value)}
                            autoFocus
                          />
                          <div className="vessel-picker-list">
                            {getAvailableVessels()
                              .filter(r => {
                                if (!vesselSearchQuery) return true;
                                const q = vesselSearchQuery.toLowerCase();
                                return r.title?.toLowerCase().includes(q) ||
                                       r.artist?.toLowerCase().includes(q);
                              })
                              .slice(0, 10)
                              .map(r => (
                                <div
                                  key={r.id}
                                  className="vessel-picker-item"
                                  onClick={() => handleVesselChange(r.id)}
                                >
                                  <span className="vessel-picker-name">{r.title}</span>
                                  <span className="vessel-picker-artist">{r.artist}</span>
                                </div>
                              ))
                            }
                            {getAvailableVessels().filter(r => {
                              if (!vesselSearchQuery) return true;
                              const q = vesselSearchQuery.toLowerCase();
                              return r.title?.toLowerCase().includes(q) ||
                                     r.artist?.toLowerCase().includes(q);
                            }).length === 0 && (
                              <div className="vessel-picker-empty">No matching records</div>
                            )}
                          </div>
                          <button
                            className="vessel-picker-cancel"
                            onClick={() => {
                              setShowVesselPicker(false);
                              setVesselSearchQuery('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="vessel-set-btn"
                          onClick={() => {
                            loadRecordsForVesselPicker();
                            setShowVesselPicker(true);
                          }}
                        >
                          Set Vessel...
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Children (subordinate records linked to this one) */}
              {record.eraChildren && record.eraChildren.length > 0 && (
                <div className="vessel-children">
                  <span className="vessel-label">Subordinate Releases</span>
                  <div className="vessel-children-list">
                    {record.eraChildren.map((childId, index) => {
                      const child = allRecords.find(r => r.id === childId);
                      const isDragging = draggedSubordinate === childId;
                      const isOverAbove = subordinateDragOver?.index === index && subordinateDragOver?.position === 'above';
                      const isOverBelow = subordinateDragOver?.index === index && subordinateDragOver?.position === 'below';

                      return (
                        <div
                          key={childId}
                          className={`vessel-child-item ${isDragging ? 'dragging' : ''} ${isOverAbove ? 'drag-over-top' : ''} ${isOverBelow ? 'drag-over-bottom' : ''}`}
                          draggable
                          onDragStart={(e) => handleSubordinateDragStart(e, childId)}
                          onDragOver={(e) => handleSubordinateDragOver(e, index)}
                          onDrop={handleSubordinateDrop}
                          onDragEnd={handleSubordinateDragEnd}
                        >
                          <span className="subordinate-drag-handle">⋮⋮</span>
                          <span className="subordinate-title">{child?.title || childId}</span>
                          <button
                            className="subordinate-remove-btn"
                            onClick={() => handleUnlinkSubordinate(childId)}
                            title="Unlink from vessel"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="vessel-help-text">
                Link this record to a parent "vessel" album (e.g., singles to their parent LP).
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Horizontal divider under display/backdrop */}
      <div className="record-detail-divider" />

      {/* Ephemera */}
      <div className="record-detail-section">
        <div className="record-detail-section-title">EPHEMERA</div>
        <EphemeraBox
          entityType="album"
          entityId={record.id}
          attachments={allAttachments}
          onAttachmentsChange={reloadAttachments}
          variant="medium"
          showHeader={false}
          showSizeSlider={false}
        />
      </div>


      {/* Disc removal confirmation dialog */}
      {discRemoveConfirm && (
        <div className="disc-remove-confirm-overlay">
          <div className="disc-remove-confirm-dialog">
            <div className="disc-remove-confirm-title">Remove Disc {discRemoveConfirm.discNum}?</div>
            <div className="disc-remove-confirm-message">
              This disc has {discRemoveConfirm.trackCount} track{discRemoveConfirm.trackCount !== 1 ? 's' : ''}.
            </div>
            <div className="disc-remove-confirm-buttons">
              {getAllDiscs().indexOf(discRemoveConfirm.discNum) > 0 && (
                <button
                  className="move-tracks-btn"
                  onClick={() => confirmRemoveDisc(true)}
                >
                  Move to Disc {getAllDiscs()[getAllDiscs().indexOf(discRemoveConfirm.discNum) - 1]}
                </button>
              )}
              <button
                className="orphan-tracks-btn"
                onClick={() => confirmRemoveDisc(false)}
              >
                Remove as Strays
              </button>
              <button
                className="cancel-btn"
                onClick={() => setDiscRemoveConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dangerous actions */}
      <div className="record-detail-actions">
        <div className="record-detail-danger-buttons">
          {!showResetLedgerConfirm ? (
            <button
              className="record-detail-delete-btn"
              onClick={() => setShowResetLedgerConfirm(true)}
            >
              Reset Ledger Counts for Record
            </button>
          ) : (
            <div className="record-detail-delete-confirm">
              <span>Reset all listening history for this record's tracks?</span>
              <div className="delete-confirm-buttons">
                <button onClick={() => setShowResetLedgerConfirm(false)}>Cancel</button>
                <button className="danger" onClick={handleResetLedger}>Reset</button>
              </div>
            </div>
          )}

          <button
            className="record-detail-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Record
          </button>
        </div>
      </div>

      {/* Delete Record Modal */}
      <DeleteRecordModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        record={record}
        onDeleted={onDelete}
      />
    </div>
  );
}

export default RecordDetailPanel;
