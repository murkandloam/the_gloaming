/**
 * Ledgers IPC Handlers
 *
 * Listening history tracking - records playtime, surfaces top tracks/albums/artists.
 */

const fs = require('fs');
const path = require('path');

module.exports = function registerLedgersHandlers({
  ipcMain,
  ledgers,
  getLibraryPath,
  getLibraryPaths,
  readCollection,
  readTrackMetadata,
  getAlbumArtPath
}) {

  // Record a listening session (called when track changes or app closes)
  ipcMain.handle('record-listen', async (event, { trackId, albumId, artist, seconds }) => {
    console.log('[Main] record-listen received:', { trackId, albumId, artist, seconds });
    try {
      ledgers.recordListen({ trackId, albumId, artist, seconds });
      console.log('[Main] record-listen success');
      return { success: true };
    } catch (err) {
      console.error('[Main] Error recording listen:', err);
      return { success: false, error: err.message };
    }
  });

  // Get top tracks for a time period
  ipcMain.handle('get-top-tracks', async (event, { period, limit, sortBy }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const tracks = ledgers.getTopTracks({ period, limit, sortBy });
      console.log('[Main] get-top-tracks: found', tracks.length, 'tracks from ledgers');
      if (tracks.length > 0) {
        console.log('[Main] First track from ledgers:', tracks[0]);
      }

      // Enrich with track metadata
      const paths = getLibraryPaths(currentLibraryPath);
      console.log('[Main] Library tracks path:', paths.tracks);

      // Build album cache for faster lookups
      const albumCache = {};
      const getAlbumData = (albumId) => {
        if (!albumId) return null;
        if (!albumCache[albumId]) {
          albumCache[albumId] = readCollection(currentLibraryPath, albumId);
        }
        return albumCache[albumId];
      };

      const enrichedTracks = tracks.map(t => {
        let metadata = null;
        let albumArt = null;
        let albumName = 'Unknown Album';
        let trackTitle = 'Unknown Track';
        let trackDuration = 0;

        // Track ID format: "albumId-trackNumber" or actual track UUID
        const trackId = t.track_id;
        const albumId = t.album_id;
        console.log('[Main] Processing track:', trackId, 'album:', albumId);

        // Try to get album data first
        const album = getAlbumData(albumId);

        if (album) {
          albumName = album.name || 'Unknown Album';

          // Find track in album by matching the composite ID pattern
          if (trackId && trackId.includes('-')) {
            // Extract track number from composite ID (format: albumId-trackNum)
            const parts = trackId.split('-');
            const trackNum = parseInt(parts[parts.length - 1], 10);

            // Find the track in album.tracks by position/trackNumber
            const trackRef = album.tracks?.find(tr =>
              tr.position === trackNum ||
              (tr.trackNumber || tr.track) === trackNum
            );

            if (trackRef) {
              // Load actual track metadata
              const trackFolder = path.join(paths.tracks, `${trackRef.id}.info`);
              metadata = readTrackMetadata(trackFolder);
              if (metadata) {
                trackTitle = metadata.title || 'Unknown Track';
                trackDuration = metadata.duration || 0;
              }
            }
          }

          // Get album cover (thumbnail for UI display)
          albumArt = getAlbumArtPath(album, paths, true);
        }

        // If we still don't have metadata, try direct track folder lookup
        if (!metadata) {
          const trackFolder = path.join(paths.tracks, `${trackId}.info`);
          console.log('[Main] Looking for track folder:', trackFolder, 'exists:', fs.existsSync(trackFolder));
          if (fs.existsSync(trackFolder)) {
            metadata = readTrackMetadata(trackFolder);
            console.log('[Main] Read metadata:', metadata ? metadata.title : 'NULL');
            if (metadata) {
              trackTitle = metadata.title || 'Unknown Track';
              trackDuration = metadata.duration || 0;
              albumName = metadata.importSource?.album || albumName;
            }
          }
        }

        // Get audioPath from metadata
        let audioPath = null;
        if (metadata?.filename) {
          // Find the actual track folder
          if (trackId && trackId.includes('-') && album) {
            const parts = trackId.split('-');
            const trackNum = parseInt(parts[parts.length - 1], 10);
            const trackRef = album.tracks?.find(tr =>
              tr.position === trackNum ||
              (tr.trackNumber || tr.track) === trackNum
            );
            if (trackRef) {
              audioPath = path.join(paths.tracks, `${trackRef.id}.info`, metadata.filename);
            }
          } else {
            audioPath = path.join(paths.tracks, `${trackId}.info`, metadata.filename);
          }
        }

        return {
          ...t,
          title: trackTitle,
          artist: metadata?.trackArtist || 'Unknown Artist',
          album: metadata?.album || albumName,
          albumId: albumId,
          duration: trackDuration,
          albumArt,
          audioPath,
          includeInLedgers: metadata?.includeInLedgers !== false // default true
        };
      });

      // Filter out tracks excluded from ledgers
      const filteredTracks = enrichedTracks.filter(t => t.includeInLedgers !== false);

      console.log('[Main] Returning', filteredTracks.length, 'enriched tracks (filtered from', enrichedTracks.length, ')');
      if (filteredTracks.length > 0) {
        console.log('[Main] First enriched track:', JSON.stringify(filteredTracks[0], null, 2));
      }
      return filteredTracks;
    } catch (err) {
      console.error('Error getting top tracks:', err);
      return [];
    }
  });

  // Get top albums for a time period
  ipcMain.handle('get-top-albums', async (event, { period, limit, sortBy }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const albums = ledgers.getTopAlbums({ period, limit, sortBy });

      // Enrich with album metadata
      const paths = getLibraryPaths(currentLibraryPath);
      const enrichedAlbums = albums.map(a => {
        const album = readCollection(currentLibraryPath, a.album_id);

        // Check if album has any tracks included in ledgers
        let hasIncludedTracks = true; // default true if no tracks or can't read
        if (album?.tracks?.length > 0) {
          hasIncludedTracks = album.tracks.some(trackRef => {
            const trackFolder = path.join(paths.tracks, `${trackRef.id}.info`);
            const metadata = readTrackMetadata(trackFolder);
            return metadata?.includeInLedgers !== false;
          });
        }

        // Get album cover (thumbnail for UI display)
        const albumArt = album ? getAlbumArtPath(album, paths, true) : null;

        return {
          ...a,
          title: album?.name || 'Unknown Album',
          // For albums/records, prioritize album artist over track artist
          artist: album?.artist || a.artist || 'Unknown Artist',
          trackCount: album?.tracks?.length || 0,
          albumArt,
          hasIncludedTracks
        };
      });

      // Filter out albums where all tracks are excluded from ledgers
      const filteredAlbums = enrichedAlbums.filter(a => a.hasIncludedTracks);

      return filteredAlbums;
    } catch (err) {
      console.error('Error getting top albums:', err);
      return [];
    }
  });

  // Get top artists for a time period
  ipcMain.handle('get-top-artists', async (event, { period, limit, sortBy }) => {
    try {
      return ledgers.getTopArtists({ period, limit, sortBy });
    } catch (err) {
      console.error('Error getting top artists:', err);
      return [];
    }
  });

  // Get stats for a specific track
  ipcMain.handle('get-track-listening-stats', async (event, trackId) => {
    try {
      return ledgers.getTrackStats(trackId);
    } catch (err) {
      console.error('Error getting track stats:', err);
      return { total_seconds: 0, listen_count: 0 };
    }
  });

  // Get stats for multiple albums at once (for grid sorting by listen time)
  ipcMain.handle('get-albums-listening-stats', async (event, albumIds) => {
    try {
      return ledgers.getAlbumsStats(albumIds);
    } catch (err) {
      console.error('Error getting albums stats:', err);
      return {};
    }
  });

  // Get overall listening stats
  ipcMain.handle('get-listening-stats', async (event, { period }) => {
    try {
      return ledgers.getOverallStats({ period });
    } catch (err) {
      console.error('Error getting listening stats:', err);
      return {
        total_seconds: 0,
        total_listens: 0,
        unique_tracks: 0,
        unique_albums: 0,
        unique_artists: 0
      };
    }
  });

  // Reset listening stats for a specific track
  ipcMain.handle('reset-track-listening-stats', async (event, trackId) => {
    try {
      const success = ledgers.resetTrackStats(trackId);
      return { success };
    } catch (err) {
      console.error('Error resetting track stats:', err);
      return { success: false, error: err.message };
    }
  });

  // Reset listening stats for all tracks in an album/record
  ipcMain.handle('reset-album-listening-stats', async (event, albumId) => {
    try {
      const success = ledgers.deleteAlbumStats(albumId);
      console.log('[Ledgers] Reset listening stats for album:', albumId);
      return { success };
    } catch (err) {
      console.error('Error resetting album stats:', err);
      return { success: false, error: err.message };
    }
  });

};
