/**
 * Foyer IPC Handlers
 *
 * Library setup and management - the "lobby" experience before entering the main app.
 * Handles library creation, opening, and the initial app state check.
 *
 * Audio-bridge initialization happens here when libraries are opened/created.
 */

const fs = require('fs');
const path = require('path');

// Audio bridge for native Swift audio playback
const audioBridge = require('../audio-bridge');

module.exports = function registerFoyerHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  setLibraryPath,
  initLibraryPath,
  ensureLibrary,
  loadPreferences,
  savePreferences,
  loadAlbumsForDisplay,
  libraryExists,
  initializeLibrary,
  loadLibraryConfig,
  saveLibraryConfig,
  ensureFacetsJson,
  getLibraryPaths,
  readCollection,
  listCollections,
  readTrackMetadata,
  generateUUID,
  shuffleArray,
  ledgers,
  programs,
  facetIndex
}) {

  // Helper to add a library to the known libraries list
  function addToKnownLibraries(libraryPath, name) {
    const prefs = loadPreferences();
    const known = prefs.knownLibraries || [];

    // Check if already in list
    const existing = known.find(l => l.path === libraryPath);
    if (!existing) {
      known.push({ path: libraryPath, name });
      savePreferences({ ...prefs, knownLibraries: known });
    } else if (existing.name !== name) {
      // Update name if changed
      existing.name = name;
      savePreferences({ ...prefs, knownLibraries: known });
    }
  }

  // Get app state - called on startup to determine if we have a library
  ipcMain.handle('get-app-state', async () => {
    const prefs = loadPreferences();
    const shunFoyer = prefs.shunFoyer || false;
    const hasLibrary = initLibraryPath() && ensureLibrary();
    let libraryInfo = null;

    if (hasLibrary) {
      const currentLibraryPath = getLibraryPath();
      const config = loadLibraryConfig(currentLibraryPath);
      libraryInfo = {
        path: currentLibraryPath,
        name: config?.name || path.basename(currentLibraryPath, '.library')
      };
    }

    return {
      hasLibrary,
      libraryInfo,
      shunFoyer
    };
  });

  // Generic folder picker
  ipcMain.handle('show-folder-picker', async (event, options = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: options.title || 'Select Folder',
      message: options.message || 'Choose a folder',
      buttonLabel: options.buttonLabel || 'Select'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  // Create a new library
  ipcMain.handle('create-library', async (event, { name, parentPath }) => {
    try {
      // Create library folder name from user's chosen name
      const libraryFolderName = `${name}.library`;
      const libraryPath = path.join(parentPath, libraryFolderName);

      // Check if already exists
      if (fs.existsSync(libraryPath)) {
        return { success: false, error: 'A library with this name already exists in this location' };
      }

      // Initialize the library
      initializeLibrary(libraryPath);

      // Save library name in its config
      const config = loadLibraryConfig(libraryPath) || {};
      config.name = name;
      saveLibraryConfig(libraryPath, config);

      // Save to preferences and update current path
      setLibraryPath(libraryPath);
      savePreferences({ libraryPath });

      // Add to known libraries list
      addToKnownLibraries(libraryPath, name);

      // Initialize ledgers database for the new library
      ledgers.initialize(libraryPath);

      // Initialize programs engine
      programs.initialize(libraryPath, {
        getLibraryPaths,
        readCollection,
        listCollections,
        readTrackMetadata,
        generateUUID,
        shuffleArray
      }, facetIndex);

      // Spawn audio bridge (native Swift audio service)
      // New libraries default to native audio enabled
      audioBridge.spawn(libraryPath);

      return {
        success: true,
        libraryInfo: { path: libraryPath, name }
      };
    } catch (error) {
      console.error('Error creating library:', error);
      return { success: false, error: error.message };
    }
  });

  // Open an existing library by path
  ipcMain.handle('open-library', async (event, libraryPath) => {
    try {
      // Validate it's a .library folder
      if (!libraryPath.endsWith('.library')) {
        return { success: false, error: 'Please select a .library folder' };
      }

      // Check it exists and has valid structure
      if (!libraryExists(libraryPath)) {
        return { success: false, error: 'This does not appear to be a valid Gloaming library' };
      }

      // Ensure facets.json exists (may be missing in older libraries)
      ensureFacetsJson(libraryPath);

      // Load config to get name
      const config = loadLibraryConfig(libraryPath) || {};
      const name = config.name || path.basename(libraryPath, '.library');

      // Save to preferences and update current path
      setLibraryPath(libraryPath);
      savePreferences({ libraryPath });

      // Add to known libraries list
      addToKnownLibraries(libraryPath, name);

      // Initialize ledgers database for this library
      ledgers.initialize(libraryPath);

      // Initialize programs engine
      programs.initialize(libraryPath, {
        getLibraryPaths,
        readCollection,
        listCollections,
        readTrackMetadata,
        generateUUID,
        shuffleArray
      }, facetIndex);

      // Spawn audio bridge (native Swift audio service)
      if (config?.settings?.useNativeAudio !== false) {
        audioBridge.spawn(libraryPath);
      }

      return {
        success: true,
        libraryInfo: { path: libraryPath, name }
      };
    } catch (error) {
      console.error('Error opening library:', error);
      return { success: false, error: error.message };
    }
  });

  // Show library picker dialog and open selected library
  ipcMain.handle('show-library-picker', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Library',
      message: 'Select a .library folder',
      buttonLabel: 'Open Library'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const libraryPath = result.filePaths[0];

    // Validate it's a .library folder
    if (!libraryPath.endsWith('.library')) {
      return { success: false, error: 'Please select a .library folder' };
    }

    // Check it exists and has valid structure
    if (!libraryExists(libraryPath)) {
      return { success: false, error: 'This does not appear to be a valid Gloaming library' };
    }

    // Load config to get name
    const config = loadLibraryConfig(libraryPath) || {};
    const name = config.name || path.basename(libraryPath, '.library');

    // Save to preferences and update current path
    setLibraryPath(libraryPath);
    savePreferences({ libraryPath });

    return {
      success: true,
      libraryInfo: { path: libraryPath, name }
    };
  });

  // Library info getters
  ipcMain.handle('get-library-path', async () => {
    return getLibraryPath();
  });

  ipcMain.handle('get-library-config', async () => {
    return loadLibraryConfig(getLibraryPath());
  });

  ipcMain.handle('save-library-config', async (event, config) => {
    saveLibraryConfig(getLibraryPath(), config);
    return { success: true };
  });

  // Load albums for RECORDS view
  ipcMain.handle('load-albums', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      // Build facet index on library load
      facetIndex.buildIndex(currentLibraryPath);

      const { albums } = await loadAlbumsForDisplay();
      console.log(`Loaded ${albums.length} albums`);
      return { albums, error: null };
    } catch (err) {
      console.error('Error loading albums:', err);
      return { albums: [], error: err.message };
    }
  });

  // Legacy handler for backwards compatibility
  ipcMain.handle('scan-library', async () => {
    try {
      const { albums } = await loadAlbumsForDisplay();
      return { albums, error: null };
    } catch (err) {
      return { albums: [], error: err.message };
    }
  });

  // ============================================
  // Foyer Preferences
  // ============================================

  // Get foyer preferences (known libraries and shun setting)
  ipcMain.handle('get-foyer-preferences', async () => {
    const prefs = loadPreferences();
    return {
      knownLibraries: prefs.knownLibraries || [],
      shunFoyer: prefs.shunFoyer || false
    };
  });

  // Update the known libraries list
  ipcMain.handle('update-known-libraries', async (event, libraries) => {
    const prefs = loadPreferences();
    savePreferences({ ...prefs, knownLibraries: libraries });
    return { success: true };
  });

  // Set the shun foyer preference
  ipcMain.handle('set-shun-foyer', async (event, shun) => {
    const prefs = loadPreferences();
    savePreferences({ ...prefs, shunFoyer: shun });
    return { success: true };
  });

  // Set window size constraints (for Foyer vs Library mode)
  ipcMain.handle('set-window-mode', async (event, mode) => {
    const { BrowserWindow, screen } = require('electron');
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { success: false };

    if (mode === 'library') {
      // Library mode: remove max constraints, set larger minimum
      // Use screen dimensions as max to effectively remove the constraint
      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
      win.setMaximumSize(screenWidth, screenHeight);
      win.setMinimumSize(1400, 600);
      win.setResizable(true);
      // Resize to library dimensions
      win.setSize(1400, 900);
    } else {
      // Foyer mode: fixed size 700x1200
      win.setMinimumSize(700, 1200);
      win.setMaximumSize(700, 1200);
      win.setSize(700, 1200);
      win.setResizable(false);
    }
    return { success: true };
  });

};
