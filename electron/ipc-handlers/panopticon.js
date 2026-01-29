/**
 * Panopticon IPC Handlers
 *
 * Full-screen asset management interface.
 * Provides comprehensive attachment listing with link data,
 * bulk link management, deletion, and Induction mode.
 */

const fs = require('fs');
const path = require('path');

module.exports = function registerPanopticonHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  getLibraryPaths,
  listAllAttachments,
  readAttachmentMetadata,
  listCollections,
  listAllTracks,
  readCollection,
  writeCollection,
  readTrackMetadata,
  writeTrackMetadata,
  // Import functions for Induction
  scanFolderForAudio,
  extractAudioMetadata,
  extractEmbeddedCover,
  findCoverArt,
  importAsNewAlbum,
  importToExistingAlbum,
  importSingleFile,
  importCoverFromFile,
  importCoverFromData,
  generateUUID,
  ledgers
}) {

  /**
   * Get all attachments with their link data
   * Returns enriched attachment objects with linkedTo and isCoverFor arrays
   */
  ipcMain.handle('panopticon:get-all-attachments', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return [];
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const rawAttachments = listAllAttachments(currentLibraryPath);
      const collections = listCollections(currentLibraryPath);
      const tracks = listAllTracks(currentLibraryPath);

      // Build reverse index: which entities reference each attachment
      const attachmentLinks = {}; // attachmentId -> { linkedTo: [], isCoverFor: [] }

      // Initialize for all attachments
      for (const att of rawAttachments) {
        attachmentLinks[att.id] = { linkedTo: [], isCoverFor: [] };
      }

      // Scan collections (records and mixtapes)
      for (const collection of collections) {
        const entityType = collection.type === 'mixtape' ? 'mixtape' : 'record';
        const entityName = collection.name || collection.title || collection.id;

        // Check attachments array
        if (collection.attachments) {
          for (const attId of collection.attachments) {
            if (attachmentLinks[attId]) {
              attachmentLinks[attId].linkedTo.push({
                type: entityType,
                id: collection.id,
                name: entityName
              });
            }
          }
        }

        // Check if attachment is the cover
        if (collection.cover && attachmentLinks[collection.cover]) {
          attachmentLinks[collection.cover].isCoverFor.push({
            type: entityType,
            id: collection.id,
            name: entityName
          });
        }

        // For mixtapes, also check coverImageId
        if (collection.coverImageId && attachmentLinks[collection.coverImageId]) {
          // Avoid duplicates if cover and coverImageId are the same
          const existing = attachmentLinks[collection.coverImageId].isCoverFor;
          if (!existing.some(e => e.id === collection.id)) {
            attachmentLinks[collection.coverImageId].isCoverFor.push({
              type: entityType,
              id: collection.id,
              name: entityName
            });
          }
        }
      }

      // Scan tracks
      for (const track of tracks) {
        if (track.attachments) {
          for (const attId of track.attachments) {
            if (attachmentLinks[attId]) {
              attachmentLinks[attId].linkedTo.push({
                type: 'track',
                id: track.id,
                name: track.title || track.id
              });
            }
          }
        }

        // Check if attachment is track cover
        if (track.cover && attachmentLinks[track.cover]) {
          attachmentLinks[track.cover].isCoverFor.push({
            type: 'track',
            id: track.id,
            name: track.title || track.id
          });
        }
      }

      // Enrich attachments with link data and paths
      const enrichedAttachments = rawAttachments.map(att => {
        const links = attachmentLinks[att.id] || { linkedTo: [], isCoverFor: [] };
        const attachmentFolder = path.join(paths.attachments, `${att.id}.info`);
        const filePath = path.join(attachmentFolder, att.filename);
        const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
        const hasThumb = fs.existsSync(thumbPath);

        return {
          id: att.id,
          filename: att.originalName || att.filename,
          type: att.mimeType || att.type,
          fileSize: att.size || att.fileSize,
          addedAt: att.dateAdded || att.addedAt,
          path: filePath,
          thumbnailPath: hasThumb ? thumbPath : null,
          linkedTo: links.linkedTo,
          isCoverFor: links.isCoverFor
        };
      });

      return enrichedAttachments;
    } catch (err) {
      console.error('[Panopticon] Error loading attachments:', err);
      return [];
    }
  });

  /**
   * Update links for attachment(s)
   * Add or remove links between attachments and records/mixtapes/tracks
   */
  ipcMain.handle('panopticon:update-links', async (event, {
    attachmentIds,
    action, // 'add' | 'remove'
    targetType, // 'record' | 'mixtape' | 'track'
    targetId
  }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);

      if (targetType === 'track') {
        // Handle track links
        const trackFolder = path.join(paths.tracks, `${targetId}.info`);
        if (!fs.existsSync(trackFolder)) {
          return { success: false, error: 'Track not found' };
        }

        const trackMeta = readTrackMetadata(trackFolder);
        if (!trackMeta) {
          return { success: false, error: 'Track metadata not found' };
        }

        trackMeta.attachments = trackMeta.attachments || [];

        for (const attId of attachmentIds) {
          if (action === 'add') {
            if (!trackMeta.attachments.includes(attId)) {
              trackMeta.attachments.push(attId);
            }
          } else if (action === 'remove') {
            trackMeta.attachments = trackMeta.attachments.filter(id => id !== attId);
          }
        }

        trackMeta.modifiedAt = new Date().toISOString();
        writeTrackMetadata(trackFolder, trackMeta);

      } else {
        // Handle collection (record/mixtape) links
        const collection = readCollection(currentLibraryPath, targetId);
        if (!collection) {
          return { success: false, error: `${targetType} not found` };
        }

        collection.attachments = collection.attachments || [];

        for (const attId of attachmentIds) {
          if (action === 'add') {
            if (!collection.attachments.includes(attId)) {
              collection.attachments.push(attId);
            }
          } else if (action === 'remove') {
            collection.attachments = collection.attachments.filter(id => id !== attId);
          }
        }

        collection.modifiedAt = new Date().toISOString();
        writeCollection(currentLibraryPath, collection);
      }

      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error updating links:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete attachment(s) permanently
   * Removes files from disk and cleans up all references
   */
  ipcMain.handle('panopticon:delete-attachments', async (event, { attachmentIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      let deletedCount = 0;

      // First, remove all references from collections and tracks
      const collections = listCollections(currentLibraryPath);
      const tracks = listAllTracks(currentLibraryPath);

      // Clean up collection references
      for (const collection of collections) {
        let modified = false;

        // Remove from attachments array
        if (collection.attachments) {
          const before = collection.attachments.length;
          collection.attachments = collection.attachments.filter(
            id => !attachmentIds.includes(id)
          );
          if (collection.attachments.length !== before) {
            modified = true;
          }
        }

        // Clear cover if it's being deleted
        if (collection.cover && attachmentIds.includes(collection.cover)) {
          collection.cover = null;
          modified = true;
        }

        // Clear coverImageId if it's being deleted
        if (collection.coverImageId && attachmentIds.includes(collection.coverImageId)) {
          collection.coverImageId = null;
          modified = true;
        }

        // Clear backdropImageId if it's being deleted
        if (collection.backdropImageId && attachmentIds.includes(collection.backdropImageId)) {
          collection.backdropImageId = null;
          modified = true;
        }

        if (modified) {
          collection.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, collection);
        }
      }

      // Clean up track references
      for (const track of tracks) {
        let modified = false;
        const trackFolder = path.join(paths.tracks, `${track.id}.info`);

        if (!fs.existsSync(trackFolder)) continue;

        const trackMeta = readTrackMetadata(trackFolder);
        if (!trackMeta) continue;

        // Remove from attachments array
        if (trackMeta.attachments) {
          const before = trackMeta.attachments.length;
          trackMeta.attachments = trackMeta.attachments.filter(
            id => !attachmentIds.includes(id)
          );
          if (trackMeta.attachments.length !== before) {
            modified = true;
          }
        }

        // Clear cover if it's being deleted
        if (trackMeta.cover && attachmentIds.includes(trackMeta.cover)) {
          trackMeta.cover = null;
          modified = true;
        }

        if (modified) {
          trackMeta.modifiedAt = new Date().toISOString();
          writeTrackMetadata(trackFolder, trackMeta);
        }
      }

      // Now delete the attachment folders
      for (const attId of attachmentIds) {
        const attachmentFolder = path.join(paths.attachments, `${attId}.info`);
        if (fs.existsSync(attachmentFolder)) {
          fs.rmSync(attachmentFolder, { recursive: true, force: true });
          deletedCount++;
          console.log('[Panopticon] Deleted attachment:', attId);
        }
      }

      return { success: true, deleted: deletedCount };
    } catch (err) {
      console.error('[Panopticon] Error deleting attachments:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all records for Panopticon grid
   * Returns records with cover art paths
   */
  ipcMain.handle('panopticon:get-all-records', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return [];
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const collections = listCollections(currentLibraryPath);

      // Filter to records only (not mixtapes)
      const records = collections.filter(c => c.type !== 'mixtape');

      return records.map(record => {
        // Get cover art path
        let coverPath = null;
        let thumbnailPath = null;

        if (record.cover) {
          const attachmentFolder = path.join(paths.attachments, `${record.cover}.info`);
          const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
          if (fs.existsSync(thumbPath)) {
            thumbnailPath = thumbPath;
          }
          // Try to get original file
          const metaPath = path.join(attachmentFolder, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.originalName) {
                const origPath = path.join(attachmentFolder, meta.originalName);
                if (fs.existsSync(origPath)) {
                  coverPath = origPath;
                }
              }
            } catch (e) {}
          }
        }

        // Get track IDs and count
        // Note: record.tracks is an array of { id, position } objects, not strings
        const trackRefs = record.tracks || [];
        const trackIds = trackRefs.map(ref => typeof ref === 'string' ? ref : ref.id).filter(Boolean);
        const trackCount = trackIds.length;

        // Get attachment IDs (including cover)
        const attachmentIds = [...(record.attachments || [])];
        if (record.cover && !attachmentIds.includes(record.cover)) {
          attachmentIds.push(record.cover);
        }

        return {
          id: record.id,
          entityType: 'record',
          title: record.name || record.title || 'Untitled',
          artist: record.artist || 'Unknown Artist',
          year: record.year || null,
          trackCount,
          trackIds, // Include track IDs for linked highlighting
          attachmentIds, // Include attachment IDs for linked highlighting
          addedAt: record.createdAt || record.addedAt,
          coverPath,
          thumbnailPath
        };
      });
    } catch (err) {
      console.error('[Panopticon] Error loading records:', err);
      return [];
    }
  });

  /**
   * Get all tracks for Panopticon grid
   * Returns tracks with album art paths
   */
  ipcMain.handle('panopticon:get-all-tracks', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return [];
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const tracks = listAllTracks(currentLibraryPath);
      const collections = listCollections(currentLibraryPath);

      // Build a map of track ID to parent record for album info
      // Note: collection.tracks is an array of { id, position } objects, not strings
      const trackToRecord = {};
      for (const collection of collections) {
        if (collection.type === 'mixtape') continue;
        if (collection.tracks) {
          for (const trackRef of collection.tracks) {
            // Handle both object format { id, position } and legacy string format
            const trackId = typeof trackRef === 'string' ? trackRef : trackRef.id;
            if (trackId) {
              trackToRecord[trackId] = collection;
            }
          }
        }
      }

      return tracks.map(track => {
        const parentRecord = trackToRecord[track.id];

        // Get album art path from parent record
        let thumbnailPath = null;
        if (parentRecord && parentRecord.cover) {
          const attachmentFolder = path.join(paths.attachments, `${parentRecord.cover}.info`);
          const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
          if (fs.existsSync(thumbPath)) {
            thumbnailPath = thumbPath;
          }
        }

        return {
          id: track.id,
          entityType: 'track',
          title: track.title || 'Untitled Track',
          artist: track.trackArtist || 'Unknown Artist',
          album: track.album || (parentRecord ? (parentRecord.name || parentRecord.title) : null),
          recordId: parentRecord ? parentRecord.id : null, // Include parent record ID for linked highlighting
          duration: track.duration || 0,
          plays: track.plays || 0,
          addedAt: track.createdAt || track.addedAt,
          thumbnailPath
        };
      });
    } catch (err) {
      console.error('[Panopticon] Error loading tracks:', err);
      return [];
    }
  });

  /**
   * Find a track by its audio path
   * Used to match a playing track to its Panopticon entry
   */
  ipcMain.handle('panopticon:find-track-by-path', async (event, { audioPath }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath || !audioPath) {
        return null;
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const tracks = listAllTracks(currentLibraryPath);

      // Check each track's audio file path
      for (const track of tracks) {
        const trackFolder = path.join(paths.tracks, `${track.id}.info`);
        const trackAudioPath = path.join(trackFolder, track.filename);

        if (trackAudioPath === audioPath) {
          return track.id;
        }
      }

      return null;
    } catch (err) {
      console.error('[Panopticon] Error finding track by path:', err);
      return null;
    }
  });

  /**
   * Search targets for linking (records, mixtapes, or tracks)
   * Used by the "Add Link" modals
   */
  ipcMain.handle('panopticon:search-targets', async (event, { targetType, query }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return [];
      }

      const lowerQuery = (query || '').toLowerCase();

      if (targetType === 'track') {
        const tracks = listAllTracks(currentLibraryPath);
        return tracks
          .filter(t => {
            if (!lowerQuery) return true;
            return (t.title || '').toLowerCase().includes(lowerQuery);
          })
          .slice(0, 50)
          .map(t => ({
            id: t.id,
            name: t.title || t.id,
            artist: t.artist
          }));

      } else {
        // Records or mixtapes
        const collections = listCollections(currentLibraryPath);
        return collections
          .filter(c => {
            if (targetType === 'record' && c.type === 'mixtape') return false;
            if (targetType === 'mixtape' && c.type !== 'mixtape') return false;
            if (!lowerQuery) return true;
            const name = c.name || c.title || '';
            return name.toLowerCase().includes(lowerQuery);
          })
          .slice(0, 50)
          .map(c => ({
            id: c.id,
            name: c.name || c.title || c.id,
            artist: c.artist
          }));
      }
    } catch (err) {
      console.error('[Panopticon] Error searching targets:', err);
      return [];
    }
  });

  /**
   * Open folder picker dialog for Induction
   */
  ipcMain.handle('dialog:open-folder', async (event, options = {}) => {
    if (!dialog) {
      console.error('[Panopticon] Dialog not available');
      return null;
    }

    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: options.title || 'Select folder',
        buttonLabel: options.buttonLabel || 'Select'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return {
        path: result.filePaths[0],
        name: path.basename(result.filePaths[0])
      };
    } catch (err) {
      console.error('[Panopticon] Error opening folder dialog:', err);
      return null;
    }
  });

  /**
   * Open DEPOSIT picker - can select images OR folders
   * Images become stray attachments, folders trigger induction
   */
  ipcMain.handle('dialog:deposit', async (event, options = {}) => {
    if (!dialog) {
      console.error('[Panopticon] Dialog not available');
      return null;
    }

    try {
      // On macOS, we can combine openFile and openDirectory with multiSelections
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        title: options.title || 'Deposit to Library',
        buttonLabel: options.buttonLabel || 'Deposit',
        filters: [
          { name: 'All Supported', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', '*'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      // Categorize all selected paths
      const folders = [];
      const files = [];

      for (const selectedPath of result.filePaths) {
        const stats = fs.statSync(selectedPath);
        if (stats.isDirectory()) {
          folders.push(selectedPath);
        } else if (stats.isFile()) {
          files.push(selectedPath);
        }
      }

      return {
        folders,
        files,
        // Legacy compatibility for single-item selection
        path: result.filePaths[0],
        name: path.basename(result.filePaths[0]),
        isDirectory: folders.length > 0 && files.length === 0,
        isFile: files.length > 0 && folders.length === 0
      };
    } catch (err) {
      console.error('[Panopticon] Error opening deposit dialog:', err);
      return null;
    }
  });

  /**
   * Open image file picker dialog
   * Used for selecting cover art in Induction mode
   */
  ipcMain.handle('dialog:open-image', async (event, options = {}) => {
    if (!dialog) {
      console.error('[Panopticon] Dialog not available');
      return null;
    }

    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: options.title || 'Select image',
        buttonLabel: options.buttonLabel || 'Select',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return {
        path: result.filePaths[0],
        name: path.basename(result.filePaths[0])
      };
    } catch (err) {
      console.error('[Panopticon] Error opening image dialog:', err);
      return null;
    }
  });

  /**
   * Analyze a folder for Induction
   * Returns discovered tracks, images, and suggested metadata
   *
   * Handles three cases:
   * 1. Album folder (audio files in folder or disc subfolders)
   * 2. Artist folder (multiple album subfolders)
   * 3. Empty or unknown structure
   */
  ipcMain.handle('panopticon:analyze-folder', async (event, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) {
        return { error: 'Folder not found' };
      }

      // First, scan for audio files (includes disc subfolders)
      // { sourcePath, filename, parsed, ext, discFromFolder }
      let audioFilesRaw = scanFolderForAudio ? scanFolderForAudio(folderPath) : [];

      // If no audio files found, check if this is an artist folder with album subfolders
      if (audioFilesRaw.length === 0) {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const subfolders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

        // Collect album subfolders that contain audio
        const albumSubfolders = [];
        for (const subfolder of subfolders) {
          const subPath = path.join(folderPath, subfolder.name);
          const subAudio = scanFolderForAudio ? scanFolderForAudio(subPath) : [];
          if (subAudio.length > 0) {
            albumSubfolders.push({
              path: subPath,
              name: subfolder.name,
              audioFiles: subAudio
            });
          }
        }

        // If we found album subfolders, this is an artist folder
        if (albumSubfolders.length > 0) {
          // Return a special response for artist folders
          const albumGroups = [];

          // Helper to scan images in a folder (including disc subfolders)
          const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
          const DISC_PATTERNS = [/^disc\s*\d+$/i, /^cd\s*\d+$/i, /^disk\s*\d+$/i, /^d\d+$/i];

          const scanImagesInFolder = (dirPath) => {
            const images = [];
            const seenPaths = new Set();

            const scan = (scanPath) => {
              try {
                const entries = fs.readdirSync(scanPath, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.name.startsWith('.')) continue;
                  const fullPath = path.join(scanPath, entry.name);

                  if (entry.isDirectory() && DISC_PATTERNS.some(p => p.test(entry.name.trim()))) {
                    scan(fullPath); // Recurse into disc folders
                  } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    const baseName = path.basename(entry.name, ext).toLowerCase();
                    if (IMAGE_EXTENSIONS.includes(ext) && !baseName.startsWith('thumbnail')) {
                      if (!seenPaths.has(fullPath)) {
                        seenPaths.add(fullPath);
                        images.push({ path: fullPath, filename: entry.name });
                      }
                    }
                  }
                }
              } catch (e) {
                // Ignore errors
              }
            };

            scan(dirPath);

            // Sort: cover-like names first
            const coverNames = ['cover', 'folder', 'front', 'album'];
            images.sort((a, b) => {
              const aLower = a.filename.toLowerCase();
              const bLower = b.filename.toLowerCase();
              const aIsCover = coverNames.some(n => aLower.includes(n));
              const bIsCover = coverNames.some(n => bLower.includes(n));
              if (aIsCover && !bIsCover) return -1;
              if (!aIsCover && bIsCover) return 1;
              return a.filename.localeCompare(b.filename);
            });

            return images;
          };

          for (const album of albumSubfolders) {
            let albumTitle = album.name;
            let albumArtist = '';
            let albumYear = '';

            // Extract metadata in parallel for speed (limit concurrency to avoid overwhelming I/O)
            const CONCURRENCY = 8;
            const metadataResults = [];

            for (let i = 0; i < album.audioFiles.length; i += CONCURRENCY) {
              const batch = album.audioFiles.slice(i, i + CONCURRENCY);
              const batchResults = await Promise.all(
                batch.map(async (audioFile) => {
                  try {
                    const metadata = await extractAudioMetadata(audioFile.sourcePath);
                    return { audioFile, metadata, error: null };
                  } catch (e) {
                    return { audioFile, metadata: null, error: e };
                  }
                })
              );
              metadataResults.push(...batchResults);
            }

            // Build tracks array from results
            const tracks = metadataResults.map(({ audioFile, metadata }) => {
              const disc = metadata?.discNumber || audioFile.discFromFolder || audioFile.parsed?.disc || 1;
              return {
                path: audioFile.sourcePath,
                filename: audioFile.filename,
                title: metadata?.title || path.basename(audioFile.sourcePath, path.extname(audioFile.sourcePath)),
                artist: metadata?.artist || '',
                album: metadata?.album || album.name,
                disc: disc,
                trackNumber: metadata?.trackNumber || audioFile.parsed?.trackNumber || 0,
                duration: metadata?.duration || 0,
                year: metadata?.year || ''
              };
            });

            // Get album metadata from first successful track
            for (const { metadata } of metadataResults) {
              if (metadata) {
                if (!albumArtist && metadata.albumArtist) albumArtist = metadata.albumArtist;
                if (!albumArtist && metadata.artist) albumArtist = metadata.artist;
                if (!albumTitle && metadata.album) albumTitle = metadata.album;
                if (!albumYear && metadata.year) albumYear = String(metadata.year);
                if (albumArtist && albumTitle) break; // Got what we need
              }
            }

            // Sort tracks
            tracks.sort((a, b) => {
              if (a.disc !== b.disc) return a.disc - b.disc;
              if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
              return a.filename.localeCompare(b.filename);
            });

            // Scan for images in this album folder
            let albumImages = scanImagesInFolder(album.path);

            // Try to extract embedded cover from first track
            let embeddedCover = null;
            if (album.audioFiles.length > 0 && extractEmbeddedCover) {
              try {
                const embedded = await extractEmbeddedCover(album.audioFiles[0].sourcePath);
                if (embedded && embedded.data) {
                  const base64 = embedded.data.toString('base64');
                  const mimeType = embedded.format || 'image/jpeg';
                  embeddedCover = {
                    path: '__embedded__',
                    filename: 'Embedded Cover (from audio)',
                    dataUrl: `data:${mimeType};base64,${base64}`,
                    isEmbedded: true
                  };
                }
              } catch (e) {
                // Ignore
              }
            }

            // Prepend embedded cover if found
            if (embeddedCover) {
              albumImages = [embeddedCover, ...albumImages];
            }

            albumGroups.push({
              albumArtist: albumArtist || path.basename(folderPath),
              album: albumTitle || album.name,
              year: albumYear,
              tracks,
              folderPath: album.path,
              images: albumImages
            });
          }

          // Check for duplicates in each album group
          let duplicateAlbums = [];
          try {
            const currentLibraryPath = getLibraryPath();
            if (currentLibraryPath) {
              const collections = listCollections(currentLibraryPath);
              const records = collections.filter(c => c.collectionType === 'record');

              for (const group of albumGroups) {
                const normalizedTitle = (group.album || '').toLowerCase().trim();
                const normalizedArtist = (group.albumArtist || '').toLowerCase().trim();

                for (const record of records) {
                  const recordTitle = (record.title || '').toLowerCase().trim();
                  const recordArtist = (record.artist || '').toLowerCase().trim();

                  if (recordTitle === normalizedTitle && recordArtist === normalizedArtist) {
                    group.matchingRecord = {
                      id: record.id,
                      title: record.title,
                      artist: record.artist,
                      trackCount: record.tracks?.length || 0
                    };
                    group.hasPotentialDuplicate = true;
                    duplicateAlbums.push(group);
                    break;
                  }
                }
              }
            }
          } catch (e) {
            console.error('[Panopticon] Error checking artist folder duplicates:', e.message);
          }

          return {
            folderPath,
            folderName: path.basename(folderPath),
            isArtistFolder: true,
            hasMultipleAlbums: true,
            albumGroups,
            suggestedArtist: path.basename(folderPath),
            tracks: [], // No loose tracks
            images: [], // No loose images at artist level
            // Aggregate duplicate info
            hasPotentialDuplicate: duplicateAlbums.length > 0,
            duplicateAlbums
          };
        }
      }

      // Extract metadata from audio files in parallel for speed
      const CONCURRENCY = 8;
      const metadataResults = [];

      for (let i = 0; i < audioFilesRaw.length; i += CONCURRENCY) {
        const batch = audioFilesRaw.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (audioFile) => {
            try {
              const metadata = await extractAudioMetadata(audioFile.sourcePath);
              return { audioFile, metadata, error: null };
            } catch (e) {
              return { audioFile, metadata: null, error: e };
            }
          })
        );
        metadataResults.push(...batchResults);
      }

      // Build tracks array and collect stats
      const tracks = [];
      let suggestedTitle = '';
      let suggestedArtist = '';
      let suggestedYear = '';
      const artistCounts = {};

      for (const { audioFile, metadata } of metadataResults) {
        // Disc priority: metadata > folder structure > filename parsing
        const disc = metadata?.discNumber || audioFile.discFromFolder || audioFile.parsed?.disc || 1;
        tracks.push({
          path: audioFile.sourcePath,
          filename: audioFile.filename,
          title: metadata?.title || path.basename(audioFile.sourcePath, path.extname(audioFile.sourcePath)),
          artist: metadata?.artist || '',
          album: metadata?.album || '',
          disc: disc,
          trackNumber: metadata?.trackNumber || audioFile.parsed?.trackNumber || 0,
          duration: metadata?.duration || 0,
          year: metadata?.year || ''
        });

        // Track artist frequency for compilation detection
        if (metadata?.artist) {
          artistCounts[metadata.artist] = (artistCounts[metadata.artist] || 0) + 1;
        }

        // Use first track's album as suggested title
        if (!suggestedTitle && metadata?.album) {
          suggestedTitle = metadata.album;
        }
        if (!suggestedYear && metadata?.year) {
          suggestedYear = String(metadata.year);
        }
      }

      // Sort tracks by disc number, then track number, then filename
      tracks.sort((a, b) => {
        // Parse disc from filename patterns like "1-01 Track Name" if not in metadata
        const discA = a.disc || 1;
        const discB = b.disc || 1;
        if (discA !== discB) return discA - discB;

        if (a.trackNumber && b.trackNumber) {
          return a.trackNumber - b.trackNumber;
        }
        return a.filename.localeCompare(b.filename);
      });

      // Detect multiple albums by grouping tracks by album name only
      // This correctly handles compilation albums where each track has a different artist
      // Tracks without album metadata become "stray candidates"
      const albumGroups = {};
      const strayCandidates = []; // Tracks with no album metadata

      for (const track of tracks) {
        if (track.album) {
          const key = track.album; // Use album name only, not artist+album
          if (!albumGroups[key]) {
            albumGroups[key] = {
              albumArtist: track.albumArtist || track.artist || '',
              album: track.album,
              year: track.year,
              tracks: []
            };
          }
          albumGroups[key].tracks.push(track);
          if (!albumGroups[key].year && track.year) {
            albumGroups[key].year = track.year;
          }
          // For compilations, first artist wins for display purposes
        } else {
          // Track has no album metadata - it's a stray candidate
          strayCandidates.push(track);
        }
      }

      const albumGroupArray = Object.values(albumGroups);
      const hasMultipleAlbums = albumGroupArray.length > 1;

      // Determine suggested artist (most common, or check for compilation)
      const artistList = Object.entries(artistCounts);
      const isLikelyCompilation = artistList.length > 3;

      if (artistList.length > 0) {
        artistList.sort((a, b) => b[1] - a[1]);
        suggestedArtist = artistList[0][0];
      }

      // Fallback title to folder name
      if (!suggestedTitle) {
        suggestedTitle = path.basename(folderPath);
      }

      // Check for duplicate records in the library
      let matchingRecord = null;
      let hasPotentialDuplicate = false;
      let duplicateAlbums = [];
      try {
        const currentLibraryPath = getLibraryPath();
        if (currentLibraryPath) {
          const collections = listCollections(currentLibraryPath);
          const records = collections.filter(c => c.collectionType === 'record');

          // If we have multiple albums, check each album group for duplicates
          if (hasMultipleAlbums && albumGroupArray.length > 0) {
            for (const group of albumGroupArray) {
              const normalizedTitle = (group.album || '').toLowerCase().trim();
              const normalizedArtist = (group.albumArtist || '').toLowerCase().trim();

              for (const record of records) {
                const recordTitle = (record.title || '').toLowerCase().trim();
                const recordArtist = (record.artist || '').toLowerCase().trim();

                if (recordTitle === normalizedTitle && recordArtist === normalizedArtist) {
                  group.matchingRecord = {
                    id: record.id,
                    title: record.title,
                    artist: record.artist,
                    trackCount: record.tracks?.length || 0
                  };
                  group.hasPotentialDuplicate = true;
                  duplicateAlbums.push(group);
                  hasPotentialDuplicate = true;
                  break;
                }
              }
            }
          } else {
            // Single album - check suggested title/artist
            const normalizedTitle = (suggestedTitle || '').toLowerCase().trim();
            const normalizedArtist = (suggestedArtist || '').toLowerCase().trim();

            for (const record of records) {
              const recordTitle = (record.title || '').toLowerCase().trim();
              const recordArtist = (record.artist || '').toLowerCase().trim();

              if (recordTitle === normalizedTitle && recordArtist === normalizedArtist) {
                matchingRecord = {
                  id: record.id,
                  title: record.title,
                  artist: record.artist,
                  trackCount: record.tracks?.length || 0
                };
                hasPotentialDuplicate = true;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.error('[Panopticon] Error checking for duplicates:', e.message);
      }

      // Scan for images (excluding thumbnails) and text ephemera
      // Also check disc subfolders for images/text
      const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const TEXT_EXTENSIONS = ['.txt', '.md', '.rtf'];
      const DISC_PATTERNS = [/^disc\s*\d+$/i, /^cd\s*\d+$/i, /^disk\s*\d+$/i, /^d\d+$/i];
      const images = [];
      const textFiles = [];
      const seenImagePaths = new Set(); // Avoid duplicates

      const scanForEphemera = (dirPath) => {
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            // Skip hidden files
            if (entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
              // Recurse into disc subfolders only
              if (DISC_PATTERNS.some(p => p.test(entry.name.trim()))) {
                scanForEphemera(fullPath);
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              const baseName = path.basename(entry.name, ext).toLowerCase();

              if (IMAGE_EXTENSIONS.includes(ext) && !baseName.startsWith('thumbnail')) {
                if (!seenImagePaths.has(fullPath)) {
                  seenImagePaths.add(fullPath);
                  images.push({
                    path: fullPath,
                    filename: entry.name
                  });
                }
              } else if (TEXT_EXTENSIONS.includes(ext)) {
                // Read preview of text content
                let preview = '';
                try {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  preview = content.slice(0, 200);
                  if (content.length > 200) preview += '...';
                } catch (e) {
                  preview = '(unable to preview)';
                }
                textFiles.push({
                  path: fullPath,
                  filename: entry.name,
                  type: ext.slice(1), // 'txt', 'md', or 'rtf'
                  preview
                });
              }
            }
          }
        } catch (e) {
          console.error('[Panopticon] Error scanning for ephemera in:', dirPath, e.message);
        }
      };

      scanForEphemera(folderPath);

      // Try to extract embedded cover from first audio file
      let embeddedCover = null;
      if (audioFilesRaw.length > 0 && extractEmbeddedCover) {
        try {
          const embedded = await extractEmbeddedCover(audioFilesRaw[0].sourcePath);
          if (embedded && embedded.data) {
            // Convert to base64 data URL for frontend display
            const base64 = embedded.data.toString('base64');
            const mimeType = embedded.format || 'image/jpeg';
            embeddedCover = {
              path: '__embedded__', // Special marker
              filename: 'Embedded Cover (from audio)',
              dataUrl: `data:${mimeType};base64,${base64}`,
              isEmbedded: true
            };
          }
        } catch (e) {
          console.error('[Panopticon] Error extracting embedded cover:', e);
        }
      }

      // Add embedded cover to front of images list if found
      if (embeddedCover) {
        images.unshift(embeddedCover);
      }

      // Sort file images - prioritize cover-like names (embedded already at front)
      const fileImages = images.filter(img => !img.isEmbedded);
      fileImages.sort((a, b) => {
        const aLower = a.filename.toLowerCase();
        const bLower = b.filename.toLowerCase();
        const coverNames = ['cover', 'folder', 'front', 'album'];

        const aIsCover = coverNames.some(n => aLower.includes(n));
        const bIsCover = coverNames.some(n => bLower.includes(n));

        if (aIsCover && !bIsCover) return -1;
        if (!aIsCover && bIsCover) return 1;
        return a.filename.localeCompare(b.filename);
      });

      // Rebuild images array with embedded first, then sorted file images
      const sortedImages = embeddedCover
        ? [embeddedCover, ...fileImages]
        : fileImages;

      return {
        folderPath,
        folderName: path.basename(folderPath),
        tracks,
        images: sortedImages,
        textFiles, // Text ephemera (.txt, .md, .rtf)
        suggestedTitle,
        suggestedArtist,
        suggestedYear,
        isLikelyCompilation,
        // Multi-album detection
        hasMultipleAlbums,
        albumGroups: hasMultipleAlbums ? albumGroupArray : null,
        // Stray candidates (tracks with no album metadata)
        strayCandidates,
        hasStrayCandidates: strayCandidates.length > 0,
        // Duplicate detection
        matchingRecord,
        hasPotentialDuplicate,
        duplicateAlbums: duplicateAlbums.length > 0 ? duplicateAlbums : null
      };
    } catch (err) {
      console.error('[Panopticon] Error analyzing folder:', err);
      return { error: err.message };
    }
  });

  /**
   * Analyze loose audio files (not in a folder)
   * Groups by Album Artist + Album, returns grouped analysis
   */
  ipcMain.handle('panopticon:analyze-files', async (event, filePaths) => {
    try {
      if (!filePaths || filePaths.length === 0) {
        return { error: 'No files provided' };
      }

      const groups = {}; // Key: album name -> { tracks, albumArtist, album }
      const ungrouped = []; // Tracks with no album metadata

      for (const filePath of filePaths) {
        try {
          const metadata = await extractAudioMetadata(filePath);
          const track = {
            path: filePath,
            filename: path.basename(filePath),
            title: metadata?.title || path.basename(filePath, path.extname(filePath)),
            artist: metadata?.artist || '',
            albumArtist: metadata?.albumArtist || metadata?.artist || '',
            album: metadata?.album || '',
            disc: metadata?.discNumber || 1,
            trackNumber: metadata?.trackNumber || 0,
            duration: metadata?.duration || 0,
            year: metadata?.year || ''
          };

          // Group by album name only (handles compilations correctly)
          if (track.album) {
            const key = track.album;
            if (!groups[key]) {
              groups[key] = {
                albumArtist: track.albumArtist,
                album: track.album,
                year: track.year,
                tracks: []
              };
            }
            groups[key].tracks.push(track);
            // Update year if not set
            if (!groups[key].year && track.year) {
              groups[key].year = track.year;
            }
          } else {
            ungrouped.push(track);
          }
        } catch (e) {
          // Add file even if metadata extraction fails
          ungrouped.push({
            path: filePath,
            filename: path.basename(filePath),
            title: path.basename(filePath, path.extname(filePath)),
            artist: '',
            albumArtist: '',
            album: '',
            disc: 1,
            trackNumber: 0,
            duration: 0
          });
        }
      }

      // Sort tracks within each group by disc, then track number
      for (const key in groups) {
        groups[key].tracks.sort((a, b) => {
          if (a.disc !== b.disc) return a.disc - b.disc;
          if (a.trackNumber && b.trackNumber) return a.trackNumber - b.trackNumber;
          return a.filename.localeCompare(b.filename);
        });
      }

      // Convert groups object to array
      const groupArray = Object.values(groups);

      return {
        groups: groupArray,
        ungrouped,
        totalFiles: filePaths.length,
        isSingleTrack: filePaths.length === 1
      };
    } catch (err) {
      console.error('[Panopticon] Error analyzing files:', err);
      return { error: err.message };
    }
  });

  /**
   * Add track(s) to an existing record
   */
  ipcMain.handle('panopticon:add-to-record', async (event, { recordId, trackPaths }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // Use the proper import function that handles all the metadata
      const files = trackPaths.map(filePath => ({ filePath }));
      const result = await importToExistingAlbum(files, record, currentLibraryPath);

      if (result.success) {
        return { success: true, trackCount: result.trackCount };
      } else {
        return { success: false, error: result.errors?.[0]?.error || 'Import failed' };
      }
    } catch (err) {
      console.error('[Panopticon] Error adding tracks to record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Create a new single-track record from a loose file
   */
  ipcMain.handle('panopticon:deposit-single-track', async (event, {
    trackPath,
    title,
    artist,
    year,
    coverPath
  }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const metadata = await extractAudioMetadata(trackPath);

      // Create album group for importAsNewAlbum
      const albumGroup = {
        album: title,
        artist: artist,
        files: [{
          filePath: trackPath,
          metadata: metadata
        }]
      };

      const result = await importAsNewAlbum(albumGroup, currentLibraryPath, {});

      if (result && result.albumId) {
        // Update with year if provided
        if (year) {
          const album = readCollection(currentLibraryPath, result.albumId);
          if (album) {
            album.year = year;
            album.modifiedAt = new Date().toISOString();
            writeCollection(currentLibraryPath, album);
          }
        }

        // Handle cover if specified
        if (coverPath && coverPath !== '__embedded__') {
          try {
            const newCoverId = await importCoverFromFile(coverPath, result.albumId, title, paths);
            if (newCoverId) {
              const album = readCollection(currentLibraryPath, result.albumId);
              if (album) {
                album.cover = newCoverId;
                album.attachments = album.attachments || [];
                if (!album.attachments.includes(newCoverId)) {
                  album.attachments.push(newCoverId);
                }
                album.modifiedAt = new Date().toISOString();
                writeCollection(currentLibraryPath, album);
              }
            }
          } catch (coverErr) {
            console.error('[Panopticon] Failed to import cover:', coverErr);
          }
        }

        return { success: true, recordId: result.albumId };
      }

      return { success: false, error: 'Failed to create record' };
    } catch (err) {
      console.error('[Panopticon] Error depositing single track:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Execute Induction - import folder as new record
   */
  ipcMain.handle('panopticon:deposit', async (event, depositData) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);

      const {
        folderPath,
        title,
        artist,
        year,
        isCompilation,
        coverPath,
        coverIsEmbedded,
        trackOrder,
        importImages,
        importTextFiles
      } = depositData;

      // Build the albumGroup structure that importAsNewAlbum expects
      // It needs: album, artist, files[].filePath, files[].metadata
      const albumGroup = {
        album: title,
        artist: isCompilation ? 'Various Artists' : artist,
        files: []
      };

      // For each track, we need to extract metadata for importAsNewAlbum
      for (const trackPath of trackOrder) {
        const metadata = await extractAudioMetadata(trackPath);
        albumGroup.files.push({
          filePath: trackPath,
          metadata: metadata
        });
      }

      // Use the importAsNewAlbum function
      const result = await importAsNewAlbum(
        albumGroup,
        currentLibraryPath,
        {
          onProgress: (progress) => {
            event.sender.send('induction-progress', progress);
          }
        }
      );

      if (result && result.albumId) {
        // If user selected a specific cover (not the default embedded from first file),
        // we need to import it and update the album
        if (coverPath && coverPath !== '__embedded__') {
          // User selected a file-based cover
          try {
            const newCoverId = await importCoverFromFile(coverPath, result.albumId, title, paths);
            if (newCoverId) {
              // Update album with new cover
              const album = readCollection(currentLibraryPath, result.albumId);
              if (album) {
                album.cover = newCoverId;
                album.attachments = album.attachments || [];
                if (!album.attachments.includes(newCoverId)) {
                  album.attachments.push(newCoverId);
                }
                album.modifiedAt = new Date().toISOString();
                writeCollection(currentLibraryPath, album);
              }
            }
          } catch (coverErr) {
            console.error('[Panopticon] Failed to import selected cover:', coverErr);
            // Continue anyway - album was created, just with default cover
          }
        }
        // If coverPath is '__embedded__' or not set, importAsNewAlbum already handled it

        // Import text ephemera and attach to record
        if (importTextFiles && importTextFiles.length > 0) {
          const album = readCollection(currentLibraryPath, result.albumId);
          if (album) {
            album.attachments = album.attachments || [];
            for (const textPath of importTextFiles) {
              try {
                const filename = path.basename(textPath);
                const ext = path.extname(filename).toLowerCase();

                // Create attachment folder
                const attachmentId = generateUUID();
                const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);
                fs.mkdirSync(attachmentFolder, { recursive: true });

                // Copy the text file
                const destPath = path.join(attachmentFolder, filename);
                fs.copyFileSync(textPath, destPath);

                // Determine mime type
                let mimeType = 'text/plain';
                if (ext === '.md') mimeType = 'text/markdown';
                else if (ext === '.rtf') mimeType = 'application/rtf';

                // Write attachment metadata
                const metadata = {
                  id: attachmentId,
                  originalName: filename,
                  mimeType,
                  size: fs.statSync(destPath).size,
                  dateAdded: new Date().toISOString(),
                  importSource: textPath
                };
                fs.writeFileSync(
                  path.join(attachmentFolder, 'metadata.json'),
                  JSON.stringify(metadata, null, 2)
                );

                // Link to album
                if (!album.attachments.includes(attachmentId)) {
                  album.attachments.push(attachmentId);
                }
                console.log('[Panopticon] Imported text ephemera:', filename);
              } catch (textErr) {
                console.error('[Panopticon] Failed to import text file:', textPath, textErr);
              }
            }
            album.modifiedAt = new Date().toISOString();
            writeCollection(currentLibraryPath, album);
          }
        }

        return { success: true, recordId: result.albumId };
      } else {
        return { success: false, error: 'Failed to create record' };
      }
    } catch (err) {
      console.error('[Panopticon] Deposit error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all mixtapes for Panopticon grid
   * Returns mixtapes with cover/cassette info
   */
  ipcMain.handle('panopticon:get-all-mixtapes', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return [];
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const collections = listCollections(currentLibraryPath);

      // Filter to mixtapes only
      const mixtapes = collections.filter(c => c.type === 'mixtape');

      return mixtapes.map(mixtape => {
        // Get cover art path if custom cover exists
        let thumbnailPath = null;
        if (mixtape.coverImageId) {
          const attachmentFolder = path.join(paths.attachments, `${mixtape.coverImageId}.info`);
          const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
          if (fs.existsSync(thumbPath)) {
            thumbnailPath = thumbPath;
          }
        }

        // Count tracks
        const trackCount = mixtape.tracks ? mixtape.tracks.length : 0;

        // Calculate total duration if we have track data
        let totalDuration = 0;
        if (mixtape.tracks) {
          for (const trackRef of mixtape.tracks) {
            const trackFolder = path.join(paths.tracks, `${trackRef.id}.info`);
            const trackMeta = readTrackMetadata(trackFolder);
            if (trackMeta && trackMeta.duration) {
              totalDuration += trackMeta.duration;
            }
          }
        }

        return {
          id: mixtape.id,
          entityType: 'mixtape',
          title: mixtape.name || 'Untitled Mixtape',
          trackCount,
          totalDuration,
          cassetteIndex: mixtape.cassetteIndex || 0,
          addedAt: mixtape.createdAt,
          thumbnailPath
        };
      });
    } catch (err) {
      console.error('[Panopticon] Error loading mixtapes:', err);
      return [];
    }
  });

  /**
   * Import text file as an attachment (ephemera)
   * Stores the file and links it to a record if specified
   */
  ipcMain.handle('panopticon:import-text', async (event, { filePath, recordId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();

      // Create attachment folder
      const attachmentId = generateUUID();
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);
      fs.mkdirSync(attachmentFolder, { recursive: true });

      // Copy the text file
      const destPath = path.join(attachmentFolder, filename);
      fs.copyFileSync(filePath, destPath);

      // Determine mime type
      let mimeType = 'text/plain';
      if (ext === '.md') mimeType = 'text/markdown';
      else if (ext === '.rtf') mimeType = 'application/rtf';

      // Write attachment metadata
      const metadata = {
        id: attachmentId,
        originalName: filename,
        mimeType,
        size: fs.statSync(destPath).size,
        dateAdded: new Date().toISOString(),
        importSource: filePath
      };
      fs.writeFileSync(
        path.join(attachmentFolder, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Link to record if specified
      if (recordId) {
        const record = readCollection(currentLibraryPath, recordId);
        if (record) {
          record.attachments = record.attachments || [];
          if (!record.attachments.includes(attachmentId)) {
            record.attachments.push(attachmentId);
          }
          record.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, record);
        }
      }

      return { success: true, id: attachmentId };
    } catch (err) {
      console.error('[Panopticon] Error importing text file:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Phase 4: Record/Track/Mixtape Update Handlers
  // ============================================

  /**
   * Update record metadata
   * Partial update - only provided fields change
   */
  ipcMain.handle('panopticon:update-record', async (event, { recordId, updates }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // Apply updates (only provided fields)
      const allowedFields = [
        'name', 'sortName', 'artist', 'sortArtist', 'albumArtist',
        'releaseDate', 'year', 'genre',
        'format', 'characteristics', // New format/characteristics model
        'isCompilation', 'isSoundtrack', 'isLP', 'isComposerWork', // Legacy booleans (kept for compatibility)
        'visibility', 'showOnGrid', // showOnGrid for subordinate records to appear in grid
        'cover', 'backdropImageId', 'backdropBlur', 'useArtAsBackdrop',
        'includeInLedgers'
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          record[field] = updates[field];
        }
      }

      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Updated record:', recordId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error updating record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Update track metadata
   * Partial update - only provided fields change
   */
  ipcMain.handle('panopticon:update-track', async (event, { trackId, updates }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const trackFolder = path.join(paths.tracks, `${trackId}.info`);

      if (!fs.existsSync(trackFolder)) {
        return { success: false, error: 'Track not found' };
      }

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) {
        return { success: false, error: 'Track metadata not found' };
      }

      // Apply updates (only provided fields)
      const allowedFields = [
        'title', 'sortTitle', 'trackArtist', 'albumArtist', 'album',
        'disc', 'trackNumber',
        'includeInLedgers',
        'lyrics', 'notes'
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          trackMeta[field] = updates[field];
        }
      }

      trackMeta.modifiedAt = new Date().toISOString();
      writeTrackMetadata(trackFolder, trackMeta);

      // If disc or trackNumber changed, update position in parent record
      if (updates.disc !== undefined || updates.trackNumber !== undefined) {
        const albumId = trackMeta.albumId;
        if (albumId) {
          const record = readCollection(currentLibraryPath, albumId);
          if (record && record.tracks) {
            const trackIndex = record.tracks.findIndex(t => t.id === trackId);
            if (trackIndex !== -1) {
              // Position = disc * 1000 + trackNumber
              const disc = trackMeta.disc || 1;
              const trackNum = trackMeta.trackNumber || 1;
              record.tracks[trackIndex].position = disc * 1000 + trackNum;
              writeCollection(currentLibraryPath, albumId, record);
              console.log('[Panopticon] Updated position in parent record:', albumId);
            }
          }
        }
      }

      console.log('[Panopticon] Updated track:', trackId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error updating track:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Update mixtape metadata
   * Partial update - only provided fields change
   */
  ipcMain.handle('panopticon:update-mixtape', async (event, { mixtapeId, updates }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      // Apply updates (only provided fields)
      const allowedFields = [
        'name', 'description',
        'cassetteIndex', 'coverImageId',
        'backdropImageId', 'backdropBlur', 'useBackgroundImage'
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          mixtape[field] = updates[field];
        }
      }

      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      console.log('[Panopticon] Updated mixtape:', mixtapeId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error updating mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Reorder tracks within a record
   */
  ipcMain.handle('panopticon:reorder-tracks', async (event, { recordId, trackOrder }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // trackOrder is an array of { trackId, disc, position }
      // We rebuild the tracks array with new positions
      const newTracks = trackOrder.map(item => ({
        id: item.trackId,
        position: item.disc * 1000 + item.position // Encode as disc*1000 + position
      }));

      record.tracks = newTracks;
      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Reordered tracks for record:', recordId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error reordering tracks:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Add tracks to a record
   * Tracks can only belong to one record, so this removes them from any previous record first
   */
  ipcMain.handle('panopticon:add-tracks-to-record', async (event, { recordId, trackIds, disc, position }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // First, remove these tracks from any other records they belong to
      // (tracks can only belong to one record)
      const collections = listCollections(currentLibraryPath);
      for (const coll of collections) {
        if (coll.id === recordId) continue; // Skip target record
        if (coll.type !== 'album') continue; // Only check albums

        const hasTrack = coll.tracks?.some(t => trackIds.includes(t.id));
        if (hasTrack) {
          coll.tracks = coll.tracks.filter(t => !trackIds.includes(t.id));
          coll.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, coll);
          console.log('[Panopticon] Removed tracks from previous record:', coll.id);
        }
      }

      record.tracks = record.tracks || [];
      const targetDisc = disc || 1;

      // Find max position in target disc
      let maxPosition = 0;
      for (const t of record.tracks) {
        const tDisc = Math.floor(t.position / 1000);
        const tPos = t.position % 1000;
        if (tDisc === targetDisc && tPos > maxPosition) {
          maxPosition = tPos;
        }
      }

      // Add tracks at the end of the disc (or at specified position)
      const paths = getLibraryPaths(currentLibraryPath);
      let insertPosition = position || (maxPosition + 1);
      for (const trackId of trackIds) {
        // Check if track already in record
        if (!record.tracks.some(t => t.id === trackId)) {
          record.tracks.push({
            id: trackId,
            position: targetDisc * 1000 + insertPosition
          });
          insertPosition++;
        }

        // Update the track's metadata to reflect new parent record
        const trackFolder = path.join(paths.tracks, `${trackId}.info`);
        const trackMeta = readTrackMetadata(trackFolder);
        if (trackMeta) {
          trackMeta.albumId = recordId;
          trackMeta.albumArtist = record.artist;
          trackMeta.album = record.name || record.title;
          fs.writeFileSync(
            path.join(trackFolder, 'metadata.json'),
            JSON.stringify(trackMeta, null, 2)
          );
        }
      }

      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Added tracks to record:', recordId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error adding tracks to record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Remove track from record (doesn't delete track - makes it a stray)
   */
  ipcMain.handle('panopticon:remove-track-from-record', async (event, { recordId, trackId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      record.tracks = (record.tracks || []).filter(t => t.id !== trackId);
      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      // Update the track's metadata to clear parent record (becomes a stray)
      const trackFolder = path.join(paths.tracks, `${trackId}.info`);
      const trackMeta = readTrackMetadata(trackFolder);
      if (trackMeta) {
        trackMeta.albumId = null;
        // Keep albumArtist and album for display purposes (track remembers where it came from)
        fs.writeFileSync(
          path.join(trackFolder, 'metadata.json'),
          JSON.stringify(trackMeta, null, 2)
        );
      }

      console.log('[Panopticon] Removed track from record:', trackId, 'from', recordId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error removing track from record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete record from library
   * @param {string} recordId - The record to delete
   * @param {boolean} deleteTracksFromDisk - If true, also delete track audio files from disk
   */
  ipcMain.handle('panopticon:delete-record', async (event, { recordId, deleteTracksFromDisk = false }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const collectionPath = path.join(paths.collections, `${recordId}.json`);

      if (!fs.existsSync(collectionPath)) {
        return { success: false, error: 'Record not found' };
      }

      // Read the record first to check it exists and is a record
      const record = readCollection(currentLibraryPath, recordId);
      if (!record || record.type === 'mixtape') {
        return { success: false, error: 'Not a record' };
      }

      // If deleteTracksFromDisk is true, delete all track files and metadata
      if (deleteTracksFromDisk && record.tracks && record.tracks.length > 0) {
        for (const track of record.tracks) {
          const trackFolder = path.join(paths.tracks, `${track.id}.info`);
          if (fs.existsSync(trackFolder)) {
            // Read track metadata for the file path
            const trackMeta = readTrackMetadata(trackFolder);

            // Delete the audio file if it exists
            if (trackMeta && trackMeta.filePath && fs.existsSync(trackMeta.filePath)) {
              fs.unlinkSync(trackMeta.filePath);
              console.log('[Panopticon] Deleted audio file:', trackMeta.filePath);
            }

            // Delete the track metadata folder
            fs.rmSync(trackFolder, { recursive: true, force: true });
            console.log('[Panopticon] Deleted track metadata:', track.id);
          }
        }
      }

      // Delete the collection file
      fs.unlinkSync(collectionPath);

      // Note: if deleteTracksFromDisk is false, tracks become orphaned (strays)
      // They can be found via the "Strays" filter in Panopticon
      // Attachments are also NOT deleted, just become unlinked

      console.log('[Panopticon] Deleted record:', recordId, deleteTracksFromDisk ? '(with tracks from disk)' : '(tracks kept as strays)');
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error deleting record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete track from library
   */
  ipcMain.handle('panopticon:delete-track', async (event, { trackId, deleteFile = false }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const trackFolder = path.join(paths.tracks, `${trackId}.info`);

      if (!fs.existsSync(trackFolder)) {
        return { success: false, error: 'Track not found' };
      }

      // Read track metadata for the file path
      const trackMeta = readTrackMetadata(trackFolder);

      // Remove track from all records
      const collections = listCollections(currentLibraryPath);
      for (const collection of collections) {
        if (collection.tracks && collection.tracks.some(t => t.id === trackId)) {
          collection.tracks = collection.tracks.filter(t => t.id !== trackId);
          collection.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, collection);
        }
      }

      // Delete the track metadata folder
      fs.rmSync(trackFolder, { recursive: true, force: true });

      // Optionally delete the audio file
      if (deleteFile && trackMeta && trackMeta.filePath) {
        if (fs.existsSync(trackMeta.filePath)) {
          fs.unlinkSync(trackMeta.filePath);
          console.log('[Panopticon] Deleted audio file:', trackMeta.filePath);
        }
      }

      // Reset ledger stats for this track
      if (ledgers) {
        ledgers.resetTrackStats(trackId);
      }

      console.log('[Panopticon] Deleted track:', trackId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error deleting track:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Bulk delete tracks from library
   * Removes tracks from all records, deletes metadata, optionally deletes audio files,
   * and clears listening history from ledgers
   */
  ipcMain.handle('panopticon:delete-tracks', async (event, { trackIds, deleteFiles = false }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      let deletedCount = 0;

      // Load all collections once for efficiency
      const collections = listCollections(currentLibraryPath);
      const modifiedCollections = new Set();

      // Process each track
      for (const trackId of trackIds) {
        const trackFolder = path.join(paths.tracks, `${trackId}.info`);

        if (!fs.existsSync(trackFolder)) {
          console.log('[Panopticon] Track not found, skipping:', trackId);
          continue;
        }

        // Read track metadata for the file path
        const trackMeta = readTrackMetadata(trackFolder);

        // Remove track from all records
        for (const collection of collections) {
          if (collection.tracks && collection.tracks.some(t => t.id === trackId)) {
            collection.tracks = collection.tracks.filter(t => t.id !== trackId);
            collection.modifiedAt = new Date().toISOString();
            modifiedCollections.add(collection.id);
          }
        }

        // Delete the track metadata folder
        fs.rmSync(trackFolder, { recursive: true, force: true });

        // Optionally delete the audio file
        if (deleteFiles && trackMeta && trackMeta.filePath) {
          if (fs.existsSync(trackMeta.filePath)) {
            fs.unlinkSync(trackMeta.filePath);
            console.log('[Panopticon] Deleted audio file:', trackMeta.filePath);
          }
        }

        // Reset ledger stats for this track
        if (ledgers) {
          ledgers.resetTrackStats(trackId);
        }

        deletedCount++;
      }

      // Write all modified collections
      for (const collection of collections) {
        if (modifiedCollections.has(collection.id)) {
          writeCollection(currentLibraryPath, collection);
        }
      }

      console.log(`[Panopticon] Bulk deleted ${deletedCount} tracks`);
      return { success: true, deleted: deletedCount };
    } catch (err) {
      console.error('[Panopticon] Error bulk deleting tracks:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Era linking - set a record's vessel (parent)
   */
  ipcMain.handle('panopticon:link-era', async (event, { recordId, vesselId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const record = readCollection(currentLibraryPath, recordId);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // If we had a previous vessel, remove this from its children
      if (record.eraParent && record.eraParent !== vesselId) {
        const oldVessel = readCollection(currentLibraryPath, record.eraParent);
        if (oldVessel) {
          oldVessel.eraChildren = (oldVessel.eraChildren || []).filter(id => id !== recordId);
          oldVessel.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, oldVessel);
        }
      }

      // Set new vessel (or clear if null)
      record.eraParent = vesselId || null;
      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      // Add this record to new vessel's children
      if (vesselId) {
        const vessel = readCollection(currentLibraryPath, vesselId);
        if (vessel) {
          vessel.eraChildren = vessel.eraChildren || [];
          if (!vessel.eraChildren.includes(recordId)) {
            vessel.eraChildren.push(recordId);
          }
          vessel.modifiedAt = new Date().toISOString();
          writeCollection(currentLibraryPath, vessel);
        }
      }

      console.log('[Panopticon] Linked era:', recordId, 'to vessel:', vesselId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error linking era:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Reorder subordinate records (eraChildren) on a vessel
   */
  ipcMain.handle('panopticon:reorder-subordinates', async (event, { vesselId, childIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const vessel = readCollection(currentLibraryPath, vesselId);
      if (!vessel) {
        return { success: false, error: 'Vessel not found' };
      }

      // Validate that all childIds are actually children of this vessel
      const currentChildren = new Set(vessel.eraChildren || []);
      for (const id of childIds) {
        if (!currentChildren.has(id)) {
          return { success: false, error: `Record ${id} is not a child of this vessel` };
        }
      }

      // Update the order
      vessel.eraChildren = childIds;
      vessel.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, vessel);

      console.log('[Panopticon] Reordered subordinates for vessel:', vesselId);
      return { success: true };
    } catch (err) {
      console.error('[Panopticon] Error reordering subordinates:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Create a new empty record (Nascent Sleeve)
   * Creates a blank record with just name and artist for user to populate
   */
  ipcMain.handle('panopticon:create-record', async (event, { name, artist }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const recordId = generateUUID();
      const now = new Date().toISOString();

      const record = {
        id: recordId,
        type: 'album',
        name: name,
        artist: artist,
        releaseDate: null,
        genre: null,
        isLP: true,
        eraParent: null,
        eraChildren: [],
        cover: null,
        rating: null,
        discLabels: {},
        attachments: [],
        createdAt: now,
        modifiedAt: now,
        tracks: []
      };

      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Created new record (Nascent Sleeve):', recordId, name);
      return { success: true, recordId };
    } catch (err) {
      console.error('[Panopticon] Error creating record:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get full record data for detail panel
   * Returns complete record with enriched track data
   */
  ipcMain.handle('panopticon:get-record-detail', async (event, { recordId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const record = readCollection(currentLibraryPath, recordId);

      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // Enrich with track data
      const tracks = (record.tracks || []).map(trackRef => {
        const trackFolder = path.join(paths.tracks, `${trackRef.id}.info`);
        const trackMeta = readTrackMetadata(trackFolder);

        if (trackMeta) {
          // Prefer track metadata for disc/trackNumber (allows editing)
          // Fall back to position-derived values if metadata is missing
          const positionDisc = trackRef.position != null ? Math.floor(trackRef.position / 1000) : 1;
          const positionTrackNum = trackRef.position != null ? (trackRef.position % 1000) : null;
          return {
            id: trackRef.id,
            position: trackRef.position,
            disc: trackMeta.disc ?? positionDisc,
            trackNumber: trackMeta.trackNumber ?? positionTrackNum,
            title: trackMeta.title || 'Untitled',
            trackArtist: trackMeta.trackArtist || null,
            duration: trackMeta.duration || 0,
            filePath: trackMeta.filePath,
            format: trackMeta.format || null,
            bitrate: trackMeta.bitrate || null
          };
        }
        return null;
      }).filter(Boolean);

      // Get cover path
      let coverPath = null;
      if (record.cover) {
        const attachmentFolder = path.join(paths.attachments, `${record.cover}.info`);
        const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
        if (fs.existsSync(thumbPath)) {
          coverPath = thumbPath;
        }
      }

      // Get attachments
      const attachments = (record.attachments || []).map(attId => {
        const attachmentFolder = path.join(paths.attachments, `${attId}.info`);
        const metaPath = path.join(attachmentFolder, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
            return {
              id: attId,
              filename: meta.originalName || meta.filename,
              type: meta.mimeType,
              thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null
            };
          } catch (e) {}
        }
        return null;
      }).filter(Boolean);

      return {
        success: true,
        record: {
          ...record,
          addedAt: record.createdAt || record.addedAt,  // Normalize to addedAt for UI
          tracks,
          coverPath,
          enrichedAttachments: attachments
        }
      };
    } catch (err) {
      console.error('[Panopticon] Error getting record detail:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get full track data for detail panel
   */
  ipcMain.handle('panopticon:get-track-detail', async (event, { trackId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const trackFolder = path.join(paths.tracks, `${trackId}.info`);

      if (!fs.existsSync(trackFolder)) {
        return { success: false, error: 'Track not found' };
      }

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) {
        return { success: false, error: 'Track metadata not found' };
      }

      // Find parent record
      const collections = listCollections(currentLibraryPath);
      let parentRecord = null;
      let position = null;

      for (const collection of collections) {
        if (collection.type === 'mixtape') continue;
        const trackRef = (collection.tracks || []).find(t => t.id === trackId);
        if (trackRef) {
          parentRecord = collection;
          position = trackRef.position;
          break;
        }
      }

      // Get cover from parent record
      let coverPath = null;
      if (parentRecord && parentRecord.cover) {
        const attachmentFolder = path.join(paths.attachments, `${parentRecord.cover}.info`);
        const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
        if (fs.existsSync(thumbPath)) {
          coverPath = thumbPath;
        }
      }

      // Get attachments
      const attachments = (trackMeta.attachments || []).map(attId => {
        const attachmentFolder = path.join(paths.attachments, `${attId}.info`);
        const metaPath = path.join(attachmentFolder, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const thumbPath = path.join(attachmentFolder, 'thumbnail.jpg');
            return {
              id: attId,
              filename: meta.originalName || meta.filename,
              type: meta.mimeType,
              thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null
            };
          } catch (e) {}
        }
        return null;
      }).filter(Boolean);

      // Compute actual audio file path
      const audioFilePath = trackMeta.filename
        ? path.join(trackFolder, trackMeta.filename)
        : null;

      // Prefer track metadata for disc/trackNumber (allows editing)
      // Fall back to position-derived values if metadata is missing
      const positionDisc = position != null ? Math.floor(position / 1000) : null;
      const positionTrackNum = position != null ? (position % 1000) : null;

      return {
        success: true,
        track: {
          ...trackMeta,
          id: trackId,
          position,
          disc: trackMeta.disc ?? positionDisc,
          trackNumber: trackMeta.trackNumber ?? positionTrackNum,
          coverPath,
          filePath: audioFilePath,
          enrichedAttachments: attachments,
          parentRecord: parentRecord ? {
            id: parentRecord.id,
            name: parentRecord.name,
            artist: parentRecord.artist
          } : null
        }
      };
    } catch (err) {
      console.error('[Panopticon] Error getting track detail:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set record cover from a file path (Finder drop)
   * Old cover is preserved as ephemera (stays in attachments)
   */
  ipcMain.handle('panopticon:set-record-cover', async (event, { recordId, imagePath }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const record = readCollection(currentLibraryPath, recordId);

      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // Remember old cover ID (will be preserved as ephemera)
      const oldCoverId = record.cover;

      // Import the cover file
      const newCoverId = await importCoverFromFile(imagePath, recordId, record.name || 'Cover', paths);

      if (!newCoverId) {
        return { success: false, error: 'Failed to import cover' };
      }

      // Ensure attachments array exists
      record.attachments = record.attachments || [];

      // Keep old cover in attachments (as ephemera) if it exists and isn't already there
      if (oldCoverId && !record.attachments.includes(oldCoverId)) {
        record.attachments.push(oldCoverId);
        console.log('[Panopticon] Preserved old cover as ephemera:', oldCoverId);
      }

      // Update record with new cover
      record.cover = newCoverId;
      if (!record.attachments.includes(newCoverId)) {
        record.attachments.push(newCoverId);
      }
      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Set record cover from file:', recordId, imagePath);
      return { success: true, coverId: newCoverId, oldCoverId };
    } catch (err) {
      console.error('[Panopticon] Error setting record cover:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set record cover from an existing attachment (Panopticon drop)
   * Old cover is preserved as ephemera (stays in attachments)
   */
  ipcMain.handle('panopticon:set-record-cover-from-attachment', async (event, { recordId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const record = readCollection(currentLibraryPath, recordId);

      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      // Verify the attachment exists
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);
      if (!fs.existsSync(attachmentFolder)) {
        return { success: false, error: 'Attachment not found' };
      }

      // Remember old cover ID (will be preserved as ephemera)
      const oldCoverId = record.cover;

      // Ensure attachments array exists
      record.attachments = record.attachments || [];

      // Keep old cover in attachments (as ephemera) if it exists and isn't already there
      if (oldCoverId && !record.attachments.includes(oldCoverId)) {
        record.attachments.push(oldCoverId);
        console.log('[Panopticon] Preserved old cover as ephemera:', oldCoverId);
      }

      // Set the attachment as cover
      record.cover = attachmentId;

      // Ensure new cover attachment is linked to this record
      if (!record.attachments.includes(attachmentId)) {
        record.attachments.push(attachmentId);
      }

      record.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, record);

      console.log('[Panopticon] Set record cover from attachment:', recordId, attachmentId);
      return { success: true, oldCoverId };
    } catch (err) {
      console.error('[Panopticon] Error setting record cover from attachment:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set mixtape cover from a file path (Finder drop)
   * Creates an attachment and sets coverImageId
   */
  ipcMain.handle('panopticon:set-mixtape-cover', async (event, { mixtapeId, imagePath }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const mixtape = readCollection(currentLibraryPath, mixtapeId);

      if (!mixtape) {
        return { success: false, error: 'Mixtape not found' };
      }

      // Import the cover file as an attachment
      const newCoverId = await importCoverFromFile(imagePath, mixtapeId, mixtape.name || 'Cover', paths);

      if (!newCoverId) {
        return { success: false, error: 'Failed to import cover' };
      }

      // Ensure attachments array exists
      mixtape.attachments = mixtape.attachments || [];

      // Update mixtape with new cover
      mixtape.coverImageId = newCoverId;
      if (!mixtape.attachments.includes(newCoverId)) {
        mixtape.attachments.push(newCoverId);
      }
      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      console.log('[Panopticon] Set mixtape cover from file:', mixtapeId, imagePath);
      return { success: true, coverId: newCoverId };
    } catch (err) {
      console.error('[Panopticon] Error setting mixtape cover:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set mixtape cover from existing attachment (drag from ephemera)
   */
  ipcMain.handle('panopticon:set-mixtape-cover-from-attachment', async (event, { mixtapeId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }

      const paths = getLibraryPaths(currentLibraryPath);
      const mixtape = readCollection(currentLibraryPath, mixtapeId);

      if (!mixtape) {
        return { success: false, error: 'Mixtape not found' };
      }

      // Verify the attachment exists
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);
      if (!fs.existsSync(attachmentFolder)) {
        return { success: false, error: 'Attachment not found' };
      }

      // Remember old cover ID (will be preserved as ephemera)
      const oldCoverId = mixtape.coverImageId;

      // Ensure attachments array exists
      mixtape.attachments = mixtape.attachments || [];

      // Keep old cover in attachments (as ephemera) if it exists and isn't already there
      if (oldCoverId && !mixtape.attachments.includes(oldCoverId)) {
        mixtape.attachments.push(oldCoverId);
        console.log('[Panopticon] Preserved old mixtape cover as ephemera:', oldCoverId);
      }

      // Set the attachment as cover
      mixtape.coverImageId = attachmentId;

      // Ensure new cover attachment is linked to this mixtape
      if (!mixtape.attachments.includes(attachmentId)) {
        mixtape.attachments.push(attachmentId);
      }

      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      console.log('[Panopticon] Set mixtape cover from attachment:', mixtapeId, attachmentId);
      return { success: true, oldCoverId };
    } catch (err) {
      console.error('[Panopticon] Error setting mixtape cover from attachment:', err);
      return { success: false, error: err.message };
    }
  });

};
