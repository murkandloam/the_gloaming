import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/MixtapeSleeveView.css';
import FacetPicker from '../components/FacetPicker';
import MixtapeManifest from '../components/MixtapeManifest';
import EphemeraBox from '../components/EphemeraBox';
import { getCassetteImage, CASSETTE_COUNT } from '../assets/cassettes';
import panopticonEye from '../assets/panopticon/eyecentre.png';

const { ipcRenderer } = window.require ? window.require('electron') : {};

function MixtapeSleeveView({
  mixtape: initialMixtape,
  onBack,
  onTrackSelect,
  onPlayTrack,
  onPlayMixtape,
  onQueueMixtape,
  onRoamMixtape,
  onMixtapeUpdate,
  onMixtapeDelete,
  onFacetClick,
  onAttachmentContextMenu,
  onViewInPanopticon,
  refreshKey = 0
}) {
  const [mixtape, setMixtape] = useState(initialMixtape);
  const [tracks, setTracks] = useState(initialMixtape?.tracks || []);
  const [sortMode, setSortMode] = useState('#'); // '#' = custom order, 'title', 'artist', 'album'
  const [hasUnsavedOrder, setHasUnsavedOrder] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [sharedFacets, setSharedFacets] = useState([]); // Facets shared by ALL tracks
  const [mixtapeFacets, setMixtapeFacets] = useState([]); // Manually added mixtape facets
  const [facetsConfig, setFacetsConfig] = useState({ groups: [], starred: [], recent: [] });
  const [showFacetPicker, setShowFacetPicker] = useState(false);
  const [attachments, setAttachments] = useState([]); // Mixtape attachments (era box)
  const [coverDragOver, setCoverDragOver] = useState(false); // For cover drag/drop

  // Reload mixtape when it changes or refreshKey changes
  useEffect(() => {
    if (initialMixtape?.id) {
      loadMixtape(initialMixtape.id);
    }
  }, [initialMixtape?.id, refreshKey]);

  const loadAttachments = useCallback(async (mixtapeId) => {
    try {
      const result = await ipcRenderer.invoke('get-mixtape-attachments', mixtapeId);
      setAttachments(result || []);
    } catch (err) {
      console.error('Error loading mixtape attachments:', err);
      setAttachments([]);
    }
  }, []);

  async function loadMixtape(mixtapeId) {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('get-mixtape', mixtapeId);
      if (result) {
        setMixtape(result);
        setTracks(result.tracks || []);
        setSortMode('#');
        setHasUnsavedOrder(false);
        // Load facets and attachments after tracks are loaded
        loadMixtapeFacets(mixtapeId);
        loadSharedFacets(result.tracks || []);
        loadAttachments(mixtapeId);
        loadFacetsConfig();
      }
    } catch (err) {
      console.error('Error loading mixtape:', err);
    }
  }

  async function loadFacetsConfig() {
    try {
      const config = await ipcRenderer.invoke('get-facets');
      setFacetsConfig(config || { groups: [], starred: [], recent: [] });
    } catch (err) {
      console.error('Error loading facets config:', err);
    }
  }

  function getFacetColor(facetName) {
    for (const group of facetsConfig.groups || []) {
      if ((group.facets || []).includes(facetName)) {
        return group.color || '#d4843a';
      }
    }
    return null;
  }

  async function loadMixtapeFacets(mixtapeId) {
    try {
      const facets = await ipcRenderer.invoke('get-mixtape-facets', mixtapeId);
      setMixtapeFacets(facets || []);
    } catch (err) {
      console.error('Error loading mixtape facets:', err);
      setMixtapeFacets([]);
    }
  }

  async function loadSharedFacets(trackList) {
    // Find facets that ALL tracks in the mixtape share
    if (!trackList || trackList.length === 0) {
      setSharedFacets([]);
      return;
    }

    try {
      const trackFacetsPromises = trackList.map(async (track) => {
        const facets = await ipcRenderer.invoke('get-track-facets', track.id);
        return facets || [];
      });

      const allTrackFacets = await Promise.all(trackFacetsPromises);

      if (allTrackFacets.length === 0) {
        setSharedFacets([]);
        return;
      }

      const firstTrackFacets = new Set(allTrackFacets[0]);
      const shared = [...firstTrackFacets].filter(facet =>
        allTrackFacets.every(trackFacets => trackFacets.includes(facet))
      );

      setSharedFacets(shared);
    } catch (err) {
      console.error('Error loading shared facets:', err);
      setSharedFacets([]);
    }
  }

  async function handleAddMixtapeFacet(facetName) {
    if (!mixtape?.id) return;

    try {
      // Add facet to the mixtape itself
      await ipcRenderer.invoke('add-facet-to-mixtape', {
        mixtapeId: mixtape.id,
        facetName
      });

      // Also add the facet to all tracks in the mixtape
      for (const track of tracks) {
        await ipcRenderer.invoke('add-facet-to-track', {
          trackId: track.id,
          facetName
        });
      }

      loadMixtapeFacets(mixtape.id);
      loadSharedFacets(tracks); // Refresh shared facets since they've changed
    } catch (err) {
      console.error('Error adding mixtape facet:', err);
    }
  }

  async function handleRemoveMixtapeFacet(facetName) {
    if (!mixtape?.id) return;

    try {
      await ipcRenderer.invoke('remove-facet-from-mixtape', {
        mixtapeId: mixtape.id,
        facetName
      });
      loadMixtapeFacets(mixtape.id);
    } catch (err) {
      console.error('Error removing mixtape facet:', err);
    }
  }

  // Sort tracks based on current sort mode
  function getSortedTracks() {
    if (sortMode === '#') {
      return [...tracks].sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    return [...tracks].sort((a, b) => {
      let aVal, bVal;
      switch (sortMode) {
        case 'title':
          aVal = a.title || '';
          bVal = b.title || '';
          break;
        case 'artist':
          aVal = a.artist || '';
          bVal = b.artist || '';
          break;
        case 'album':
          aVal = a.album || '';
          bVal = b.album || '';
          break;
        default:
          return 0;
      }
      return aVal.localeCompare(bVal);
    });
  }

  // Handle drag start
  function handleDragStart(e, index) {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  }

  // Handle drag over
  function handleDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Determine if we're in the top or bottom half of the item
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const dropIndex = e.clientY < midpoint ? index : index + 1;
    if (dropIndex !== dragOverIndex) {
      setDragOverIndex(dropIndex);
    }
  }

  // Handle drag end
  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  // Handle drop - reorder tracks
  function handleDrop(e) {
    e.preventDefault();
    const startIndex = draggedIndex;

    if (startIndex === null || dragOverIndex === null) {
      handleDragEnd();
      return;
    }

    // Calculate actual insert position
    let insertIndex = dragOverIndex;
    // If dragging down, account for removal shifting indices
    if (startIndex < insertIndex) {
      insertIndex -= 1;
    }

    if (startIndex === insertIndex) {
      handleDragEnd();
      return;
    }

    const sortedTracks = getSortedTracks();
    const newTracks = [...sortedTracks];
    const [removed] = newTracks.splice(startIndex, 1);
    newTracks.splice(insertIndex, 0, removed);

    // Update positions
    const reorderedTracks = newTracks.map((track, index) => ({
      ...track,
      position: index + 1
    }));

    setTracks(reorderedTracks);
    setSortMode('#');
    setHasUnsavedOrder(true);
    handleDragEnd();
  }

  // Save the current order
  async function handleSaveOrder() {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      const trackIds = getSortedTracks().map(t => t.id);
      await ipcRenderer.invoke('reorder-mixtape-tracks', {
        mixtapeId: mixtape.id,
        trackIds
      });
      setHasUnsavedOrder(false);
      // Reload to get fresh data
      loadMixtape(mixtape.id);
    } catch (err) {
      console.error('Error saving track order:', err);
    }
  }

  // Remove track from mixtape
  async function handleRemoveTrack(trackId) {
    if (!ipcRenderer || !mixtape?.id) return;

    try {
      await ipcRenderer.invoke('remove-track-from-mixtape', {
        mixtapeId: mixtape.id,
        trackId
      });
      loadMixtape(mixtape.id);
    } catch (err) {
      console.error('Error removing track:', err);
    }
  }

  // Play all tracks in mixtape
  function handlePlayMixtape() {
    const sortedTracks = getSortedTracks();
    if (sortedTracks.length > 0 && onPlayMixtape) {
      onPlayMixtape(mixtape, sortedTracks);
    }
  }

  // Queue all tracks
  function handleQueueMixtape() {
    const sortedTracks = getSortedTracks();
    if (sortedTracks.length > 0 && onQueueMixtape) {
      onQueueMixtape(mixtape, sortedTracks);
    }
  }

  // Play mixtape in shuffled (roaming) mode
  async function handleRoamMixtape() {
    if (!ipcRenderer || !mixtape?.id || tracks.length === 0) return;

    try {
      const result = await ipcRenderer.invoke('get-roaming-mixtape', {
        mixtapeId: mixtape.id
      });

      if (result.success && onRoamMixtape) {
        onRoamMixtape(mixtape, result.mixtape.tracks, result.seed);
      }
    } catch (err) {
      console.error('Error starting roaming mode:', err);
    }
  }

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate total duration
  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const totalMins = Math.floor(totalDuration / 60);
  const totalHours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;
  const durationDisplay = totalHours > 0
    ? `${totalHours}h ${remainingMins}m`
    : `${totalMins}m`;

  const sortedTracks = getSortedTracks();

  // Cover drag/drop handlers
  const handleCoverDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if there's an image file or ephemera attachment being dragged
    const hasImage = Array.from(e.dataTransfer.items || []).some(
      item => item.kind === 'file' && item.type.startsWith('image/')
    );
    const hasEphemera = e.dataTransfer.types.includes('application/x-panopticon-item');
    if (hasImage || hasEphemera) {
      setCoverDragOver(true);
    }
  };

  const handleCoverDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCoverDragOver(false);
  };

  const handleCoverDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCoverDragOver(false);

    if (!mixtape?.id || !ipcRenderer) return;

    // Check for Panopticon ephemera attachment drop first
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only accept image attachments as covers
        if (item.entityType === 'attachment' && item.isImage) {
          const result = await ipcRenderer.invoke('panopticon:set-mixtape-cover-from-attachment', {
            mixtapeId: mixtape.id,
            attachmentId: item.id
          });
          if (result.success) {
            loadMixtape(mixtape.id);
            onMixtapeUpdate?.();
          }
        }
      } catch (err) {
        console.error('Failed to set cover from ephemera:', err);
      }
      return;
    }

    // Handle external file drop
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith('image/'));

    if (imageFile) {
      try {
        const result = await ipcRenderer.invoke('panopticon:set-mixtape-cover', {
          mixtapeId: mixtape.id,
          imagePath: imageFile.path
        });
        if (result.success) {
          loadMixtape(mixtape.id);
          onMixtapeUpdate?.();
        }
      } catch (err) {
        console.error('Failed to set cover from dropped file:', err);
      }
    }
  };

  // Determine if we should show a backdrop image
  const useBackgroundImage = mixtape?.useBackgroundImage !== false; // Default true
  const backdropBlur = mixtape?.backdropBlur ?? 40;

  // Get cassette image for this mixtape
  const cassetteIndex = mixtape?.cassetteIndex ?? 0;
  const cassetteImage = getCassetteImage(cassetteIndex);

  // Determine cover source: custom cover attachment > cassette image
  const customCoverPath = mixtape?.coverImageId
    ? attachments.find(a => a.id === mixtape.coverImageId)?.path
    : null;
  const coverImage = customCoverPath ? `local://${customCoverPath}` : cassetteImage;

  // Determine backdrop source: custom backdrop attachment > cover image
  const customBackdropPath = mixtape?.backdropImageId
    ? attachments.find(a => a.id === mixtape.backdropImageId)?.path
    : null;
  const backdropImage = customBackdropPath ? `local://${customBackdropPath}` : coverImage;

  // Use custom image path or cassette bundled image
  const hasBackdrop = useBackgroundImage && backdropImage;

  return (
    <div className={`mixtape-sleeve-view ${hasBackdrop ? 'has-backdrop' : ''}`}>
      {/* Backdrop image */}
      {hasBackdrop && (
        <>
          <img
            src={backdropImage}
            alt=""
            className="mixtape-sleeve-backdrop"
            style={{ filter: `blur(${backdropBlur}px) brightness(0.35) saturate(1.3)` }}
          />
          <div className="mixtape-sleeve-backdrop-overlay" />
        </>
      )}

      {/* Back button */}
      <button className="sleeve-back-btn" onClick={onBack}>
        ‹
      </button>

      <div className="mixtape-sleeve-content">
        {/* Top row: Cassette cover + Ephemera box */}
        <div className="sleeve-top-row">
          {/* Main cassette cover - drag image to set custom cover */}
          <div
            className={`sleeve-main-cover ${coverDragOver ? 'drag-over' : ''}`}
            onDragOver={handleCoverDragOver}
            onDragEnter={handleCoverDragOver}
            onDragLeave={handleCoverDragLeave}
            onDrop={handleCoverDrop}
          >
            <img
              src={coverImage}
              alt={mixtape?.name}
              className="mixtape-sleeve-cover-image"
            />
            {coverDragOver && (
              <div className="sleeve-cover-drop-hint">
                <span>Drop to set cover</span>
              </div>
            )}
          </div>

          {/* Ephemera box */}
          <EphemeraBox
            entityType="mixtape"
            entityId={mixtape.id}
            attachments={attachments}
            onAttachmentsChange={() => loadAttachments(mixtape.id)}
            variant="full"
            showHeader={true}
            showSizeSlider={true}
            className="sleeve-ephemera-box glass-panel"
            onContextMenu={(e, attachment) => {
              if (onAttachmentContextMenu) {
                onAttachmentContextMenu(e, attachment, {
                  entityType: 'mixtape',
                  entityId: mixtape.id,
                  onUpdate: () => loadAttachments(mixtape.id)
                });
              }
            }}
          />
        </div>

        {/* Action buttons */}
        <div className="sleeve-actions">
          <button
            className="sleeve-action-btn primary"
            onClick={handlePlayMixtape}
            disabled={tracks.length === 0}
          >
            ▶ Play Mixtape
          </button>
          <button
            className="sleeve-action-btn roam"
            onClick={handleRoamMixtape}
            disabled={tracks.length === 0}
            title="Play in shuffled order"
          >
            ↻ Roam
          </button>
          <button
            className="sleeve-action-btn"
            onClick={handleQueueMixtape}
            disabled={tracks.length === 0}
          >
            + Queue All
          </button>
          <button
            className="sleeve-action-btn"
            onClick={() => setShowManifest(true)}
          >
            Manifest
          </button>
          <button
            className="sleeve-action-btn view-in-panopticon"
            onClick={() => onViewInPanopticon && onViewInPanopticon(mixtape)}
            title="View in Panopticon"
          >
            <img src={panopticonEye} alt="Panopticon" className="panopticon-eye-icon" />
          </button>
        </div>

        {/* Combined Mixtape Info + Track List Box */}
        <div className="mixtape-combined-box glass-panel">
          {/* Header with title and meta */}
          <div className="mixtape-combined-header">
            <h1 className="mixtape-combined-title">{mixtape?.name}</h1>
            <div className="mixtape-combined-meta">
              <span>{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
              <span>{durationDisplay}</span>
            </div>
            {mixtape?.description && (
              <p className="mixtape-combined-description">{mixtape.description}</p>
            )}
          </div>

          {/* Facets row */}
          <div className="mixtape-combined-facets">
            {sharedFacets.map(facet => {
              const color = getFacetColor(facet);
              return (
                <div
                  key={`shared-${facet}`}
                  className={`album-facet-pill shared-facet ${color ? 'has-color' : ''}`}
                  title="All tracks share this facet"
                  onClick={() => onFacetClick?.(facet)}
                >
                  {color && <span className="facet-pill-color" style={{ background: color }} />}
                  {facet}
                </div>
              );
            })}
            {mixtapeFacets.filter(f => !sharedFacets.includes(f)).map(facet => {
              const color = getFacetColor(facet);
              return (
                <div
                  key={facet}
                  className={`album-facet-pill ${color ? 'has-color' : ''}`}
                  onClick={() => onFacetClick?.(facet)}
                >
                  {color && <span className="facet-pill-color" style={{ background: color }} />}
                  {facet}
                  <span
                    className="facet-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveMixtapeFacet(facet);
                    }}
                  >
                    ×
                  </span>
                </div>
              );
            })}
            <button
              className="add-album-facet-btn"
              onClick={() => setShowFacetPicker(true)}
            >
              + Add Facet
            </button>
          </div>

          {/* Sort controls */}
          <div className="mixtape-sort-bar">
            <div className="sort-pills">
              <button
                className={`sort-pill ${sortMode === '#' ? 'active' : ''}`}
                onClick={() => setSortMode('#')}
              >
                #
              </button>
              <button
                className={`sort-pill ${sortMode === 'title' ? 'active' : ''}`}
                onClick={() => setSortMode('title')}
              >
                Title
              </button>
              <button
                className={`sort-pill ${sortMode === 'artist' ? 'active' : ''}`}
                onClick={() => setSortMode('artist')}
              >
                Artist
              </button>
              <button
                className={`sort-pill ${sortMode === 'album' ? 'active' : ''}`}
                onClick={() => setSortMode('album')}
              >
                Album
              </button>
            </div>
            {hasUnsavedOrder && (
              <button
                className="save-order-btn"
                onClick={handleSaveOrder}
              >
                Save Order
              </button>
            )}
          </div>

          {/* Track list */}
          {tracks.length === 0 ? (
            <div className="mixtape-empty-tracks">
              <span>No tracks yet</span>
              <span className="mixtape-empty-hint">Add tracks from albums using the +Cassette button</span>
            </div>
          ) : (
            <div className="mixtape-tracklist">
              {sortedTracks.map((track, index) => (
                <React.Fragment key={`${track.id}-${index}`}>
                  {/* Drop indicator line before this item */}
                  {sortMode === '#' && dragOverIndex === index && draggedIndex !== index && draggedIndex !== index - 1 && (
                    <div className="mixtape-drop-indicator" />
                  )}
                  <div
                    className={`mixtape-track-row ${draggedIndex === index ? 'dragging' : ''}`}
                    draggable={sortMode === '#'}
                    onDragStart={(e) => sortMode === '#' && handleDragStart(e, index)}
                    onDragOver={(e) => sortMode === '#' && handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={handleDrop}
                    onClick={() => onTrackSelect && onTrackSelect({
                      ...track,
                      albumId: track.albumId
                    })}
                  >
                    {sortMode === '#' && (
                      <span className="track-drag-handle" title="Drag to reorder">⋮⋮</span>
                    )}
                    <span className="track-number">{index + 1}</span>
                    <div className="track-main">
                      <span className="track-title">{track.title}</span>
                      <span className="track-artist-album">
                        {track.artist} — {track.album}
                      </span>
                    </div>
                    <span className="track-duration">{formatDuration(track.duration)}</span>
                    <button
                      className="track-play-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayTrack && onPlayTrack(track, sortedTracks.slice(index + 1));
                      }}
                      title="Play"
                    >
                      ▶
                    </button>
                    <button
                      className="track-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTrack(track.id);
                      }}
                      title="Remove from cassette"
                    >
                      ×
                    </button>
                  </div>
                </React.Fragment>
              ))}
              {/* Drop indicator at end of list */}
              {sortMode === '#' && sortedTracks.length > 0 && dragOverIndex === sortedTracks.length && draggedIndex !== sortedTracks.length - 1 && (
                <div className="mixtape-drop-indicator" />
              )}
            </div>
          )}
        </div>

        {/* FacetPicker Modal */}
        {showFacetPicker && (
          <FacetPicker
            onSelect={handleAddMixtapeFacet}
            onClose={() => setShowFacetPicker(false)}
            existingFacets={[...sharedFacets, ...mixtapeFacets]}
          />
        )}
      </div>

      {/* Manifest Modal */}
      {showManifest && (
        <MixtapeManifest
          isOpen={showManifest}
          mixtape={mixtape}
          onClose={() => setShowManifest(false)}
          onSave={(updated) => {
            setMixtape(updated);
            onMixtapeUpdate?.(updated);
            // Reload attachments so cover changes take effect immediately
            loadAttachments(updated.id);
          }}
          onDelete={() => {
            onMixtapeDelete?.(mixtape.id);
            onBack?.();
          }}
        />
      )}
    </div>
  );
}

export default MixtapeSleeveView;
