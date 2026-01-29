/**
 * Attachments IPC Handlers
 *
 * Ephemera management - images, PDFs, and other files attached to
 * records, tracks, and mixtapes.
 */

const fs = require('fs');
const path = require('path');
const { generateThumbnails } = require('../thumbnails');

// Supported attachment file types
const ATTACHMENT_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const ATTACHMENT_DOCUMENT_TYPES = ['.pdf', '.txt', '.md', '.rtf'];
const ATTACHMENT_ALL_TYPES = [...ATTACHMENT_IMAGE_TYPES, ...ATTACHMENT_DOCUMENT_TYPES];

// Get file type category
function getAttachmentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ATTACHMENT_IMAGE_TYPES.includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.rtf'].includes(ext)) return 'text';
  return 'other';
}

// Get MIME type from extension
function getMimeType(ext) {
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.rtf': 'application/rtf'
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

// Helper: Resolve composite trackId (albumId-trackNum) to actual track folder path
function resolveTrackFolder(trackId, getLibraryPath, getLibraryPaths, readCollection) {
  const currentLibraryPath = getLibraryPath();
  const paths = getLibraryPaths(currentLibraryPath);

  // First try direct lookup
  let trackFolder = path.join(paths.tracks, `${trackId}.info`);
  if (fs.existsSync(trackFolder)) {
    return trackFolder;
  }

  // If composite ID (albumId-trackNum), parse and find actual track
  if (trackId.includes('-')) {
    const parts = trackId.split('-');
    const trackNum = parseInt(parts.pop(), 10);
    const albumId = parts.join('-'); // In case albumId itself has dashes

    const album = readCollection(currentLibraryPath, albumId);
    if (album && album.tracks) {
      // Find track by position/trackNumber
      const trackRef = album.tracks.find(tr =>
        tr.position === trackNum ||
        (tr.trackNumber || tr.track) === trackNum
      );

      if (trackRef) {
        trackFolder = path.join(paths.tracks, `${trackRef.id}.info`);
        if (fs.existsSync(trackFolder)) {
          return trackFolder;
        }
      }
    }
  }

  return null;
}

module.exports = function registerAttachmentsHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  getLibraryPaths,
  generateUUID,
  createAttachmentFolder,
  writeAttachmentMetadata,
  readAttachmentMetadata,
  readCollection,
  writeCollection,
  listCollections,
  listAllTracks,
  readTrackMetadata,
  writeTrackMetadata
}) {

  // Add an attachment (copies file to library, returns attachment info)
  ipcMain.handle('add-attachment', async (event, { filePath }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const attachmentId = generateUUID();
      const originalName = path.basename(filePath);
      const ext = path.extname(filePath);
      const filename = `file${ext}`; // Store as generic name, keep original in metadata

      // Validate file type
      if (!ATTACHMENT_ALL_TYPES.includes(ext.toLowerCase())) {
        return { success: false, error: 'Unsupported file type' };
      }

      // Create attachment folder
      const attachmentFolder = createAttachmentFolder(currentLibraryPath, attachmentId);

      // Copy file
      const destPath = path.join(attachmentFolder, filename);
      fs.copyFileSync(filePath, destPath);

      // Get file stats
      const stats = fs.statSync(destPath);

      // Generate thumbnails for images (both large 600x600 and small 80x80)
      const isImage = ATTACHMENT_IMAGE_TYPES.includes(ext.toLowerCase());
      if (isImage) {
        try {
          const result = await generateThumbnails(destPath, attachmentFolder);
          console.log('Generated thumbnails for attachment:', attachmentId, result);
        } catch (thumbErr) {
          console.error('Failed to generate thumbnails:', thumbErr.message);
          // Continue without thumbnails - not fatal
        }
      }

      // Write metadata
      const metadata = {
        id: attachmentId,
        originalName,
        filename,
        mimeType: getMimeType(ext),
        type: getAttachmentType(originalName),
        size: stats.size,
        dateAdded: new Date().toISOString()
      };
      writeAttachmentMetadata(attachmentFolder, metadata);

      console.log('Added attachment:', attachmentId, originalName);
      return {
        success: true,
        attachment: {
          ...metadata,
          path: destPath
        }
      };
    } catch (err) {
      console.error('Error adding attachment:', err);
      return { success: false, error: err.message };
    }
  });

  // Get attachment info by ID
  ipcMain.handle('get-attachment', async (event, attachmentId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);

      if (!fs.existsSync(attachmentFolder)) {
        return null;
      }

      const metadata = readAttachmentMetadata(attachmentFolder);
      if (!metadata) return null;

      return {
        ...metadata,
        path: path.join(attachmentFolder, metadata.filename)
      };
    } catch (err) {
      console.error('Error getting attachment:', err);
      return null;
    }
  });

  // Delete an attachment (only if no references remain)
  ipcMain.handle('delete-attachment', async (event, attachmentId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const attachmentFolder = path.join(paths.attachments, `${attachmentId}.info`);

      if (!fs.existsSync(attachmentFolder)) {
        return { success: false, error: 'Attachment not found' };
      }

      // Check if any entity still references this attachment
      const collections = listCollections(currentLibraryPath);
      const tracks = listAllTracks(currentLibraryPath);

      for (const collection of collections) {
        if ((collection.attachments || []).includes(attachmentId)) {
          return { success: false, error: 'Attachment still in use by ' + (collection.name || collection.id) };
        }
      }

      for (const track of tracks) {
        if ((track.attachments || []).includes(attachmentId)) {
          return { success: false, error: 'Attachment still in use by track' };
        }
      }

      // Safe to delete
      fs.rmSync(attachmentFolder, { recursive: true, force: true });
      console.log('Deleted attachment:', attachmentId);

      return { success: true };
    } catch (err) {
      console.error('Error deleting attachment:', err);
      return { success: false, error: err.message };
    }
  });

  // Show file picker for attachments
  ipcMain.handle('show-attachment-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        title: 'Select Attachments',
        filters: [
          { name: 'All Supported', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md', 'rtf'] },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'rtf'] }
        ]
      });

      if (result.canceled) {
        return { canceled: true, paths: [] };
      }

      return { canceled: false, paths: result.filePaths };
    } catch (err) {
      console.error('Error showing attachment picker:', err);
      return { canceled: true, paths: [], error: err.message };
    }
  });

  // Read text file content for in-app viewer
  ipcMain.handle('read-text-file', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (err) {
      console.error('Error reading text file:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Album Attachments
  // ============================================

  // Get attachments for an album (excludes the album cover)
  ipcMain.handle('get-album-attachments', async (event, albumId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return [];

      const attachmentIds = album.attachments || [];
      const coverAttachmentId = album.cover; // The cover is stored as an attachment but shouldn't show in era box
      const paths = getLibraryPaths(currentLibraryPath);

      const attachments = attachmentIds
        .filter(id => id !== coverAttachmentId) // Exclude the album cover
        .map(id => {
          const folder = path.join(paths.attachments, `${id}.info`);
          const metadata = readAttachmentMetadata(folder);
          if (!metadata) return null;
          const thumbPath = path.join(folder, 'thumbnail.jpg');
          return {
            ...metadata,
            path: path.join(folder, metadata.filename),
            thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null
          };
        }).filter(Boolean);

      return attachments;
    } catch (err) {
      console.error('Error getting album attachments:', err);
      return [];
    }
  });

  // Add attachment to album
  ipcMain.handle('add-attachment-to-album', async (event, { albumId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return { success: false, error: 'Album not found' };

      album.attachments = album.attachments || [];
      if (!album.attachments.includes(attachmentId)) {
        album.attachments.push(attachmentId);
        album.modifiedAt = new Date().toISOString();
        writeCollection(currentLibraryPath, album);
      }

      return { success: true };
    } catch (err) {
      console.error('Error adding attachment to album:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove attachment from album
  ipcMain.handle('remove-attachment-from-album', async (event, { albumId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return { success: false, error: 'Album not found' };

      album.attachments = (album.attachments || []).filter(id => id !== attachmentId);
      album.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, album);

      return { success: true };
    } catch (err) {
      console.error('Error removing attachment from album:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder album attachments
  ipcMain.handle('reorder-album-attachments', async (event, { albumId, attachmentIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return { success: false, error: 'Album not found' };

      album.attachments = attachmentIds;
      album.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, album);

      return { success: true };
    } catch (err) {
      console.error('Error reordering album attachments:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Track Attachments
  // ============================================

  // Get attachments for a track
  ipcMain.handle('get-track-attachments', async (event, trackId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const paths = getLibraryPaths(currentLibraryPath);
      const trackFolder = resolveTrackFolder(trackId, getLibraryPath, getLibraryPaths, readCollection);
      if (!trackFolder) return [];

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) return [];

      const attachmentIds = trackMeta.attachments || [];

      const attachments = attachmentIds.map(id => {
        const folder = path.join(paths.attachments, `${id}.info`);
        const metadata = readAttachmentMetadata(folder);
        if (!metadata) return null;
        const thumbPath = path.join(folder, 'thumbnail.jpg');
        return {
          ...metadata,
          path: path.join(folder, metadata.filename),
          thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null
        };
      }).filter(Boolean);

      return attachments;
    } catch (err) {
      console.error('Error getting track attachments:', err);
      return [];
    }
  });

  // Add attachment to track
  ipcMain.handle('add-attachment-to-track', async (event, { trackId, attachmentId }) => {
    try {
      const trackFolder = resolveTrackFolder(trackId, getLibraryPath, getLibraryPaths, readCollection);
      if (!trackFolder) return { success: false, error: 'Track not found' };

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) return { success: false, error: 'Track metadata not found' };

      trackMeta.attachments = trackMeta.attachments || [];
      if (!trackMeta.attachments.includes(attachmentId)) {
        trackMeta.attachments.push(attachmentId);
        trackMeta.modifiedAt = new Date().toISOString();
        writeTrackMetadata(trackFolder, trackMeta);
      }

      return { success: true };
    } catch (err) {
      console.error('Error adding attachment to track:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove attachment from track
  ipcMain.handle('remove-attachment-from-track', async (event, { trackId, attachmentId }) => {
    try {
      const trackFolder = resolveTrackFolder(trackId, getLibraryPath, getLibraryPaths, readCollection);
      if (!trackFolder) return { success: false, error: 'Track not found' };

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) return { success: false, error: 'Track metadata not found' };

      trackMeta.attachments = (trackMeta.attachments || []).filter(id => id !== attachmentId);
      trackMeta.modifiedAt = new Date().toISOString();
      writeTrackMetadata(trackFolder, trackMeta);

      return { success: true };
    } catch (err) {
      console.error('Error removing attachment from track:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder track attachments
  ipcMain.handle('reorder-track-attachments', async (event, { trackId, attachmentIds }) => {
    try {
      const trackFolder = resolveTrackFolder(trackId, getLibraryPath, getLibraryPaths, readCollection);
      if (!trackFolder) return { success: false, error: 'Track not found' };

      const trackMeta = readTrackMetadata(trackFolder);
      if (!trackMeta) return { success: false, error: 'Track metadata not found' };

      trackMeta.attachments = attachmentIds;
      trackMeta.modifiedAt = new Date().toISOString();
      writeTrackMetadata(trackFolder, trackMeta);

      return { success: true };
    } catch (err) {
      console.error('Error reordering track attachments:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Mixtape Attachments
  // ============================================

  // Get attachments for a mixtape
  ipcMain.handle('get-mixtape-attachments', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') return [];

      const attachmentIds = mixtape.attachments || [];
      const paths = getLibraryPaths(currentLibraryPath);

      const attachments = attachmentIds.map(id => {
        const folder = path.join(paths.attachments, `${id}.info`);
        const metadata = readAttachmentMetadata(folder);
        if (!metadata) return null;
        const thumbPath = path.join(folder, 'thumbnail.jpg');
        return {
          ...metadata,
          path: path.join(folder, metadata.filename),
          thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null
        };
      }).filter(Boolean);

      return attachments;
    } catch (err) {
      console.error('Error getting mixtape attachments:', err);
      return [];
    }
  });

  // Add attachment to mixtape
  ipcMain.handle('add-attachment-to-mixtape', async (event, { mixtapeId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.attachments = mixtape.attachments || [];
      if (!mixtape.attachments.includes(attachmentId)) {
        mixtape.attachments.push(attachmentId);
        mixtape.modifiedAt = new Date().toISOString();
        writeCollection(currentLibraryPath, mixtape);
      }

      return { success: true };
    } catch (err) {
      console.error('Error adding attachment to mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove attachment from mixtape
  ipcMain.handle('remove-attachment-from-mixtape', async (event, { mixtapeId, attachmentId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.attachments = (mixtape.attachments || []).filter(id => id !== attachmentId);
      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      return { success: true };
    } catch (err) {
      console.error('Error removing attachment from mixtape:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder mixtape attachments
  ipcMain.handle('reorder-mixtape-attachments', async (event, { mixtapeId, attachmentIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtape = readCollection(currentLibraryPath, mixtapeId);
      if (!mixtape || mixtape.type !== 'mixtape') {
        return { success: false, error: 'Mixtape not found' };
      }

      mixtape.attachments = attachmentIds;
      mixtape.modifiedAt = new Date().toISOString();
      writeCollection(currentLibraryPath, mixtape);

      return { success: true };
    } catch (err) {
      console.error('Error reordering mixtape attachments:', err);
      return { success: false, error: err.message };
    }
  });

};
