/**
 * Albums IPC Handlers
 *
 * Record (album) CRUD operations - viewing, editing metadata, managing tracks,
 * selecting covers, and deletion. Also includes track-level operations.
 */

const fs = require('fs');
const path = require('path');

module.exports = function registerAlbumsHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  getLibraryPaths,
  generateUUID,
  readCollection,
  writeCollection,
  listCollections,
  readTrackMetadata,
  generateThumbnails,
  ledgers,
  facetIndex
}) {

  // Get single album by ID
  ipcMain.handle('get-album', async (event, albumId) => {
    const currentLibraryPath = getLibraryPath();
    const collection = readCollection(currentLibraryPath, albumId);
    if (!collection || collection.type !== 'album') {
      return null;
    }

    // Enrich with track data (same as loadAlbumsForDisplay but for one)
    const paths = getLibraryPaths(currentLibraryPath);
    const tracks = (collection.tracks || []).map(trackRef => {
      const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
      const trackMeta = readTrackMetadata(trackFolderPath);
      return trackMeta ? {
        ...trackMeta,
        position: trackRef.position,
        audioPath: path.join(trackFolderPath, trackMeta.filename)
      } : null;
    }).filter(Boolean);

    return { ...collection, tracks };
  });

  // Get single track by ID
  ipcMain.handle('get-track', async (event, trackId) => {
    const currentLibraryPath = getLibraryPath();
    const paths = getLibraryPaths(currentLibraryPath);
    const trackFolderPath = path.join(paths.tracks, `${trackId}.info`);
    const metadata = readTrackMetadata(trackFolderPath);

    if (metadata) {
      return {
        ...metadata,
        audioPath: path.join(trackFolderPath, metadata.filename)
      };
    }

    return null;
  });

  // ============================================
  // Manifest Operations (Track & Album editing)
  // ============================================

  // Update track metadata
  ipcMain.handle('update-track-metadata', async (event, { trackId, albumId, updates }) => {
    console.log('=== UPDATE TRACK METADATA ===');
    console.log('Received trackId:', trackId);
    console.log('Received albumId:', albumId);
    console.log('Updates:', updates);

    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);

      // Try to find the track folder
      let trackFolderPath = path.join(paths.tracks, `${trackId}.info`);
      let actualTrackId = trackId;

      console.log('Looking for track at:', trackFolderPath);
      console.log('Exists?', fs.existsSync(trackFolderPath));

      // If not found directly, search in album's track list
      if (!fs.existsSync(trackFolderPath) && albumId) {
        console.log('Track not found directly, searching in album:', albumId);
        const album = readCollection(currentLibraryPath, albumId);

        if (album && album.tracks) {
          console.log('Album has', album.tracks.length, 'tracks');

          // Try to find the track by searching all tracks in album
          for (const trackRef of album.tracks) {
            const testPath = path.join(paths.tracks, `${trackRef.id}.info`);
            console.log('Checking track ref:', trackRef.id, 'at', testPath);

            if (fs.existsSync(testPath)) {
              const meta = readTrackMetadata(testPath);
              console.log('Found metadata with title:', meta?.title);

              // Match by title if our trackId doesn't work
              if (meta) {
                actualTrackId = trackRef.id;
                trackFolderPath = testPath;
                console.log('Using track:', actualTrackId);
                break;
              }
            }
          }
        }
      }

      // Read existing metadata
      const metadata = readTrackMetadata(trackFolderPath);
      if (!metadata) {
        console.error('Track metadata not found at:', trackFolderPath);
        return { success: false, error: 'Track not found: ' + trackId };
      }

      console.log('Current metadata id:', metadata.id);
      console.log('Current title:', metadata.title);

      // Apply updates - preserve the original id
      const updatedMetadata = {
        ...metadata,
        title: updates.title !== undefined ? updates.title : metadata.title,
        sortTitle: updates.sortTitle !== undefined ? updates.sortTitle : metadata.sortTitle,
        trackArtist: updates.trackArtist !== undefined ? updates.trackArtist : metadata.trackArtist,
        lyrics: updates.lyrics !== undefined ? updates.lyrics : metadata.lyrics,
        notes: updates.notes !== undefined ? updates.notes : metadata.notes,
        disc: updates.disc !== undefined ? updates.disc : metadata.disc,
        trackNumber: updates.trackNumber !== undefined ? updates.trackNumber : metadata.trackNumber,
        includeInLedgers: updates.includeInLedgers !== undefined ? updates.includeInLedgers : metadata.includeInLedgers,
        modifiedAt: new Date().toISOString()
      };

      console.log('Updated metadata title:', updatedMetadata.title);

      // Write back
      const metadataPath = path.join(trackFolderPath, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2));

      console.log('Wrote metadata to:', metadataPath);
      console.log('=== UPDATE COMPLETE ===');

      return { success: true, track: updatedMetadata };
    } catch (err) {
      console.error('Error updating track metadata:', err);
      return { success: false, error: err.message };
    }
  });

  // Update album metadata
  ipcMain.handle('update-album-metadata', async (event, { albumId, updates }) => {
    try {
      const currentLibraryPath = getLibraryPath();

      // Read existing album collection
      const album = readCollection(currentLibraryPath, albumId);
      if (!album || album.type !== 'album') {
        return { success: false, error: 'Album not found' };
      }

      // Handle format field (LP/EP/Single) - defaults to LP for backwards compatibility
      // If setting a parent (era child), default to EP format
      let format = updates.format ?? album.format ?? 'LP';
      if (updates.eraParent && updates.eraParent !== album.eraParent) {
        format = 'EP'; // Child albums default to EP
      }

      // Handle characteristics array
      let characteristics = updates.characteristics ?? album.characteristics ?? [];

      // Legacy isLP support: derive from format for backwards compatibility
      const isLP = format === 'LP';

      // Map UI field names to collection field names
      const updatedAlbum = {
        ...album,
        name: updates.title ?? album.name,
        artist: updates.artist ?? album.artist,
        sortArtist: updates.sortArtist ?? album.sortArtist,
        sortTitle: updates.sortTitle ?? album.sortTitle,
        releaseDate: updates.releaseDate ?? album.releaseDate,
        genre: updates.genre ?? album.genre,
        format: format,
        characteristics: characteristics,
        isLP: isLP, // Keep for backwards compatibility
        backdropBlur: updates.backdropBlur ?? album.backdropBlur ?? 30,
        useBackgroundImage: updates.useBackgroundImage ?? album.useBackgroundImage ?? true,
        backdropImageId: updates.backdropImageId !== undefined ? updates.backdropImageId : album.backdropImageId,
        eraParent: updates.eraParent ?? album.eraParent,
        includeInLedgers: updates.includeInLedgers !== undefined ? updates.includeInLedgers : album.includeInLedgers,
        modifiedAt: new Date().toISOString()
      };

      // Handle era linking updates
      if (updates.eraParent !== undefined) {
        // If setting a new parent, update the parent's children list
        if (updates.eraParent && updates.eraParent !== album.eraParent) {
          const newParent = readCollection(currentLibraryPath, updates.eraParent);
          if (newParent) {
            newParent.eraChildren = newParent.eraChildren || [];
            if (!newParent.eraChildren.includes(albumId)) {
              newParent.eraChildren.push(albumId);
              writeCollection(currentLibraryPath, newParent);
            }
          }
        }

        // If removing from old parent, update old parent's children list
        if (album.eraParent && album.eraParent !== updates.eraParent) {
          const oldParent = readCollection(currentLibraryPath, album.eraParent);
          if (oldParent) {
            oldParent.eraChildren = (oldParent.eraChildren || []).filter(id => id !== albumId);
            writeCollection(currentLibraryPath, oldParent);
          }
        }
      }

      // Write back
      writeCollection(currentLibraryPath, updatedAlbum);

      console.log('Updated album metadata:', albumId);
      return { success: true, album: updatedAlbum };
    } catch (err) {
      console.error('Error updating album metadata:', err);
      return { success: false, error: err.message };
    }
  });

  // Set ledger status for all tracks in an album
  ipcMain.handle('set-album-tracks-ledger-status', async (event, { albumId, includeInLedgers }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const album = readCollection(currentLibraryPath, albumId);

      if (!album || album.type !== 'album') {
        return { success: false, error: 'Album not found' };
      }

      let updated = 0;
      for (const trackRef of (album.tracks || [])) {
        const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
        const metadata = readTrackMetadata(trackFolderPath);

        if (metadata) {
          metadata.includeInLedgers = includeInLedgers;
          metadata.modifiedAt = new Date().toISOString();

          const metadataPath = path.join(trackFolderPath, 'metadata.json');
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
          updated++;
        }
      }

      console.log(`Updated ledger status for ${updated} tracks in album ${albumId}`);
      return { success: true, updated };
    } catch (err) {
      console.error('Error setting album tracks ledger status:', err);
      return { success: false, error: err.message };
    }
  });

  // Delete album and all its tracks
  ipcMain.handle('delete-album', async (event, { albumId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);

      // Read album to get track list
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) {
        return { success: false, error: 'Album not found' };
      }

      // Delete all track folders
      for (const trackRef of (album.tracks || [])) {
        const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
        if (fs.existsSync(trackFolderPath)) {
          fs.rmSync(trackFolderPath, { recursive: true, force: true });
          console.log('Deleted track folder:', trackRef.id);
        }
      }

      // Note: Cover attachments are now in attachments/ folder
      // They will be cleaned up as orphans or retained if linked elsewhere

      // Delete album collection JSON
      const albumJsonPath = path.join(paths.collections, `${albumId}.json`);
      if (fs.existsSync(albumJsonPath)) {
        fs.unlinkSync(albumJsonPath);
        console.log('Deleted album collection:', albumId);
      }

      // Remove from any parent's children list
      if (album.eraParent) {
        const parent = readCollection(currentLibraryPath, album.eraParent);
        if (parent) {
          parent.eraChildren = (parent.eraChildren || []).filter(id => id !== albumId);
          writeCollection(currentLibraryPath, parent);
        }
      }

      // Update any children to remove parent reference
      for (const childId of (album.eraChildren || [])) {
        const child = readCollection(currentLibraryPath, childId);
        if (child) {
          child.eraParent = null;
          writeCollection(currentLibraryPath, child);
        }
      }

      // Delete listening history for this album
      ledgers.deleteAlbumStats(albumId);

      // Rebuild facet index to remove deleted tracks
      facetIndex.buildIndex(currentLibraryPath);

      console.log('Album deleted successfully:', albumId);
      return { success: true };
    } catch (err) {
      console.error('Error deleting album:', err);
      return { success: false, error: err.message };
    }
  });

  // Delete a single track from the library
  ipcMain.handle('delete-track', async (event, { trackId, albumId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);

      // Delete track folder
      const trackFolderPath = path.join(paths.tracks, `${trackId}.info`);
      if (fs.existsSync(trackFolderPath)) {
        fs.rmSync(trackFolderPath, { recursive: true, force: true });
        console.log('Deleted track folder:', trackId);
      }

      // Remove track reference from parent album
      if (albumId) {
        const album = readCollection(currentLibraryPath, albumId);
        if (album) {
          album.tracks = (album.tracks || []).filter(t => t.id !== trackId);
          writeCollection(currentLibraryPath, album);
          console.log('Removed track from album:', albumId);
        }
      }

      // Remove track from any mixtapes
      const mixtapes = listCollections(currentLibraryPath, 'mixtape');
      for (const mixtape of mixtapes) {
        const originalLength = (mixtape.tracks || []).length;
        mixtape.tracks = (mixtape.tracks || []).filter(t => t.id !== trackId);
        if (mixtape.tracks.length !== originalLength) {
          writeCollection(currentLibraryPath, mixtape);
          console.log('Removed track from mixtape:', mixtape.id);
        }
      }

      // Delete listening history for this track
      ledgers.resetTrackStats(trackId);

      // Rebuild facet index to remove deleted track
      facetIndex.buildIndex(currentLibraryPath);

      console.log('Track deleted successfully:', trackId);
      return { success: true };
    } catch (err) {
      console.error('Error deleting track:', err);
      return { success: false, error: err.message };
    }
  });

  // Select new cover image for album
  ipcMain.handle('select-cover-image', async (event, { albumId }) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select Album Cover',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const currentLibraryPath = getLibraryPath();
      const sourcePath = result.filePaths[0];
      const ext = path.extname(sourcePath);
      const paths = getLibraryPaths(currentLibraryPath);

      // Load album to get current cover attachment
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) {
        return { success: false, error: 'Album not found' };
      }

      // Create new attachment for the cover
      const attachmentId = generateUUID();
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);
      fs.mkdirSync(attachmentFolder, { recursive: true });

      const filename = `cover${ext}`;
      const destPath = path.join(attachmentFolder, filename);
      fs.copyFileSync(sourcePath, destPath);

      // Generate both large (600x600) and small (80x80) thumbnails
      let hasThumbnail = false;
      let hasSmallThumbnail = false;
      try {
        const result = await generateThumbnails(destPath, attachmentFolder);
        hasThumbnail = result.large;
        hasSmallThumbnail = result.small;
      } catch (thumbErr) {
        console.error('Failed to generate thumbnails:', thumbErr.message);
      }

      // Write attachment metadata
      const metadata = {
        id: attachmentId,
        filename: filename,
        name: `${album.name} Cover`,
        type: 'image',
        hasThumbnail,
        hasSmallThumbnail,
        fileSize: fs.statSync(destPath).size,
        addedAt: new Date().toISOString(),
        linkedTo: [{ type: 'collection', id: albumId }]
      };
      fs.writeFileSync(
        path.join(attachmentFolder, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Update album to point to new cover
      album.cover = attachmentId;
      if (!album.attachments) {
        album.attachments = [];
      }
      if (!album.attachments.includes(attachmentId)) {
        album.attachments.push(attachmentId);
      }
      album.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, album);

      console.log('Updated cover for album:', albumId, '-> attachment:', attachmentId);
      return {
        success: true,
        coverPath: destPath,
        thumbnailPath: hasThumbnail ? thumbnailPath : destPath
      };
    } catch (err) {
      console.error('Error selecting cover:', err);
      return { success: false, error: err.message };
    }
  });

};
