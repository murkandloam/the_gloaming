import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import '../styles/RecordSleeveView.css';
import FacetPicker from '../components/FacetPicker';
import AddToMixtapeModal from '../components/AddToMixtapeModal';
import EphemeraBox from '../components/EphemeraBox';
import panopticonEye from '../assets/panopticon/eyecentre.png';

const { ipcRenderer } = window.require ? window.require('electron') : {};

function RecordSleeveView({
  album,
  childAlbums = [],
  coverCacheBust = 0,
  onBack,
  onTrackSelect,
  onPlayTrack,
  onQueueTrack,
  onPlayAlbum,
  onQueueAlbum,
  onRoamAlbum,
  onToggleLP,
  onAlbumUpdate,
  onAlbumDelete,
  onOpenChildSleeve,
  onViewInPanopticon,
  onTrackContextMenu,
  onRecordContextMenu,
  onAttachmentContextMenu,
  onFacetContextMenu,
  onFacetClick,
  onFacetsChange,
  refreshKey = 0,
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showFacetPicker, setShowFacetPicker] = useState(false);
  const [albumFacets, setAlbumFacets] = useState([]);
  const [sharedTrackFacets, setSharedTrackFacets] = useState([]); // Facets shared by ALL tracks
  const [facetsConfig, setFacetsConfig] = useState({ groups: [], starred: [], recent: [] });
  const [defaultBlur, setDefaultBlur] = useState(0);
  const [addToMixtapeAlbum, setAddToMixtapeAlbum] = useState(null); // Album being added to mixtape
  const [attachments, setAttachments] = useState([]); // Album attachments (era box)
  const [coverDragOver, setCoverDragOver] = useState(false); // For cover drag/drop

  // Load album facets, attachments, and library config
  useEffect(() => {
    if (album?.id && ipcRenderer) {
      loadAlbumFacets();
      loadSharedTrackFacets();
      loadLibraryConfig();
      loadAttachments();
      loadFacetsConfig();
    }
  }, [album?.id, refreshKey]);

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
    return null;
  }

  const loadAttachments = useCallback(async () => {
    if (!album?.id) return;
    try {
      const result = await ipcRenderer.invoke('get-album-attachments', album.id);
      setAttachments(result || []);
    } catch (err) {
      console.error('Error loading album attachments:', err);
      setAttachments([]);
    }
  }, [album?.id]);

  async function loadLibraryConfig() {
    try {
      const config = await ipcRenderer.invoke('get-library-config');
      setDefaultBlur(config?.settings?.defaultBackdropBlur ?? 0);
    } catch (err) {
      console.error('Error loading library config:', err);
    }
  }

  async function loadAlbumFacets() {
    try {
      // Album facets are stored on the album itself, not in the facet index
      // For now, we'll use a simple approach - albums can have facets too
      const result = await ipcRenderer.invoke('get-album-facets', album.id);
      setAlbumFacets(result || []);
    } catch (err) {
      console.error('Error loading album facets:', err);
      setAlbumFacets(album.facets || []);
    }
  }

  async function loadSharedTrackFacets() {
    // Find facets that ALL tracks in this album share
    if (!album?.tracks || album.tracks.length === 0) {
      setSharedTrackFacets([]);
      return;
    }

    try {
      // Get facets for all tracks using their actual UUIDs
      const trackFacetsPromises = album.tracks.map(async (track) => {
        const facets = await ipcRenderer.invoke('get-track-facets', track.id);
        return facets || [];
      });

      const allTrackFacets = await Promise.all(trackFacetsPromises);

      // Find intersection - facets that exist in ALL tracks
      if (allTrackFacets.length === 0) {
        setSharedTrackFacets([]);
        return;
      }

      // Start with first track's facets and filter to only those in all others
      const firstTrackFacets = new Set(allTrackFacets[0]);
      const shared = [...firstTrackFacets].filter(facet =>
        allTrackFacets.every(trackFacets => trackFacets.includes(facet))
      );

      setSharedTrackFacets(shared);
    } catch (err) {
      console.error('Error loading shared track facets:', err);
      setSharedTrackFacets([]);
    }
  }

  async function handleAddAlbumFacet(facetName) {
    try {
      await ipcRenderer.invoke('add-facet-to-album', { albumId: album.id, facetName });
      loadAlbumFacets();
      onFacetsChange?.();
    } catch (err) {
      console.error('Error adding album facet:', err);
    }
  }

  async function handleRemoveAlbumFacet(facetName) {
    try {
      await ipcRenderer.invoke('remove-facet-from-album', { albumId: album.id, facetName });
      loadAlbumFacets();
      onFacetsChange?.();
    } catch (err) {
      console.error('Error removing album facet:', err);
    }
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTrackClick = (track, albumData) => {
    if (onTrackSelect) {
      onTrackSelect({
        ...track,
        album: albumData.title,
        albumArt: track.trackThumbnailPath || track.trackCoverPath || albumData.coverPath,
        albumId: albumData.id
      });
    }
  };

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

    if (!album?.id || !ipcRenderer) return;

    // Check for Panopticon ephemera attachment drop first
    const panopticonData = e.dataTransfer.getData('application/x-panopticon-item');
    if (panopticonData) {
      try {
        const item = JSON.parse(panopticonData);
        // Only accept image attachments as covers
        if (item.entityType === 'attachment' && item.isImage) {
          const result = await ipcRenderer.invoke('panopticon:set-record-cover-from-attachment', {
            recordId: album.id,
            attachmentId: item.id
          });
          if (result.success) {
            onAlbumUpdate?.();
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
        const result = await ipcRenderer.invoke('panopticon:set-record-cover', {
          recordId: album.id,
          imagePath: imageFile.path
        });
        if (result.success) {
          onAlbumUpdate?.();
        }
      } catch (err) {
        console.error('Failed to set cover from dropped file:', err);
      }
    }
  };

  // Get blur value - use album's setting if set, otherwise library default
  const backdropBlur = album.backdropBlur ?? defaultBlur;
  const useBackgroundImage = album.useBackgroundImage !== false;

  // Determine backdrop image path - use selected attachment or fall back to cover
  const backdropPath = album.backdropImageId
    ? attachments.find(a => a.id === album.backdropImageId)?.path
    : album.coverPath;

  return (
    <div className="sleeve-view">
      {/* Static blurred background - using img element */}
      {useBackgroundImage && backdropPath && (
        <img
          src={`local://${backdropPath}?v=${coverCacheBust}`}
          alt=""
          className="sleeve-backdrop"
          style={{ filter: `blur(${backdropBlur}px) brightness(0.35) saturate(1.3)` }}
        />
      )}
      <div className="sleeve-backdrop-overlay" />
      
      {/* Scrollable content */}
      <div className="sleeve-content">
        {/* Back button */}
        <button className="sleeve-back-btn" onClick={onBack}>
          ‹
        </button>

        {/* Top row: Album cover + Ephemera box */}
        <div className="sleeve-top-row">
          {/* Main album cover - click to view, drag image to set new cover */}
          <div
            className={`sleeve-main-cover ${coverDragOver ? 'drag-over' : ''}`}
            onClick={() => setLightboxOpen(true)}
            onDragOver={handleCoverDragOver}
            onDragEnter={handleCoverDragOver}
            onDragLeave={handleCoverDragLeave}
            onDrop={handleCoverDrop}
          >
            {album.coverPath ? (
              <img src={`local://${album.coverPath}?v=${coverCacheBust}`} alt={album.title} />
            ) : (
              <div className="sleeve-cover-placeholder">♪</div>
            )}
            {coverDragOver && (
              <div className="sleeve-cover-drop-hint">
                <span>Drop to set cover</span>
              </div>
            )}
          </div>

          {/* Ephemera box */}
          <EphemeraBox
            entityType="album"
            entityId={album.id}
            attachments={attachments}
            onAttachmentsChange={loadAttachments}
            variant="full"
            showHeader={true}
            showSizeSlider={true}
            className="sleeve-ephemera-box glass-panel"
            onContextMenu={(e, attachment) => {
              if (onAttachmentContextMenu) {
                onAttachmentContextMenu(e, attachment, {
                  entityType: 'album',
                  entityId: album.id,
                  onUpdate: loadAttachments
                });
              }
            }}
          />
        </div>

        {/* Action buttons */}
        <div className="sleeve-actions">
          <button
            className="sleeve-action-btn primary"
            onClick={() => onPlayAlbum && onPlayAlbum(album)}
          >
            ▶ Play Record
          </button>
          <button
            className="sleeve-action-btn roam"
            onClick={() => onRoamAlbum && onRoamAlbum(album)}
            title="Play in shuffled order"
          >
            ↻ Roam
          </button>
          <button
            className="sleeve-action-btn"
            onClick={() => onQueueAlbum && onQueueAlbum(album)}
          >
            + Queue All
          </button>
          <button
            className="sleeve-action-btn"
            onClick={() => setAddToMixtapeAlbum(album)}
          >
            + Mixtape
          </button>
          <button
            className="sleeve-action-btn view-in-panopticon"
            onClick={() => onViewInPanopticon && onViewInPanopticon(album)}
            title="View in Panopticon"
          >
            <img src={panopticonEye} alt="Panopticon" className="panopticon-eye-icon" />
          </button>
        </div>

        {/* Parent album tracklist */}
        <div className="sleeve-album-box glass-panel">
          <div className="album-box-header">
            <h1 className="album-box-title">{album.title}</h1>
            <div className="album-box-meta">
              <span className="album-meta-artist">{album.artist}</span>
              {album.releaseDate && (
                <span className="album-meta-date">{album.releaseDate}</span>
              )}
              {album.genre && (
                <span className="album-meta-genre">{album.genre}</span>
              )}
              {album.fileSize && (
                <span className="album-meta-size">{album.fileSize}</span>
              )}
            </div>
          </div>
          
          <div className="album-tracklist">
            <DiscGroupedTracklist
              tracks={album.tracks}
              album={album}
              onTrackClick={handleTrackClick}
              onPlayTrack={onPlayTrack}
              onTrackContextMenu={onTrackContextMenu}
              formatDuration={formatDuration}
            />
          </div>

          {/* Record Facets Section */}
          <div className="album-facets-section">
            <div className="album-facets-header">─── Record Facets ───</div>
            <div className="album-facets-list">
              {/* Album facets with remove button */}
              {albumFacets.map(facet => {
                const color = getFacetColor(facet);
                return (
                  <div
                    key={facet}
                    className={`album-facet-pill ${color ? 'has-color' : ''} ${onFacetClick ? 'clickable' : ''}`}
                    onClick={() => onFacetClick?.(facet)}
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
                        handleRemoveAlbumFacet(facet);
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
          </div>

          {/* FacetPicker Modal */}
          {showFacetPicker && (
            <FacetPicker
              onSelect={handleAddAlbumFacet}
              onClose={() => setShowFacetPicker(false)}
              existingFacets={[...albumFacets, ...sharedTrackFacets]}
            />
          )}
        </div>

        {/* Subordinate albums */}
        {childAlbums.length > 0 && (
          <div className="ephemera-section-header">
            ─── Subordinates ───
          </div>
        )}
        {childAlbums.map((child) => (
          <SubordinateBox
            key={child.id}
            child={child}
            coverCacheBust={coverCacheBust}
            onPlayAlbum={onPlayAlbum}
            onRoamAlbum={onRoamAlbum}
            onQueueAlbum={onQueueAlbum}
            onViewInPanopticon={onViewInPanopticon}
            setAddToMixtapeAlbum={setAddToMixtapeAlbum}
            handleTrackClick={handleTrackClick}
            onPlayTrack={onPlayTrack}
            onTrackContextMenu={onTrackContextMenu}
            onAttachmentContextMenu={onAttachmentContextMenu}
            onFacetContextMenu={onFacetContextMenu}
            onFacetClick={onFacetClick}
            onFacetsChange={onFacetsChange}
            formatDuration={formatDuration}
          />
        ))}
      </div>

      {/* Cover Lightbox - simple single-image view */}
      {lightboxOpen && (
        <div className="lightbox-overlay" onClick={() => setLightboxOpen(false)}>
          <button className="lightbox-close" onClick={() => setLightboxOpen(false)}>×</button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={`local://${album.coverPath}?v=${coverCacheBust}`}
              alt={album.title}
            />
            <div className="lightbox-caption">
              {album.title}
            </div>
          </div>
        </div>
      )}

      {/* Add to Mixtape Modal */}
      <AddToMixtapeModal
        isOpen={!!addToMixtapeAlbum}
        onClose={() => setAddToMixtapeAlbum(null)}
        albumId={addToMixtapeAlbum?.id}
        albumName={addToMixtapeAlbum?.title}
        onSuccess={() => {
          console.log('Album added to mixtape');
          setAddToMixtapeAlbum(null);
        }}
      />
    </div>
  );
}

// Component to group tracks by disc and display with headers
function DiscGroupedTracklist({ tracks, album, onTrackClick, onPlayTrack, onTrackContextMenu, formatDuration }) {
  if (!tracks || tracks.length === 0) return null;

  // Group tracks by disc number (derived from position: disc*1000 + trackNum)
  const discGroups = {};
  tracks.forEach(track => {
    // Disc can come from position (disc*1000 + trackNum) or explicit disc field
    const discNum = track.position ? Math.floor(track.position / 1000) || 1 : (track.disc || 1);
    if (!discGroups[discNum]) {
      discGroups[discNum] = [];
    }
    discGroups[discNum].push(track);
  });

  // Sort tracks within each disc by position (preserves Panopticon reorder)
  // Position encodes disc*1000 + trackNumber, so sorting by position works within a disc
  Object.values(discGroups).forEach(discTracks => {
    discTracks.sort((a, b) => (a.position || 0) - (b.position || 0));
  });

  const discNumbers = Object.keys(discGroups).map(Number).sort((a, b) => a - b);
  const hasMultipleDiscs = discNumbers.length > 1;

  return (
    <>
      {discNumbers.map(discNum => (
        <React.Fragment key={discNum}>
          {hasMultipleDiscs && (
            <div className="disc-header">
              <span className="disc-label">Disc {discNum}</span>
            </div>
          )}
          {discGroups[discNum].map((track, index) => (
            <TrackRow
              key={track.path || track.id || index}
              track={track}
              album={album}
              onTrackClick={onTrackClick}
              onPlayTrack={onPlayTrack}
              onTrackContextMenu={onTrackContextMenu}
              formatDuration={formatDuration}
            />
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

// Separate TrackRow component to handle hover state properly
function TrackRow({ track, album, onTrackClick, onPlayTrack, onTrackContextMenu, formatDuration }) {
  const [isHovered, setIsHovered] = useState(false);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [trackStats, setTrackStats] = useState({ total_seconds: 0, listen_count: 0 });
  const titleRef = React.useRef(null);

  React.useEffect(() => {
    if (titleRef.current) {
      setNeedsScroll(titleRef.current.scrollWidth > titleRef.current.clientWidth);
    }
  }, [track.title]);

  // Load track listening stats
  React.useEffect(() => {
    if (track?.id && ipcRenderer) {
      ipcRenderer.invoke('get-track-listening-stats', track.id)
        .then(stats => setTrackStats(stats || { total_seconds: 0, listen_count: 0 }))
        .catch(() => setTrackStats({ total_seconds: 0, listen_count: 0 }));
    }
  }, [track?.id]);

  // Calculate plays (same formula as Ledgers)
  const getPlays = () => {
    if (track.duration > 0 && trackStats.total_seconds > 0) {
      return (trackStats.total_seconds / track.duration).toFixed(1);
    }
    return '—';
  };

  // Build track object with album metadata for context menu
  const trackWithAlbum = {
    ...track,
    artist: track.trackArtist || album.artist,
    album: album.title,
    albumArt: track.trackThumbnailPath || track.trackCoverPath || album.thumbnailPath || album.coverPath,
    albumId: album.id,
    audioPath: track.audioPath || track.path
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onTrackContextMenu) {
      onTrackContextMenu(e, trackWithAlbum, 'sleeve');
    }
  };

  return (
    <div
      className="track-row"
      onClick={() => onTrackClick(track, album)}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="track-number">{track.trackNumber || '—'}</span>
      <span className="track-title">
        <span
          ref={titleRef}
          className={`track-title-text ${isHovered && needsScroll ? 'scrolling' : ''}`}
        >
          {track.title}
        </span>
      </span>
      <span className="track-artist">{track.trackArtist || album.artist}</span>
      <span className="track-listened">{trackStats.total_seconds > 0 ? formatDuration(trackStats.total_seconds) : '—'}</span>
      <span className="track-plays">{getPlays()}</span>
      <span className="track-duration">{formatDuration(track.duration)}</span>
      <button
        className="track-play-btn"
        onClick={(e) => {
          e.stopPropagation();
          onPlayTrack && onPlayTrack({
            ...track,
            artist: track.trackArtist || album.artist,
            album: album.title,
            albumArt: track.trackThumbnailPath || track.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: track.audioPath || track.path
          });
        }}
      >
        ▶
      </button>
    </div>
  );
}

// Subordinate album box with full playback controls and ephemera
function SubordinateBox({
  child,
  coverCacheBust,
  onPlayAlbum,
  onRoamAlbum,
  onQueueAlbum,
  onViewInPanopticon,
  setAddToMixtapeAlbum,
  handleTrackClick,
  onPlayTrack,
  onTrackContextMenu,
  onAttachmentContextMenu,
  onFacetContextMenu,
  onFacetClick,
  onFacetsChange,
  formatDuration
}) {
  const [attachments, setAttachments] = useState([]);
  const [showFacetPicker, setShowFacetPicker] = useState(false);
  const [albumFacets, setAlbumFacets] = useState([]);
  const [sharedTrackFacets, setSharedTrackFacets] = useState([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [facetsConfig, setFacetsConfig] = useState({ groups: [] });

  // Load facets config for color lookup
  const loadFacetsConfig = useCallback(async () => {
    if (!ipcRenderer) return;
    try {
      const config = await ipcRenderer.invoke('get-facets');
      setFacetsConfig(config || { groups: [] });
    } catch (err) {
      console.error('Error loading facets config:', err);
    }
  }, []);

  // Get color for a facet based on its group
  const getFacetColor = useCallback((facetName) => {
    if (!facetsConfig.groups) return null;
    for (const group of facetsConfig.groups) {
      if (group.facets && group.facets.includes(facetName)) {
        return group.color;
      }
    }
    return null;
  }, [facetsConfig]);

  // Load attachments and facets for this subordinate
  useEffect(() => {
    if (child?.id && ipcRenderer) {
      loadAttachments();
      loadFacets();
      loadFacetsConfig();
    }
  }, [child?.id]);

  const loadAttachments = useCallback(async () => {
    if (!child?.id) return;
    try {
      const result = await ipcRenderer.invoke('get-album-attachments', child.id);
      setAttachments(result || []);
    } catch (err) {
      console.error('Error loading subordinate attachments:', err);
      setAttachments([]);
    }
  }, [child?.id]);

  async function loadFacets() {
    // Load album-level facets
    try {
      const facets = await ipcRenderer.invoke('get-album-facets', child.id);
      setAlbumFacets(facets || []);
    } catch (err) {
      setAlbumFacets(child.facets || []);
    }

    // Compute shared track facets
    if (!child?.tracks || child.tracks.length === 0) {
      setSharedTrackFacets([]);
      return;
    }

    try {
      const trackFacetsPromises = child.tracks.map(async (track) => {
        const facets = await ipcRenderer.invoke('get-track-facets', track.id);
        return facets || [];
      });

      const allTrackFacets = await Promise.all(trackFacetsPromises);

      if (allTrackFacets.length === 0) {
        setSharedTrackFacets([]);
        return;
      }

      const firstTrackFacets = new Set(allTrackFacets[0]);
      const shared = [...firstTrackFacets].filter(facet =>
        allTrackFacets.every(trackFacets => trackFacets.includes(facet))
      );

      setSharedTrackFacets(shared);
    } catch (err) {
      console.error('Error loading subordinate shared facets:', err);
      setSharedTrackFacets([]);
    }
  }

  async function handleAddFacet(facetName) {
    try {
      await ipcRenderer.invoke('add-facet-to-album', { albumId: child.id, facetName });
      loadFacets();
      onFacetsChange?.();
    } catch (err) {
      console.error('Error adding subordinate facet:', err);
    }
  }

  async function handleRemoveFacet(facetName) {
    try {
      await ipcRenderer.invoke('remove-facet-from-album', { albumId: child.id, facetName });
      loadFacets();
      onFacetsChange?.();
    } catch (err) {
      console.error('Error removing subordinate facet:', err);
    }
  }

  return (
    <div className="sleeve-child-box glass-panel">
      {/* Top row: Cover + Info + Ephemera */}
      <div className="child-box-top-row">
        <div
          className="child-cover"
          onClick={() => child.coverPath && setLightboxOpen(true)}
          style={{ cursor: child.coverPath ? 'pointer' : 'default' }}
        >
          {child.coverPath ? (
            <img src={`local://${child.coverPath}?v=${coverCacheBust}`} alt={child.title} />
          ) : (
            <div className="child-cover-placeholder">♪</div>
          )}
        </div>
        <div className="child-info">
          <h2 className="child-title">{child.title}</h2>
          <div className="child-meta">
            <span className="child-meta-artist">{child.artist}</span>
            {child.releaseDate && (
              <span className="child-meta-date">{child.releaseDate}</span>
            )}
          </div>
        </div>
        {/* Ephemera box for subordinate */}
        <EphemeraBox
          entityType="album"
          entityId={child.id}
          attachments={attachments}
          onAttachmentsChange={loadAttachments}
          variant="compact"
          showHeader={false}
          showSizeSlider={false}
          className="child-ephemera-box"
          onContextMenu={(e, attachment) => {
            if (onAttachmentContextMenu) {
              onAttachmentContextMenu(e, attachment, {
                entityType: 'album',
                entityId: child.id,
                onUpdate: loadAttachments
              });
            }
          }}
        />
      </div>

      {/* Action buttons - matching parent album style */}
      <div className="child-actions">
        <button
          className="child-action-btn primary"
          onClick={() => onPlayAlbum && onPlayAlbum(child)}
        >
          ▶ Play Record
        </button>
        <button
          className="child-action-btn roam"
          onClick={() => onRoamAlbum && onRoamAlbum(child)}
          title="Play in shuffled order"
        >
          ↻ Roam
        </button>
        <button
          className="child-action-btn"
          onClick={() => onQueueAlbum && onQueueAlbum(child)}
        >
          + Queue All
        </button>
        <button
          className="child-action-btn"
          onClick={() => setAddToMixtapeAlbum(child)}
        >
          + Mixtape
        </button>
        <button
          className="child-action-btn view-in-panopticon"
          onClick={() => onViewInPanopticon && onViewInPanopticon(child)}
          title="View in Panopticon"
        >
          <img src={panopticonEye} alt="Panopticon" className="panopticon-eye-icon" />
        </button>
      </div>

      {/* Tracklist */}
      <div className="album-tracklist">
        <DiscGroupedTracklist
          tracks={child.tracks}
          album={child}
          onTrackClick={handleTrackClick}
          onPlayTrack={onPlayTrack}
          onTrackContextMenu={onTrackContextMenu}
          formatDuration={formatDuration}
        />
      </div>

      {/* Record Facets Section */}
      <div className="album-facets-section">
        <div className="album-facets-header">─── Record Facets ───</div>
        <div className="album-facets-list">
          {/* Album facets with remove button */}
          {albumFacets.map(facet => {
            const color = getFacetColor(facet);
            return (
              <div
                key={facet}
                className={`album-facet-pill ${color ? 'has-color' : ''} ${onFacetClick ? 'clickable' : ''}`}
                onClick={() => onFacetClick?.(facet)}
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
          })}
          <button
            className="add-album-facet-btn"
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
          existingFacets={[...albumFacets, ...sharedTrackFacets]}
        />
      )}

      {/* Cover Lightbox - rendered via portal to escape container */}
      {lightboxOpen && child.coverPath && ReactDOM.createPortal(
        <div className="lightbox-overlay" onClick={() => setLightboxOpen(false)}>
          <button
            className="lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(false);
            }}
          >
            ✕
          </button>
          <img
            src={`local://${child.coverPath}?v=${coverCacheBust}`}
            alt={child.title}
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

// Component to display ephemera album facets (including shared track facets)
function EphemeraFacets({ album, onFacetContextMenu }) {
  const [sharedFacets, setSharedFacets] = useState([]);
  const [albumFacets, setAlbumFacets] = useState([]);
  const [facetsConfig, setFacetsConfig] = useState({ groups: [], starred: [], recent: [] });

  useEffect(() => {
    if (album?.id && ipcRenderer) {
      loadFacets();
      loadFacetsConfig();
    }
  }, [album?.id]);

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

  async function loadFacets() {
    // Load album-level facets
    try {
      const facets = await ipcRenderer.invoke('get-album-facets', album.id);
      setAlbumFacets(facets || []);
    } catch (err) {
      setAlbumFacets(album.facets || []);
    }

    // Compute shared track facets
    if (!album?.tracks || album.tracks.length === 0) {
      setSharedFacets([]);
      return;
    }

    try {
      // Get facets for all tracks using their actual UUIDs
      const trackFacetsPromises = album.tracks.map(async (track) => {
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
      console.error('Error loading ephemera shared facets:', err);
      setSharedFacets([]);
    }
  }

  const allFacets = [...sharedFacets, ...albumFacets.filter(f => !sharedFacets.includes(f))];

  if (allFacets.length === 0) return null;

  return (
    <div className="child-facets-row">
      {sharedFacets.map(facet => {
        const color = getFacetColor(facet);
        return (
          <span
            key={`shared-${facet}`}
            className={`child-facet-pill shared-facet ${color ? 'has-color' : ''}`}
            title="All tracks share this facet"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onFacetContextMenu) {
                onFacetContextMenu(e, { name: facet, count: album.tracks?.length || 0 });
              }
            }}
          >
            {color && <span className="facet-pill-color" style={{ background: color }} />}
            {facet}
          </span>
        );
      })}
      {albumFacets.filter(f => !sharedFacets.includes(f)).map(facet => {
        const color = getFacetColor(facet);
        return (
          <span
            key={facet}
            className={`child-facet-pill ${color ? 'has-color' : ''}`}
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
          </span>
        );
      })}
    </div>
  );
}

export default RecordSleeveView;
