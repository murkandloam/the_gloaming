/**
 * Mixtapes IPC Handlers
 *
 * CRUD operations for mixtapes - user-curated playlists with
 * cassette visuals and ephemera attachments.
 */

const fs = require('fs');
const path = require('path');

// Number of cassette images available
const CASSETTE_COUNT = 16;

module.exports = function registerMixtapesHandlers({
  ipcMain,
  getLibraryPath,
  getLibraryPaths,
  getAlbumArtPath,
  generateUUID,
  shuffleArray,
  generateShuffleSeed,
  listCollections,
  readCollection,
  writeCollection,
  readTrackMetadata,
  loadFacets,
  saveFacets
}) {

  // Load all mixtapes for display
  ipcMain.handle('load-mixtapes', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtapes = listCollections(currentLibraryPath, 'mixtape');
      const paths = getLibraryPaths(currentLibraryPath);

      // Enrich mixtapes with track data
      return mixtapes.map(mixtape => {
        const tracks = (mixtape.tracks || []).map(trackRef => {
          const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
          const trackMeta = readTrackMetadata(trackFolderPath);

          if (trackMeta) {
            // Get album info for track display
            const album = trackMeta.albumId ? readCollection(currentLibraryPath, trackMeta.albumId) : null;
            let albumCoverPath = null;

            if (album) {
              albumCoverPath = getAlbumArtPath(album, paths, true);
            }

            return {
              ...trackMeta,
              position: trackRef.position,
              audioPath: path.join(trackFolderPath, trackMeta.filename),
              albumArt: albumCoverPath,
              album: trackMeta.album || album?.name || 'Unknown Album',
              artist: trackMeta.trackArtist || 'Unknown Artist'
            };
          }
          return null;
        }).filter(Boolean);

        // Resolve custom cover path if set
        let coverPath = null;
        if (mixtape.coverImageId) {
          const attachmentFolder = path.join(paths.attachments, `${mixtape.coverImageId}.info`);
          const metaPath = path.join(attachmentFolder, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              coverPath = path.join(attachmentFolder, meta.filename);
            } catch (e) { /* ignore */ }
          }
        }

        return {
          ...mixtape,
          tracks,
          trackCount: tracks.length,
          coverPath
        };
      });
    } catch (err) {
      console.error('Error loading mixtapes:', err);
      return [];
    }
  });

  // Alias for search - returns all mixtapes with basic info including cover paths
  ipcMain.handle('get-all-mixtapes', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const mixtapes = listCollections(currentLibraryPath, 'mixtape');

      // Return basic info for search (name, id, color, track count, cassette index, cover path)
      return mixtapes.map(mixtape => {
        let coverPath = null;

        // Resolve custom cover path if set
        if (mixtape.coverImageId) {
          const attachmentFolder = path.join(paths.attachments, `${mixtape.coverImageId}.info`);
          const metaPath = path.join(attachmentFolder, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              coverPath = path.join(attachmentFolder, meta.filename);
            } catch (e) {
              // Ignore metadata read errors
            }
          }
        }

        return {
          id: mixtape.id,
          name: mixtape.name,
          color: mixtape.color,
          trackCount: mixtape.tracks?.length || 0,
          cassetteIndex: mixtape.cassetteIndex ?? 0,
          coverPath // null if no custom cover, otherwise the full path
        };
      });
    } catch (err) {
      console.error('Error getting all mixtapes:', err);
      return [];
    }
  });

  // Create a new mixtape
  ipcMain.handle('create-mixtape', async (event, { name }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const id = generateUUID();
      const cassetteIndex = Math.floor(Math.random() * CASSETTE_COUNT);

      const mixtape = {
        id,
        type: 'mixtape',
        name,
        description: '',
        cassetteIndex, // Random cassette image (0-15)
        useBackgroundImage: true, // Default to showing backdrop
        backdropBlur: 40, // Default blur
        tracks: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
      };

      writeCollection(currentLibraryPath, mixtape);
      console.log('Created mixtape:', name, id);

      return { success: true, mixtape };
    } catch (err) {
      console.error('Error creating mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Get a single mixtape by ID
  ipcMain.handle('get-mixtape', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return null;
      }

      const paths = getLibraryPaths(currentLibraryPath);

      // Enrich with full track data
      const tracks = (mixtape.tracks || []).map(trackRef => {
        const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
        const trackMeta = readTrackMetadata(trackFolderPath);

        if (trackMeta) {
          const album = trackMeta.albumId ? readCollection(currentLibraryPath, trackMeta.albumId) : null;
          let albumCoverPath = null;

          if (album) {
            albumCoverPath = getAlbumArtPath(album, paths, true);
          }

          return {
            ...trackMeta,
            position: trackRef.position,
            audioPath: path.join(trackFolderPath, trackMeta.filename),
            albumArt: albumCoverPath,
            album: trackMeta.album || album?.name || 'Unknown Album',
            artist: trackMeta.trackArtist || 'Unknown Artist'
          };
        }
        return null;
      }).filter(Boolean);

      return { ...mixtape, tracks };
    } catch (err) {
      console.error('Error getting mixtape:', err);
      return null;
    }
  });

  // Get shuffled tracks from a mixtape for Roaming mode
  ipcMain.handle('get-roaming-mixtape', async (event, { mixtapeId, seed }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      const paths = getLibraryPaths(currentLibraryPath);

      // Get full track data (same logic as get-mixtape)
      const tracks = (mixtape.tracks || []).map(trackRef => {
        const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
        const trackMeta = readTrackMetadata(trackFolderPath);

        if (trackMeta) {
          const album = trackMeta.albumId ? readCollection(currentLibraryPath, trackMeta.albumId) : null;
          let albumCoverPath = null;

          if (album) {
            albumCoverPath = getAlbumArtPath(album, paths, true);
          }

          return {
            ...trackMeta,
            position: trackRef.position,
            audioPath: path.join(trackFolderPath, trackMeta.filename),
            albumArt: albumCoverPath,
            album: trackMeta.album || album?.name || 'Unknown Album',
            artist: trackMeta.trackArtist || 'Unknown Artist'
          };
        }
        return null;
      }).filter(Boolean);

      // Use provided seed or generate new one
      const shuffleSeed = seed ?? generateShuffleSeed();

      // Shuffle the tracks
      const shuffledTracks = shuffleArray(tracks, shuffleSeed);

      return {
        success: true,
        mixtape: { ...mixtape, tracks: shuffledTracks },
        seed: shuffleSeed
      };
    } catch (err) {
      console.error('Error getting roaming mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Update mixtape metadata (name, description, color)
  ipcMain.handle('update-mixtape', async (event, { mixtapeId, updates }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      const updatedMixtape = {
        ...mixtape,
        name: updates.name ?? mixtape.name,
        description: updates.description ?? mixtape.description,
        cassetteIndex: updates.cassetteIndex !== undefined ? updates.cassetteIndex : mixtape.cassetteIndex,
        coverImageId: updates.coverImageId !== undefined ? updates.coverImageId : mixtape.coverImageId,
        useBackgroundImage: updates.useBackgroundImage !== undefined ? updates.useBackgroundImage : mixtape.useBackgroundImage,
        backdropBlur: updates.backdropBlur !== undefined ? updates.backdropBlur : mixtape.backdropBlur,
        backdropImageId: updates.backdropImageId !== undefined ? updates.backdropImageId : mixtape.backdropImageId,
        modifiedAt: new Date().toISOString()
      };

      writeCollection(currentLibraryPath, updatedMixtape);
      console.log('Updated mixtape:', mixtapeId);

      return { success: true, mixtape: updatedMixtape };
    } catch (err) {
      console.error('Error updating mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Delete a mixtape
  ipcMain.handle('delete-mixtape', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const mixtapePath = path.join(paths.collections, `${mixtapeId}.json`);

      if (fs.existsSync(mixtapePath)) {
        fs.unlinkSync(mixtapePath);
        console.log('Deleted mixtape:', mixtapeId);
        return { success: true };
      }

      return { success: false, error: 'Mixtape not found' };
    } catch (err) {
      console.error('Error deleting mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Get mixtape facets
  ipcMain.handle('get-mixtape-facets', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return [];
      }
      return mixtape.facets || [];
    } catch (err) {
      console.error('Error getting mixtape facets:', err);
      return [];
    }
  });

  // Add facet to mixtape
  ipcMain.handle('add-facet-to-mixtape', async (event, { mixtapeId, facetName }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.facets = mixtape.facets || [];
      if (!mixtape.facets.includes(facetName)) {
        mixtape.facets.push(facetName);
        mixtape.modifiedAt = new Date().toISOString();
        writeCollection(currentLibraryPath, mixtape);
      }

      // Update recent facets
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.recent = facetsConfig.recent || [];
      facetsConfig.recent = facetsConfig.recent.filter(f => f !== facetName);
      facetsConfig.recent.unshift(facetName);
      facetsConfig.recent = facetsConfig.recent.slice(0, 10);
      saveFacets(currentLibraryPath, facetsConfig);

      return { success: true };
    } catch (err) {
      console.error('Error adding facet to mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove facet from mixtape
  ipcMain.handle('remove-facet-from-mixtape', async (event, { mixtapeId, facetName }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.facets = (mixtape.facets || []).filter(f => f !== facetName);
      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      return { success: true };
    } catch (err) {
      console.error('Error removing facet from mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Add tracks to a mixtape
  ipcMain.handle('add-tracks-to-mixtape', async (event, { mixtapeId, trackIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      // Find current max position
      const maxPosition = mixtape.tracks.reduce((max, t) => Math.max(max, t.position || 0), 0);

      // Add new tracks with sequential positions
      const newTracks = trackIds.map((trackId, index) => ({
        id: trackId,
        position: maxPosition + index + 1
      }));

      mixtape.tracks = [...mixtape.tracks, ...newTracks];
      mixtape.modifiedAt = new Date().toISOString();

      writeCollection(currentLibraryPath, mixtape);
      console.log(`Added ${trackIds.length} tracks to mixtape:`, mixtapeId);

      return { success: true };
    } catch (err) {
      console.error('Error adding tracks to mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove a track from a mixtape
  ipcMain.handle('remove-track-from-mixtape', async (event, { mixtapeId, trackId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.tracks = mixtape.tracks.filter(t => t.id !== trackId);
      mixtape.modifiedAt = new Date().toISOString();

      writeCollection(currentLibraryPath, mixtape);
      console.log('Removed track from mixtape:', mixtapeId, trackId);

      return { success: true };
    } catch (err) {
      console.error('Error removing track from mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder tracks in a mixtape
  ipcMain.handle('reorder-mixtape-tracks', async (event, { mixtapeId, trackIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      // Create new track order with positions
      mixtape.tracks = trackIds.map((trackId, index) => ({
        id: trackId,
        position: index + 1
      }));
      mixtape.modifiedAt = new Date().toISOString();

      writeCollection(currentLibraryPath, mixtape);
      console.log('Reordered mixtape tracks:', mixtapeId);

      return { success: true };
    } catch (err) {
      console.error('Error reordering mixtape tracks:', err);
      return { success: false, error: err.message };
    }
  });

  // Get all album tracks for adding to mixtape
  ipcMain.handle('get-album-track-ids', async (event, albumId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album || album.type !== 'album') {
        return { success: false, error: 'Album not found' };
      }

      const trackIds = (album.tracks || [])
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map(t => t.id);

      return { success: true, trackIds };
    } catch (err) {
      console.error('Error getting album track IDs:', err);
      return { success: false, error: err.message };
    }
  });

  // Get all mixtapes containing a specific track
  ipcMain.handle('get-mixtapes-for-track', async (event, trackId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const mixtapes = listCollections(currentLibraryPath, 'mixtape');

      // Filter to mixtapes that contain this track
      const containing = mixtapes
        .filter(m => (m.tracks || []).some(t => t.id === trackId))
        .map(m => {
          let coverPath = null;

          // Resolve custom cover path if set
          if (m.coverImageId) {
            const attachmentFolder = path.join(paths.attachments, `${m.coverImageId}.info`);
            const metaPath = path.join(attachmentFolder, 'metadata.json');
            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                coverPath = path.join(attachmentFolder, meta.filename);
              } catch (e) {
                // Ignore metadata read errors
              }
            }
          }

          return {
            id: m.id,
            name: m.name,
            color: m.color,
            trackCount: (m.tracks || []).length,
            cassetteIndex: m.cassetteIndex ?? 0,
            coverPath
          };
        });

      return containing;
    } catch (err) {
      console.error('Error getting mixtapes for track:', err);
      return [];
    }
  });

  // Get tracks for a mixtape (for Play Cassette / Add to Queue context menu actions)
  ipcMain.handle('get-mixtape-tracks', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found', tracks: [] };
      }

      const paths = getLibraryPaths(currentLibraryPath);

      // Enrich with full track data (same logic as get-mixtape)
      const tracks = (mixtape.tracks || []).map(trackRef => {
        const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
        const trackMeta = readTrackMetadata(trackFolderPath);

        if (trackMeta) {
          const album = trackMeta.albumId ? readCollection(currentLibraryPath, trackMeta.albumId) : null;
          let albumCoverPath = null;

          if (album) {
            albumCoverPath = getAlbumArtPath(album, paths, true);
          }

          return {
            ...trackMeta,
            position: trackRef.position,
            audioPath: path.join(trackFolderPath, trackMeta.filename),
            albumArt: albumCoverPath,
            album: trackMeta.album || album?.name || 'Unknown Album',
            artist: trackMeta.trackArtist || 'Unknown Artist'
          };
        }
        return null;
      }).filter(Boolean);

      return { success: true, tracks };
    } catch (err) {
      console.error('Error getting mixtape tracks:', err);
      return { success: false, error: err.message, tracks: [] };
    }
  });

  // Get all mixtapes containing any track from a specific album
  ipcMain.handle('get-mixtapes-for-album', async (event, albumId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtapes = listCollections(currentLibraryPath, 'mixtape');

      // Filter to mixtapes that contain any track from this album
      const containing = mixtapes
        .filter(m => (m.tracks || []).some(t => t.albumId === albumId))
        .map(m => ({
          id: m.id,
          name: m.name,
          color: m.color,
          trackCount: (m.tracks || []).length
        }));

      return containing;
    } catch (err) {
      console.error('Error getting mixtapes for album:', err);
      return [];
    }
  });

};
