/**
 * FacetCollectionView - Dense track list for a facet
 *
 * Inspired by Record Sleeve's gorgeous compact tracklist.
 * Groups tracks by album for visual organization.
 */

import React, { useState, useEffect, useRef } from 'react';
import './FacetCollectionView.css';

const { ipcRenderer } = window.require('electron');

function FacetCollectionView({
  facetName,
  refreshKey = 0,
  onBack,
  onPlayTrack,
  onRoamFacet,
  onSelectTrack,
  onPlayAlbum,
  onOpenAlbum,
  onTrackContextMenu
}) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('album'); // album, title, artist, dateAdded
  const [groupByAlbum, setGroupByAlbum] = useState(true);
  const [collapsedAlbums, setCollapsedAlbums] = useState(new Set());

  useEffect(() => {
    loadTracks();
  }, [facetName, refreshKey]);

  async function loadTracks() {
    setLoading(true);
    try {
      const trackList = await ipcRenderer.invoke('get-tracks-with-facet', facetName);
      setTracks(trackList);
    } catch (err) {
      console.error('Error loading tracks for facet:', err);
    }
    setLoading(false);
  }

  function getSortedTracks() {
    const sorted = [...tracks];

    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'artist':
        sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
        break;
      case 'album':
        sorted.sort((a, b) => {
          const albumCompare = (a.album || '').localeCompare(b.album || '');
          if (albumCompare !== 0) return albumCompare;
          return (a.trackNumber || 0) - (b.trackNumber || 0);
        });
        break;
      case 'dateAdded':
      default:
        sorted.sort((a, b) => {
          const dateA = new Date(a.importedAt || 0);
          const dateB = new Date(b.importedAt || 0);
          return dateB - dateA;
        });
        break;
    }

    return sorted;
  }

  // Group tracks by album
  function getAlbumGroups() {
    const sorted = getSortedTracks();
    const groups = {};

    sorted.forEach(track => {
      const albumKey = track.albumId || track.album || 'Unknown Album';
      if (!groups[albumKey]) {
        groups[albumKey] = {
          albumId: track.albumId,
          albumName: track.album || 'Unknown Album',
          artist: track.artist || 'Unknown Artist',
          albumArt: track.albumArt,
          tracks: []
        };
      }
      groups[albumKey].tracks.push(track);
    });

    // Sort tracks within each album by track number
    Object.values(groups).forEach(group => {
      group.tracks.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    });

    return Object.values(groups);
  }

  function formatDuration(seconds) {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function handlePlayTrack(track, allTracks, index) {
    if (onPlayTrack) {
      const remainingTracks = allTracks.slice(index + 1);
      onPlayTrack(track, remainingTracks);
    }
  }

  function handlePlayAlbumGroup(albumGroup) {
    if (onPlayTrack && albumGroup.tracks.length > 0) {
      const [first, ...rest] = albumGroup.tracks;
      onPlayTrack(first, rest);
    }
  }

  function toggleAlbumCollapse(albumKey) {
    setCollapsedAlbums(prev => {
      const next = new Set(prev);
      if (next.has(albumKey)) {
        next.delete(albumKey);
      } else {
        next.add(albumKey);
      }
      return next;
    });
  }

  const sortedTracks = getSortedTracks();
  const albumGroups = getAlbumGroups();
  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

  return (
    <div className="facet-collection-view">
      {/* Compact Header */}
      <div className="fcv-header">
        <button className="fcv-back" onClick={onBack}>←</button>

        <div className="fcv-title-area">
          <h1 className="fcv-name">{facetName}</h1>
          <span className="fcv-stats">
            {tracks.length} tracks · {formatDuration(totalDuration)}
            {albumGroups.length > 1 && ` · ${albumGroups.length} albums`}
          </span>
        </div>

        <div className="fcv-controls">
          <button
            className={`fcv-view-toggle ${groupByAlbum ? 'active' : ''}`}
            onClick={() => setGroupByAlbum(!groupByAlbum)}
            title={groupByAlbum ? 'Show flat list' : 'Group by album'}
          >
            {groupByAlbum ? '▤' : '≡'}
          </button>

          <select
            className="fcv-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="album">Album</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="dateAdded">Date Added</option>
          </select>

          {tracks.length > 0 && (
            <>
              <button
                className="fcv-play-all"
                onClick={() => handlePlayTrack(sortedTracks[0], sortedTracks, 0)}
                title="Play all"
              >
                ▶ Play
              </button>
              <button
                className="fcv-roam-all"
                onClick={() => onRoamFacet?.(tracks)}
                title="Shuffle and play"
              >
                ⟳ Roam
              </button>
            </>
          )}
        </div>
      </div>

      {/* Track List */}
      <div className="fcv-content">
        {loading ? (
          <div className="fcv-loading">Loading...</div>
        ) : tracks.length === 0 ? (
          <div className="fcv-empty">No tracks with this facet</div>
        ) : groupByAlbum ? (
          /* Album-grouped view */
          <div className="fcv-album-groups">
            {albumGroups.map(group => {
              const isCollapsed = collapsedAlbums.has(group.albumId || group.albumName);
              const groupDuration = group.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

              return (
                <div key={group.albumId || group.albumName} className="fcv-album-group">
                  {/* Album header row */}
                  <div className="fcv-album-header">
                    <div
                      className="fcv-album-art"
                      onClick={() => onOpenAlbum && group.albumId && onOpenAlbum(group.albumId)}
                    >
                      {group.albumArt ? (
                        <img src={`local://${group.albumArt}`} alt="" />
                      ) : (
                        <span className="fcv-art-placeholder">♪</span>
                      )}
                    </div>

                    <div
                      className="fcv-album-info"
                      onClick={() => toggleAlbumCollapse(group.albumId || group.albumName)}
                    >
                      <span className="fcv-collapse-icon">{isCollapsed ? '▸' : '▾'}</span>
                      <span className="fcv-album-name">{group.albumName}</span>
                      <span className="fcv-album-artist">{group.artist}</span>
                      <span className="fcv-album-meta">
                        {group.tracks.length} · {formatDuration(groupDuration)}
                      </span>
                    </div>

                    <button
                      className="fcv-album-play"
                      onClick={() => handlePlayAlbumGroup(group)}
                      title="Play this album's tracks"
                    >
                      ▶
                    </button>
                  </div>

                  {/* Track rows */}
                  {!isCollapsed && (
                    <div className="fcv-album-tracks">
                      {group.tracks.map((track, idx) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          showAlbum={false}
                          onSelect={() => onSelectTrack && onSelectTrack(track)}
                          onPlay={() => handlePlayTrack(track, group.tracks, idx)}
                          onContextMenu={onTrackContextMenu}
                          formatDuration={formatDuration}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Flat list view */
          <div className="fcv-flat-list">
            {sortedTracks.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                showAlbum={true}
                onSelect={() => onSelectTrack && onSelectTrack(track)}
                onPlay={() => handlePlayTrack(track, sortedTracks, idx)}
                onContextMenu={onTrackContextMenu}
                formatDuration={formatDuration}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Compact track row component
function TrackRow({ track, showAlbum, onSelect, onPlay, onContextMenu, formatDuration }) {
  const [isHovered, setIsHovered] = useState(false);
  const [trackStats, setTrackStats] = useState({ total_seconds: 0, listen_count: 0 });
  const titleRef = useRef(null);
  const [needsScroll, setNeedsScroll] = useState(false);

  useEffect(() => {
    if (titleRef.current) {
      setNeedsScroll(titleRef.current.scrollWidth > titleRef.current.clientWidth);
    }
  }, [track.title]);

  useEffect(() => {
    if (track?.id && ipcRenderer) {
      ipcRenderer.invoke('get-track-listening-stats', track.id)
        .then(stats => setTrackStats(stats || { total_seconds: 0, listen_count: 0 }))
        .catch(() => setTrackStats({ total_seconds: 0, listen_count: 0 }));
    }
  }, [track?.id]);

  const getPlays = () => {
    if (track.duration > 0 && trackStats.total_seconds > 0) {
      return (trackStats.total_seconds / track.duration).toFixed(1);
    }
    return '—';
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) {
      onContextMenu(e, track, 'facet-collection');
    }
  };

  return (
    <div
      className="fcv-track-row"
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="fcv-track-num">{track.trackNumber || '—'}</span>

      <span className="fcv-track-title">
        <span
          ref={titleRef}
          className={`fcv-title-text ${isHovered && needsScroll ? 'scrolling' : ''}`}
        >
          {track.title || 'Unknown'}
        </span>
      </span>

      <span className="fcv-track-artist">{track.artist || '—'}</span>

      {showAlbum && (
        <span className="fcv-track-album">{track.album || '—'}</span>
      )}

      <span className="fcv-track-listened">
        {trackStats.total_seconds > 0 ? formatDuration(trackStats.total_seconds) : '—'}
      </span>

      <span className="fcv-track-plays">{getPlays()}</span>

      <span className="fcv-track-duration">{formatDuration(track.duration)}</span>

      <button
        className="fcv-track-play"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
      >
        ▶
      </button>
    </div>
  );
}

export default FacetCollectionView;
