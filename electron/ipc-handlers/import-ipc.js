/**
 * Import IPC Handlers - v2 Simplified
 *
 * Philosophy: Import fast and dumb. Fix in Panopticon.
 * No preview, no decisions - just import immediately.
 */

const path = require('path');

module.exports = function registerImportHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  importFiles,
  AUDIO_EXTENSIONS
}) {

  // Import dialog - select folder(s) or file(s)
  ipcMain.handle('show-import-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      title: 'Select files or folders to import',
      message: 'Choose audio files or folders containing music',
      filters: [
        { name: 'Audio Files', extensions: ['m4a', 'flac', 'mp3', 'wav', 'aiff', 'aac', 'ogg', 'wma'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      paths: result.filePaths
    };
  });

  // Main import handler - immediate import, no preview
  ipcMain.handle('import-files', async (event, inputPaths) => {
    try {
      const currentLibraryPath = getLibraryPath();

      if (!currentLibraryPath) {
        return { success: false, error: 'No library open' };
      }

      // Ensure inputPaths is an array
      const pathsArray = Array.isArray(inputPaths) ? inputPaths : [inputPaths];

      if (pathsArray.length === 0) {
        return { success: false, error: 'No paths provided' };
      }

      const result = await importFiles(pathsArray, currentLibraryPath, {
        onProgress: (progress) => {
          // Send progress updates to renderer
          event.sender.send('import-progress', progress);
        }
      });

      return result;
    } catch (err) {
      console.error('Import error:', err);
      return { success: false, error: err.message };
    }
  });

};
