/**
 * Context Menu IPC Handlers
 *
 * Shell operations for revealing files in Finder, opening files,
 * and other context menu actions.
 */

const { shell } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = function registerContextMenuHandlers({ ipcMain, getLibraryPath, facetIndex }) {

  // Reveal file in system file manager (Finder on macOS, Explorer on Windows)
  ipcMain.handle('reveal-in-finder', async (event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err) {
      console.error('Error revealing in finder:', err);
      return { success: false, error: err.message };
    }
  });

  // Open file in default application
  ipcMain.handle('open-file', async (event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        await shell.openPath(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err) {
      console.error('Error opening file:', err);
      return { success: false, error: err.message };
    }
  });

  // Reveal record's collection.json in Finder
  ipcMain.handle('reveal-record-json', async (event, albumId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      if (!currentLibraryPath) {
        return { success: false, error: 'No library loaded' };
      }
      const collectionPath = path.join(currentLibraryPath, 'collections', `${albumId}.json`);
      if (fs.existsSync(collectionPath)) {
        shell.showItemInFolder(collectionPath);
        return { success: true };
      }
      return { success: false, error: 'Collection not found' };
    } catch (err) {
      console.error('Error revealing record JSON:', err);
      return { success: false, error: err.message };
    }
  });

  // Bulk add facet to multiple tracks
  ipcMain.handle('add-facet-to-tracks', async (event, { trackIds, facetName }) => {
    try {
      for (const trackId of trackIds) {
        await facetIndex.addFacetToTrack(trackId, facetName);
      }
      return { success: true };
    } catch (err) {
      console.error('Error adding facet to tracks:', err);
      return { success: false, error: err.message };
    }
  });

  // Get all unique folder paths for a mixtape's tracks
  ipcMain.handle('get-mixtape-folders', async (event, mixtapeId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const mixtapePath = path.join(currentLibraryPath, 'collections', `${mixtapeId}.json`);
      if (!fs.existsSync(mixtapePath)) {
        return [];
      }

      const mixtape = JSON.parse(fs.readFileSync(mixtapePath, 'utf8'));
      const folders = new Set();

      for (const trackRef of (mixtape.tracks || [])) {
        const trackId = trackRef.id || trackRef;
        const trackMetaPath = path.join(currentLibraryPath, 'tracks', trackId, 'metadata.json');
        if (fs.existsSync(trackMetaPath)) {
          const trackMeta = JSON.parse(fs.readFileSync(trackMetaPath, 'utf8'));
          if (trackMeta.audioPath) {
            folders.add(path.dirname(trackMeta.audioPath));
          }
        }
      }

      return Array.from(folders);
    } catch (err) {
      console.error('Error getting mixtape folders:', err);
      return [];
    }
  });

};
