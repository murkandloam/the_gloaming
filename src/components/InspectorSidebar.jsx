import React, { useRef, useEffect, useState, useCallback } from 'react';
import '../styles/InspectorSidebar.css';
import FacetPicker from './FacetPicker';
import AddToMixtapeModal from './AddToMixtapeModal';
import EphemeraBox from './EphemeraBox';
import { getCassetteImage } from '../assets/cassettes';
import panopticonEye from '../assets/panopticon/eyecentre.png';

const { ipcRenderer } = window.require('electron');

// Format duration as H:MM:SS
function formatDuration(seconds) {
  if (!seconds || seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Get file type from audio path
function getFileType(audioPath) {
  if (!audioPath) return null;
  const ext = audioPath.split('.').pop()?.toLowerCase();
  const typeMap = {
    'm4a': 'ALAC',
    'flac': 'FLAC',
    'mp3': 'MP3',
    'wav': 'WAV',
    'aiff': 'AIFF',
    'aif': 'AIFF',
    'ogg': 'OGG',
    'opus': 'OPUS'
  };
  return typeMap[ext] || ext?.toUpperCase() || null;
}


function InspectorSidebar({
  track,
  currentTrackId,
  coverCacheBust = 0,
  facetsRefreshKey = 0,
  activeTab,
  onTabChange,
  onPlayTrack,
  onAddToQueue,
  onOpenSleeve,
  onViewInPanopticon,
  onFacetClick,
  onFacetContextMenu,
  onTrackUpdate,
  onMixtapeSelect,
  onProgramSelect,
  onTrackContextMenu,
  onAttachmentContextMenu,
  // Triggers for opening modals from context menus
  triggerFacetPicker = 0,
  triggerAddToMixtape = 0,
  // Search props
  searchQuery,
  onSearchChange,
  onSearchFocus,
  searchInputRef
}) {
  const [showFacetPicker, setShowFacetPicker] = useState(false);
  const [showAddToMixtape, setShowAddToMixtape] = useState(false);
  const [trackFacets, setTrackFacets] = useState([]);
  const [facetsConfig, setFacetsConfig] = useState({ groups: [], starred: [], recent: [] });
  const [trackMixtapes, setTrackMixtapes] = useState([]);
  const [mixtapesRefreshKey, setMixtapesRefreshKey] = useState(0);
  const [trackStats, setTrackStats] = useState({ total_seconds: 0, listen_count: 0 });
  const [trackAttachments, setTrackAttachments] = useState([]);

  // Drop zone state for attachments
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Load facets when track changes or facets are modified elsewhere
  useEffect(() => {
    if (track?.id) {
      loadTrackFacets(track.id);
    } else {
      setTrackFacets([]);
    }
    // Also load facets config for colors
    loadFacetsConfig();
  }, [track?.id, facetsRefreshKey]);

  async function loadFacetsConfig() {
    try {
      const config = await ipcRenderer.invoke('get-facets');
      setFacetsConfig(config || { groups: [], starred: [], recent: [] });
    } catch (err) {
      console.error('Error loading facets config:', err);
    }
  }

  // Get color for a facet based on its group
  function getFacetColor(facetName) {
    for (const group of facetsConfig.groups || []) {
      if ((group.facets || []).includes(facetName)) {
        return group.color || '#d4843a';
      }
    }
    return null; // uncategorized
  }

  // Load mixtapes containing this track
  useEffect(() => {
    if (track?.id) {
      loadTrackMixtapes(track.id);
    } else {
      setTrackMixtapes([]);
    }
  }, [track?.id, mixtapesRefreshKey]);

  // Load listening stats for this track
  // Reload stats when track changes OR when current playing track changes
  // (so stats update after a song ends/skips)
  useEffect(() => {
    if (track?.id) {
      loadTrackStats(track.id);
    } else {
      setTrackStats({ total_seconds: 0, listen_count: 0 });
    }
  }, [track?.id, currentTrackId]);

  // Load attachments for this track
  useEffect(() => {
    if (track?.id) {
      loadTrackAttachments(track.id);
    } else {
      setTrackAttachments([]);
    }
  }, [track?.id]);

  // Track previous trigger values to only open modals on actual trigger changes
  // Initialize to current prop value so we don't re-trigger on remount
  const prevTriggerFacetPicker = useRef(triggerFacetPicker);
  const prevTriggerAddToMixtape = useRef(triggerAddToMixtape);

  // Open FacetPicker when triggered from context menu
  useEffect(() => {
    if (triggerFacetPicker > 0 && triggerFacetPicker !== prevTriggerFacetPicker.current && track?.id) {
      setShowFacetPicker(true);
    }
    prevTriggerFacetPicker.current = triggerFacetPicker;
  }, [triggerFacetPicker, track?.id]);

  // Open AddToMixtape when triggered from context menu
  useEffect(() => {
    if (triggerAddToMixtape > 0 && triggerAddToMixtape !== prevTriggerAddToMixtape.current && track?.id) {
      setShowAddToMixtape(true);
    }
    prevTriggerAddToMixtape.current = triggerAddToMixtape;
  }, [triggerAddToMixtape, track?.id]);

  async function loadTrackAttachments(trackId) {
    try {
      const attachments = await ipcRenderer.invoke('get-track-attachments', trackId);
      setTrackAttachments(attachments || []);
    } catch (err) {
      console.error('Error loading track attachments:', err);
      setTrackAttachments([]);
    }
  }

  async function loadTrackFacets(trackId) {
    try {
      const facets = await ipcRenderer.invoke('get-track-facets', trackId);
      setTrackFacets(facets);
    } catch (err) {
      console.error('Error loading track facets:', err);
      setTrackFacets(track?.facets || []);
    }
  }

  async function loadTrackMixtapes(trackId) {
    try {
      const mixtapes = await ipcRenderer.invoke('get-mixtapes-for-track', trackId);
      setTrackMixtapes(mixtapes || []);
    } catch (err) {
      console.error('Error loading track mixtapes:', err);
      setTrackMixtapes([]);
    }
  }

  // Get cover image for a mixtape (custom cover or cassette)
  function getMixtapeCoverImage(mixtape) {
    if (mixtape.coverPath) {
      return `local://${mixtape.coverPath}`;
    }
    // Fall back to cassette image
    return getCassetteImage(mixtape.cassetteIndex ?? 0);
  }

  async function loadTrackStats(trackId) {
    try {
      const stats = await ipcRenderer.invoke('get-track-listening-stats', trackId);
      setTrackStats(stats || { total_seconds: 0, listen_count: 0 });
    } catch (err) {
      console.error('Error loading track stats:', err);
      setTrackStats({ total_seconds: 0, listen_count: 0 });
    }
  }

  async function handleAddFacet(facetName) {
    if (!track?.id) return;
    
    try {
      await ipcRenderer.invoke('add-facet-to-track', { 
        trackId: track.id, 
        facetName 
      });
      // Reload facets
      loadTrackFacets(track.id);
      // Notify parent if needed
      onTrackUpdate?.();
    } catch (err) {
      console.error('Error adding facet:', err);
    }
  }

  async function handleRemoveFacet(facetName) {
    if (!track?.id) return;
    
    try {
      await ipcRenderer.invoke('remove-facet-from-track', { 
        trackId: track.id, 
        facetName 
      });
      // Reload facets
      loadTrackFacets(track.id);
      // Notify parent if needed
      onTrackUpdate?.();
    } catch (err) {
      console.error('Error removing facet:', err);
    }
  }

  function handleFacetPillClick(facetName, e) {
    e.stopPropagation();
    if (onFacetClick) {
      onFacetClick(facetName);
    }
  }

  // === Drop Zone Handlers for Attachments ===
  // These intercept drops on the inspector sidebar to add attachments to the current track
  // and prevent the drop from bubbling up to the global import drop zone

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current++;

    // Only show drag feedback if we have a track to attach to and it's a file drag
    if (track?.id && e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, [track?.id]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragOver(false);
    dragCounterRef.current = 0;

    // If no track selected, can't attach
    if (!track?.id) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    // Get file paths and add as attachments
    const filePaths = Array.from(files).map(f => f.path).filter(Boolean);

    for (const filePath of filePaths) {
      try {
        // Add to library
        const result = await ipcRenderer.invoke('add-attachment', { filePath });
        if (!result.success) {
          console.error('Failed to add attachment:', result.error);
          continue;
        }

        // Link to track
        const attachmentId = result.attachment.id;
        const linkResult = await ipcRenderer.invoke('add-attachment-to-track', {
          trackId: track.id,
          attachmentId
        });

        if (!linkResult.success) {
          console.error('Failed to link attachment:', linkResult.error);
        }
      } catch (err) {
        console.error('Error adding attachment:', err);
      }
    }

    // Refresh attachments display
    loadTrackAttachments(track.id);
  }, [track?.id]);

  return (
    <div
      className={`inspector-sidebar ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Search Bar */}
      <div className="inspector-search">
        <span className="search-icon">⌕</span>
        <input
          ref={searchInputRef}
          type="text"
          className="search-input"
          placeholder="Search..."
          value={searchQuery || ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onFocus={onSearchFocus}
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => onSearchChange?.('')}
          >
            ×
          </button>
        )}
      </div>

      {/* Tab Headers */}
      <div className="inspector-tabs">
        <button 
          className={`inspector-tab ${activeTab === 'nowPlaying' ? 'active' : ''}`}
          onClick={() => onTabChange('nowPlaying')}
        >
          Now Playing
        </button>
        <button 
          className={`inspector-tab ${activeTab === 'selected' ? 'active' : ''}`}
          onClick={() => onTabChange('selected')}
        >
          Selected
        </button>
      </div>

      {/* Content */}
      <div className="inspector-content">
        {track ? (
          <>
            {/* Album Art */}
            <div
              className="inspector-album-art"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onTrackContextMenu) {
                  onTrackContextMenu(e, track, 'inspector');
                }
              }}
            >
              {track.albumArt ? (
                <img src={`local://${track.albumArt}?v=${coverCacheBust}`} alt="Album Art" />
              ) : (
                <div className="inspector-album-art-placeholder">♪</div>
              )}
            </div>

            {/* Action Buttons - New Layout */}
            <div className="inspector-actions-row">
              <button
                className="inspector-action-btn open-sleeve-btn"
                onClick={() => onOpenSleeve && onOpenSleeve(track)}
              >
                Open Sleeve
              </button>
              <button
                className="inspector-action-btn panopticon-btn"
                onClick={() => onViewInPanopticon && onViewInPanopticon(track)}
                title="View in Panopticon"
              >
                <img src={panopticonEye} alt="Panopticon" className="panopticon-eye-icon" />
              </button>
            </div>

            {/* Source Button - Now Playing tab only */}
            {activeTab === 'nowPlaying' && (
              <button
                className="inspector-source-btn"
                onClick={() => {
                  // Navigate based on source type
                  if (track.sourceType === 'program' && track.sourceId && onProgramSelect) {
                    onProgramSelect(track.sourceId);
                  } else if (track.sourceType === 'mixtape' && track.sourceId && onMixtapeSelect) {
                    onMixtapeSelect({ id: track.sourceId, name: track.sourceName });
                  } else if (track.albumId && onOpenSleeve) {
                    onOpenSleeve(track);
                  }
                }}
                title={
                  track.sourceType === 'program' ? `From program: ${track.sourceName || 'Unknown'}` :
                  track.sourceType === 'mixtape' ? `From cassette: ${track.sourceName || 'Unknown'}` :
                  `From album: ${track.album || 'Unknown'}`
                }
              >
                Presently Sourced From...
              </button>
            )}

            {/* Play & Add to Queue - Selected tab only */}
            {activeTab === 'selected' && (
              <div className="inspector-actions-row">
                <button 
                  className="inspector-action-btn play-btn"
                  onClick={() => onPlayTrack && onPlayTrack(track)}
                >
                  ▶ Play
                </button>
                <button 
                  className="inspector-action-btn queue-btn"
                  onClick={() => onAddToQueue && onAddToQueue(track)}
                >
                  + Queue
                </button>
              </div>
            )}

            {/* Track Details */}
            <div className="inspector-section">
              <SmartScrollText text={track.title} className="inspector-title" />
              <SmartScrollText text={track.trackArtist || track.artist} className="inspector-artist" />
              <SmartScrollText text={track.album} className="inspector-album" />
            </div>

            {/* Metadata Section - always show */}
            <div className="inspector-section">
              <div className="section-header">─── Metadata ───</div>
              <div className="metadata-grid">
                <div className="metadata-item">
                  <span className="metadata-label">File Type</span>
                  <span className="metadata-value">{getFileType(track.audioPath) || '—'}</span>
                </div>
                <div className="metadata-item">
                  <span className="metadata-label">Duration</span>
                  <span className="metadata-value">{track.duration ? formatDuration(track.duration) : '—'}</span>
                </div>
                <div className="metadata-item">
                  <span className="metadata-label">Time Listened</span>
                  <span className="metadata-value">{formatDuration(trackStats.total_seconds)}</span>
                </div>
                <div className="metadata-item">
                  <span className="metadata-label">Listens</span>
                  <span className="metadata-value">
                    {track.duration > 0
                      ? (trackStats.total_seconds / track.duration).toFixed(1)
                      : trackStats.listen_count}
                  </span>
                </div>
              </div>
            </div>

            {/* Facets Section */}
            <div className="inspector-section">
              <div className="section-header">─── Facets ───</div>
              <div className="facets-list">
                {trackFacets.length > 0 ? (
                  trackFacets.map(facet => {
                    const color = getFacetColor(facet);
                    return (
                      <div
                        key={facet}
                        className={`facet-pill ${color ? 'has-color' : ''}`}
                        onClick={(e) => handleFacetPillClick(facet, e)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onFacetContextMenu) {
                            onFacetContextMenu(e, { name: facet });
                          }
                        }}
                      >
                        {color && <span className="facet-pill-color" style={{ background: color }} />}
                        {facet}
                        <span
                          className="facet-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFacet(facet);
                          }}
                        >
                          ×
                        </span>
                      </div>
                    );
                  })
                ) : null}
                <button
                  className="add-facet-btn"
                  onClick={() => setShowFacetPicker(true)}
                >
                  + Add Facet
                </button>
              </div>
            </div>

            {/* FacetPicker Modal */}
            {showFacetPicker && (
              <FacetPicker
                onSelect={handleAddFacet}
                onClose={() => setShowFacetPicker(false)}
                existingFacets={trackFacets}
              />
            )}

            {/* Cassettes Section */}
            <div className="inspector-section">
              <div className="section-header">─── Cassettes ───</div>
              {trackMixtapes.length > 0 && (
                <div className="inspector-mixtapes-list">
                  {trackMixtapes.map(mixtape => (
                    <div
                      key={mixtape.id}
                      className="inspector-mixtape-pill"
                      onClick={() => onMixtapeSelect?.(mixtape)}
                      title={`${mixtape.name} (${mixtape.trackCount} tracks)`}
                    >
                      <img
                        src={getMixtapeCoverImage(mixtape)}
                        alt={mixtape.name}
                        className="inspector-mixtape-cover"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <button
                className="add-playlist-btn"
                onClick={() => setShowAddToMixtape(true)}
              >
                + Cassette
              </button>
            </div>

            {/* Add to Mixtape Modal */}
            <AddToMixtapeModal
              isOpen={showAddToMixtape}
              onClose={() => setShowAddToMixtape(false)}
              trackIds={track?.id ? [track.id] : []}
              onSuccess={() => {
                // Refresh the mixtapes list
                setMixtapesRefreshKey(k => k + 1);
              }}
            />

            {/* Attachments Section */}
            <div className="inspector-section">
              <div className="section-header">─── Attached ───</div>
              <EphemeraBox
                entityType="track"
                entityId={track.id}
                attachments={trackAttachments}
                onAttachmentsChange={() => loadTrackAttachments(track.id)}
                variant="compact"
                showHeader={false}
                showSizeSlider={false}
                onContextMenu={(e, attachment) => {
                  if (onAttachmentContextMenu) {
                    onAttachmentContextMenu(e, attachment, {
                      entityType: 'track',
                      entityId: track.id,
                      onUpdate: () => loadTrackAttachments(track.id)
                    });
                  }
                }}
              />
            </div>
          </>
        ) : (
          <div className="inspector-empty" />
        )}
      </div>
    </div>
  );
}

// Smart scrolling text component - simplified
function SmartScrollText({ text, className }) {
  const textRef = useRef(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const element = textRef.current;
        setShouldScroll(element.scrollWidth > element.clientWidth);
      }
    };
    
    // Check immediately and after a short delay for font loading
    checkOverflow();
    const timer = setTimeout(checkOverflow, 100);
    
    return () => clearTimeout(timer);
  }, [text]);

  // For long album names, always scroll (King Gizzard test)
  const forceScroll = text && text.length > 60;

  return (
    <div className={`${className} ${(shouldScroll || forceScroll) ? 'scrolling' : ''}`}>
      <span ref={textRef} className={`scroll-text`} data-text={text}>
        {text}
      </span>
    </div>
  );
}

export default InspectorSidebar;
