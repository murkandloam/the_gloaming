/**
 * LedgersView - Listening History
 *
 * Spreadsheet-style reports for tracks, records, and artists.
 * Time periods: last 24 hours, 7 days, 30 days, year, all time.
 */

import React, { useState, useEffect } from 'react';
import './LedgersView.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// Time period options
const PERIODS = [
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
  { value: 'month', label: '30d' },
  { value: 'year', label: '1y' },
  { value: 'all', label: 'All' }
];

// View modes
const VIEWS = [
  { value: 'tracks', label: 'Tracks' },
  { value: 'albums', label: 'Records' },
  { value: 'artists', label: 'Artists' }
];

// Format as H:MM:SS
function formatDuration(seconds) {
  if (!seconds || seconds < 0) seconds = 0;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Format track length as M:SS
function formatTrackLength(seconds) {
  if (!seconds || seconds < 0) return '-:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const ITEMS_PER_PAGE = 50;

function LedgersView({ onTrackSelect, onAlbumSelect, currentTrackId, onTrackContextMenu, onAlbumContextMenu, refreshKey = 0 }) {
  const [period, setPeriod] = useState('all');
  const [view, setView] = useState('tracks');
  const [sortBy, setSortBy] = useState('listened');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Load data when filters change, track changes, or refreshKey changes
  useEffect(() => {
    loadData();
    setCurrentPage(1); // Reset to first page on filter change
  }, [period, view, currentTrackId, refreshKey]);

  async function loadData() {
    if (!ipcRenderer) return;

    setLoading(true);

    try {
      const statsResult = await ipcRenderer.invoke('get-listening-stats', { period });
      setStats(statsResult);

      let result;
      switch (view) {
        case 'tracks':
          result = await ipcRenderer.invoke('get-top-tracks', { period, limit: 200, sortBy: 'time' });
          break;
        case 'albums':
          result = await ipcRenderer.invoke('get-top-albums', { period, limit: 200, sortBy: 'time' });
          break;
        case 'artists':
          result = await ipcRenderer.invoke('get-top-artists', { period, limit: 200, sortBy: 'time' });
          break;
        default:
          result = [];
      }

      setItems(result || []);
    } catch (err) {
      console.error('Error loading ledger data:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function handleItemClick(item) {
    if (view === 'tracks' && onTrackSelect) {
      onTrackSelect({
        id: item.track_id,
        title: item.title,
        artist: item.artist,
        trackArtist: item.artist, // Backend returns trackArtist as artist
        album: item.album,
        albumId: item.albumId,
        albumArt: item.albumArt,
        audioPath: item.audioPath,
        duration: item.duration
      });
    } else if (view === 'albums' && onAlbumSelect) {
      onAlbumSelect({
        id: item.album_id,
        title: item.title,
        artist: item.artist,
        albumArt: item.albumArt
      });
    }
  }

  function handleSort(column) {
    if (sortBy === column) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  }

  // Calculate plays from time/duration for tracks
  function getPlays(item) {
    if (view === 'tracks' && item.duration > 0) {
      return (item.total_seconds / item.duration).toFixed(1);
    }
    return item.listen_count || 0;
  }

  // Get sort value for a column
  function getSortValue(item, column) {
    switch (column) {
      case 'title':
        return (item.title || item.artist || '').toLowerCase();
      case 'artist':
        return (item.artist || '').toLowerCase();
      case 'album':
        return (item.album || '').toLowerCase();
      case 'length':
        return item.duration || 0;
      case 'listened':
        return item.total_seconds || 0;
      case 'plays':
        return view === 'tracks' && item.duration > 0
          ? item.total_seconds / item.duration
          : item.listen_count || 0;
      case 'clicks':
        return item.listen_count || 0;
      case 'records':
        return item.unique_albums || 0;
      case 'tracks':
        return item.unique_tracks || 0;
      default:
        return 0;
    }
  }

  // Sort items
  const sortedItems = [...items].sort((a, b) => {
    const aVal = getSortValue(a, sortBy);
    const bVal = getSortValue(b, sortBy);

    // String comparison for text columns
    if (typeof aVal === 'string') {
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'desc' ? -cmp : cmp;
    }

    // Numeric comparison
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  // Pagination
  const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = sortedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Render sort indicator
  function sortIndicator(column) {
    if (sortBy !== column) return null;
    return sortDir === 'desc' ? ' ▼' : ' ▲';
  }

  return (
    <div className="ledgers-view">
      {/* Header */}
      <div className="ledgers-header">
        <div className="ledgers-title-row">
          <h1>Ledgers</h1>
          {stats && (
            <div className="ledgers-stats">
              <span className="stat">{formatDuration(stats.total_seconds)}</span>
              <span className="stat-sep">|</span>
              <span className="stat">{stats.unique_tracks} tracks</span>
              <span className="stat-sep">|</span>
              <span className="stat">{stats.unique_albums} records</span>
              <span className="stat-sep">|</span>
              <span className="stat">{stats.unique_artists} artists</span>
            </div>
          )}
        </div>

        {/* Period Pills */}
        <div className="ledgers-controls">
          <div className="period-pills">
            {PERIODS.map(p => (
              <button
                key={p.value}
                className={`period-pill ${period === p.value ? 'active' : ''}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="ledgers-tabs">
        {VIEWS.map(v => (
          <button
            key={v.value}
            className={`ledgers-tab ${view === v.value ? 'active' : ''}`}
            onClick={() => setView(v.value)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Spreadsheet Content */}
      <div className="ledgers-content">
        {loading ? (
          <div className="ledgers-empty">Loading...</div>
        ) : items.length === 0 ? (
          <div className="ledgers-empty">
            <p>No listening history yet</p>
            <p className="empty-hint">Play some music to start filling your ledgers</p>
          </div>
        ) : (
          <table className="ledgers-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th className="col-art"></th>

                {/* TRACKS view columns */}
                {view === 'tracks' && (
                  <>
                    <th
                      className={`col-title sortable ${sortBy === 'title' ? 'sorted' : ''}`}
                      onClick={() => handleSort('title')}
                    >
                      Title{sortIndicator('title')}
                    </th>
                    <th
                      className={`col-artist sortable ${sortBy === 'artist' ? 'sorted' : ''}`}
                      onClick={() => handleSort('artist')}
                    >
                      Artist{sortIndicator('artist')}
                    </th>
                    <th
                      className={`col-album sortable ${sortBy === 'album' ? 'sorted' : ''}`}
                      onClick={() => handleSort('album')}
                    >
                      Album{sortIndicator('album')}
                    </th>
                    <th
                      className={`col-length sortable ${sortBy === 'length' ? 'sorted' : ''}`}
                      onClick={() => handleSort('length')}
                    >
                      Length{sortIndicator('length')}
                    </th>
                    <th
                      className={`col-listened sortable ${sortBy === 'listened' ? 'sorted' : ''}`}
                      onClick={() => handleSort('listened')}
                    >
                      Listened{sortIndicator('listened')}
                    </th>
                    <th
                      className={`col-plays sortable ${sortBy === 'plays' ? 'sorted' : ''}`}
                      onClick={() => handleSort('plays')}
                    >
                      Plays{sortIndicator('plays')}
                    </th>
                    <th
                      className={`col-clicks sortable ${sortBy === 'clicks' ? 'sorted' : ''}`}
                      onClick={() => handleSort('clicks')}
                    >
                      Clicks{sortIndicator('clicks')}
                    </th>
                  </>
                )}

                {/* ALBUMS view columns */}
                {view === 'albums' && (
                  <>
                    <th
                      className={`col-title sortable ${sortBy === 'title' ? 'sorted' : ''}`}
                      onClick={() => handleSort('title')}
                    >
                      Record{sortIndicator('title')}
                    </th>
                    <th
                      className={`col-artist sortable ${sortBy === 'artist' ? 'sorted' : ''}`}
                      onClick={() => handleSort('artist')}
                    >
                      Artist{sortIndicator('artist')}
                    </th>
                    <th
                      className={`col-listened sortable ${sortBy === 'listened' ? 'sorted' : ''}`}
                      onClick={() => handleSort('listened')}
                    >
                      Listened{sortIndicator('listened')}
                    </th>
                    <th
                      className={`col-clicks sortable ${sortBy === 'clicks' ? 'sorted' : ''}`}
                      onClick={() => handleSort('clicks')}
                    >
                      Listens{sortIndicator('clicks')}
                    </th>
                  </>
                )}

                {/* ARTISTS view columns */}
                {view === 'artists' && (
                  <>
                    <th
                      className={`col-title sortable ${sortBy === 'title' ? 'sorted' : ''}`}
                      onClick={() => handleSort('title')}
                    >
                      Artist{sortIndicator('title')}
                    </th>
                    <th
                      className={`col-count sortable ${sortBy === 'records' ? 'sorted' : ''}`}
                      onClick={() => handleSort('records')}
                    >
                      Records{sortIndicator('records')}
                    </th>
                    <th
                      className={`col-count sortable ${sortBy === 'tracks' ? 'sorted' : ''}`}
                      onClick={() => handleSort('tracks')}
                    >
                      Tracks{sortIndicator('tracks')}
                    </th>
                    <th
                      className={`col-listened sortable ${sortBy === 'listened' ? 'sorted' : ''}`}
                      onClick={() => handleSort('listened')}
                    >
                      Listened{sortIndicator('listened')}
                    </th>
                    <th
                      className={`col-clicks sortable ${sortBy === 'clicks' ? 'sorted' : ''}`}
                      onClick={() => handleSort('clicks')}
                    >
                      Listens{sortIndicator('clicks')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item, index) => (
                <tr
                  key={item.track_id || item.album_id || item.artist || index}
                  onClick={() => handleItemClick(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (view === 'tracks' && onTrackContextMenu) {
                      onTrackContextMenu(e, {
                        id: item.track_id,
                        title: item.title,
                        artist: item.artist,
                        album: item.album,
                        albumId: item.albumId,
                        albumArt: item.albumArt,
                        audioPath: item.audioPath,
                        duration: item.duration,
                        includeInLedgers: item.includeInLedgers
                      });
                    } else if (view === 'albums' && onAlbumContextMenu) {
                      onAlbumContextMenu(e, {
                        id: item.album_id,
                        title: item.title,
                        artist: item.artist,
                        albumArt: item.albumArt
                      });
                    }
                  }}
                  className={view === 'tracks' ? 'clickable' : (view === 'albums' ? 'clickable' : '')}
                >
                  <td className="col-rank">{startIndex + index + 1}</td>
                  <td className="col-art">
                    {view !== 'artists' ? (
                      item.albumArt ? (
                        <img
                          src={`local://${item.albumArt.replace('thumbnail.jpg', 'thumbnail-small.jpg')}`}
                          alt=""
                          className="row-art"
                          onError={(e) => {
                            // Fall back to large thumbnail if small doesn't exist
                            if (e.target.src.includes('thumbnail-small.jpg')) {
                              e.target.src = `local://${item.albumArt}`;
                            }
                          }}
                        />
                      ) : (
                        <div className="row-art-placeholder">♪</div>
                      )
                    ) : (
                      <div className="row-artist-avatar">
                        {(item.artist || 'A')[0].toUpperCase()}
                      </div>
                    )}
                  </td>

                  {/* TRACKS view data */}
                  {view === 'tracks' && (
                    <>
                      <td className="col-title">{item.title}</td>
                      <td className="col-artist">{item.artist}</td>
                      <td className="col-album">{item.album}</td>
                      <td className="col-length">{formatTrackLength(item.duration)}</td>
                      <td className="col-listened">{formatDuration(item.total_seconds)}</td>
                      <td className="col-plays">{getPlays(item)}</td>
                      <td className="col-clicks">{item.listen_count || 0}</td>
                    </>
                  )}

                  {/* ALBUMS view data */}
                  {view === 'albums' && (
                    <>
                      <td className="col-title">{item.title}</td>
                      <td className="col-artist">{item.artist}</td>
                      <td className="col-listened">{formatDuration(item.total_seconds)}</td>
                      <td className="col-clicks">{item.listen_count || 0}</td>
                    </>
                  )}

                  {/* ARTISTS view data */}
                  {view === 'artists' && (
                    <>
                      <td className="col-title">{item.artist}</td>
                      <td className="col-count">{item.unique_albums || 0}</td>
                      <td className="col-count">{item.unique_tracks || 0}</td>
                      <td className="col-listened">{formatDuration(item.total_seconds)}</td>
                      <td className="col-clicks">{item.listen_count || 0}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination Controls */}
        {!loading && items.length > 0 && totalPages > 1 && (
          <div className="ledgers-pagination">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              First
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </button>
            <span className="pagination-info">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              Last
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default LedgersView;
