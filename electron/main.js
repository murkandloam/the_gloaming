/**
 * The Gloaming - Main Electron Process
 * 
 * Handles window creation, IPC communication, and library management.
 */

const { app, BrowserWindow, ipcMain, protocol, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Library modules
const {
  DEFAULT_LIBRARY_PATH,
  libraryExists,
  initializeLibrary,
  loadLibraryConfig,
  saveLibraryConfig,
  loadFacets,
  saveFacets,
  ensureFacetsJson,
  getLibraryPaths,
  listCollections,
  listAllTracks,
  readCollection,
  writeCollection,
  readTrackMetadata,
  writeTrackMetadata,
  createAttachmentFolder,
  writeAttachmentMetadata,
  readAttachmentMetadata,
  listAllAttachments,
  generateUUID,
  LIBRARY_STRUCTURE,
  shuffleArray,
  generateShuffleSeed,
  loadSession,
  saveSession
} = require('./library');

const {
  importFiles,
  AUDIO_EXTENSIONS,
  extractAudioMetadata,
  extractEmbeddedCover,
  // Legacy exports for Panopticon induction
  scanFolderForAudio,
  findCoverArt,
  importAsNewAlbum,
  importToExistingAlbum,
  importSingleFile,
  importCoverFromFile,
  importCoverFromData
} = require('./import');

const { generateThumbnails } = require('./thumbnails');

// Facet index for fast lookups
const facetIndex = require('./facetIndex');

// Ledgers for listening history
const ledgers = require('./ledgers');

// Programs engine for smart radio scheduling
const programs = require('./programs');

// Audio bridge for native Swift audio playback
const audioBridge = require('./audio-bridge');

// IPC Handler modules
const registerContextMenuHandlers = require('./ipc-handlers/context-menu');
const registerSessionHandlers = require('./ipc-handlers/session');
const registerProgramsHandlers = require('./ipc-handlers/programs-ipc');
const registerAttachmentsHandlers = require('./ipc-handlers/attachments');
const registerMixtapesHandlers = require('./ipc-handlers/mixtapes');
const registerLedgersHandlers = require('./ipc-handlers/ledgers-ipc');
const registerFacetsHandlers = require('./ipc-handlers/facets');
const registerAlbumsHandlers = require('./ipc-handlers/albums');
const registerImportHandlers = require('./ipc-handlers/import-ipc');
const registerFoyerHandlers = require('./ipc-handlers/foyer');
const registerPanopticonHandlers = require('./ipc-handlers/panopticon');
const registerAudioHandlers = require('./ipc-handlers/audio-ipc');

// Preferences file location
const PREFS_PATH = path.join(app.getPath('userData'), 'preferences.json');

// Current library path (loaded from prefs or null)
let currentLibraryPath = null;

// Main window reference for IPC event forwarding
let mainWindow = null;

// Getter and setter for use by extracted IPC handler modules
const getLibraryPath = () => currentLibraryPath;
const setLibraryPath = (path) => { currentLibraryPath = path; };
const getMainWindow = () => mainWindow;

// Register extracted IPC handlers
registerContextMenuHandlers({ ipcMain, getLibraryPath, facetIndex });
registerSessionHandlers({ ipcMain, getLibraryPath, loadSession, saveSession });
registerProgramsHandlers({ ipcMain, programs });
registerAttachmentsHandlers({
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
});
registerMixtapesHandlers({
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
});
registerLedgersHandlers({
  ipcMain,
  ledgers,
  getLibraryPath,
  getLibraryPaths,
  readCollection,
  readTrackMetadata,
  getAlbumArtPath
});
registerFacetsHandlers({
  ipcMain,
  facetIndex,
  getLibraryPath,
  getLibraryPaths,
  loadFacets,
  saveFacets,
  listCollections,
  readCollection,
  writeCollection,
  readTrackMetadata
});
registerAlbumsHandlers({
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
});
registerImportHandlers({
  ipcMain,
  dialog,
  getLibraryPath,
  importFiles,
  AUDIO_EXTENSIONS
});
registerFoyerHandlers({
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
});
registerPanopticonHandlers({
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
});
registerAudioHandlers({
  ipcMain,
  audioBridge,
  getMainWindow
});

/**
 * Load preferences from disk
 */
function loadPreferences() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      const data = fs.readFileSync(PREFS_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading preferences:', error);
  }
  return {};
}

/**
 * Save preferences to disk
 */
function savePreferences(prefs) {
  try {
    // Ensure directory exists
    const prefsDir = path.dirname(PREFS_PATH);
    if (!fs.existsSync(prefsDir)) {
      fs.mkdirSync(prefsDir, { recursive: true });
    }
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch (error) {
    console.error('Error saving preferences:', error);
  }
}

/**
 * Initialize library path from preferences
 */
function initLibraryPath() {
  const prefs = loadPreferences();
  if (prefs.libraryPath && fs.existsSync(prefs.libraryPath)) {
    currentLibraryPath = prefs.libraryPath;
    console.log('Loaded library path from preferences:', currentLibraryPath);
    return true;
  }
  console.log('No valid library path in preferences');
  return false;
}

/**
 * Ensure library exists at current path
 * Only called after library path is set
 */
function ensureLibrary() {
  if (!currentLibraryPath) {
    console.log('No library path set');
    return false;
  }
  if (!libraryExists(currentLibraryPath)) {
    console.log('Library not found at:', currentLibraryPath);
    return false;
  }
  console.log('Library found at:', currentLibraryPath);

  // Ensure facets.json exists (may be missing in older libraries)
  ensureFacetsJson(currentLibraryPath);

  // Initialize ledgers database
  ledgers.initialize(currentLibraryPath);

  // Initialize programs engine
  programs.initialize(currentLibraryPath, {
    getLibraryPaths,
    readCollection,
    listCollections,
    readTrackMetadata,
    generateUUID,
    shuffleArray
  }, facetIndex);

  // Spawn audio bridge (native Swift audio service)
  const config = loadLibraryConfig(currentLibraryPath);
  if (config?.settings?.useNativeAudio !== false) {
    audioBridge.spawn(currentLibraryPath);
  }

  return true;
}

/**
 * Get album artwork path (thumbnail preferred for UI displays)
 * @param {object} album - Album object with cover attachment ID
 * @param {object} paths - Library paths from getLibraryPaths()
 * @param {boolean} preferThumbnail - Whether to prefer thumbnail over full-size (default: true)
 * @returns {string|null} - Path to artwork file or null
 */
function getAlbumArtPath(album, paths, preferThumbnail = true) {
  if (!album.cover) return null;

  const coverFolderPath = path.join(paths.attachments, `${album.cover}.info`);
  if (!fs.existsSync(coverFolderPath)) return null;

  const coverMetaPath = path.join(coverFolderPath, 'metadata.json');
  if (!fs.existsSync(coverMetaPath)) return null;

  try {
    const coverMeta = JSON.parse(fs.readFileSync(coverMetaPath, 'utf-8'));
    if (!coverMeta || !coverMeta.filename) return null;

    const fullPath = path.join(coverFolderPath, coverMeta.filename);

    if (preferThumbnail) {
      const thumbPath = path.join(coverFolderPath, 'thumbnail.jpg');
      if (fs.existsSync(thumbPath)) {
        return thumbPath;
      }
    }

    return fullPath;
  } catch (e) {
    console.error('Error reading cover metadata:', e);
    return null;
  }
}

/**
 * Load albums from library for display
 * Reads collection JSONs and assembles display data
 */
async function loadAlbumsForDisplay() {
  const paths = getLibraryPaths(currentLibraryPath);

  // Get all album-type collections
  const albums = listCollections(currentLibraryPath, 'album');

  // Helper to get cover/thumbnail paths
  const getCoverPaths = (coverId) => {
    let coverPath = null;
    let thumbnailPath = null;
    let smallThumbnailPath = null;

    if (coverId) {
      const coverFolderPath = path.join(paths.attachments, `${coverId}.info`);
      if (fs.existsSync(coverFolderPath)) {
        const coverMetaPath = path.join(coverFolderPath, 'metadata.json');
        if (fs.existsSync(coverMetaPath)) {
          try {
            const coverMeta = JSON.parse(fs.readFileSync(coverMetaPath, 'utf-8'));
            if (coverMeta && coverMeta.filename) {
              coverPath = path.join(coverFolderPath, coverMeta.filename);
              const thumbPath = path.join(coverFolderPath, 'thumbnail.jpg');
              const smallThumbPath = path.join(coverFolderPath, 'thumbnail-small.jpg');
              if (fs.existsSync(thumbPath)) {
                thumbnailPath = thumbPath;
              } else {
                thumbnailPath = coverPath;
              }
              // Small thumbnail for list views (80x80)
              if (fs.existsSync(smallThumbPath)) {
                smallThumbnailPath = smallThumbPath;
              } else {
                // Fall back to large thumbnail if small doesn't exist
                smallThumbnailPath = thumbnailPath;
              }
            }
          } catch (e) {
            console.error('Error reading cover metadata:', e);
          }
        }
      }
    }

    return { coverPath, thumbnailPath, smallThumbnailPath };
  };

  // Helper to load tracks
  const loadTracks = (trackRefs) => {
    return (trackRefs || []).map(trackRef => {
      const trackFolderPath = path.join(paths.tracks, `${trackRef.id}.info`);
      const trackMeta = readTrackMetadata(trackFolderPath);

      if (trackMeta) {
        // Check if track has its own cover (for stray tracks with embedded art)
        let trackCoverPath = null;
        let trackThumbnailPath = null;
        let trackSmallThumbnailPath = null;
        if (trackMeta.cover) {
          const coverPaths = getCoverPaths(trackMeta.cover);
          trackCoverPath = coverPaths.coverPath;
          trackThumbnailPath = coverPaths.thumbnailPath;
          trackSmallThumbnailPath = coverPaths.smallThumbnailPath;
        }

        return {
          ...trackMeta,
          position: trackRef.position,
          audioPath: path.join(trackFolderPath, trackMeta.filename),
          trackCoverPath,           // Track's own cover (if any)
          trackThumbnailPath,       // Track's own thumbnail (if any)
          trackSmallThumbnailPath   // Track's own small thumbnail (if any)
        };
      }

      return {
        id: trackRef.id,
        position: trackRef.position,
        title: 'Unknown Track',
        error: 'Metadata not found'
      };
    }).sort((a, b) => {
      // Sort by position (which encodes disc*1000 + trackNumber when reordered)
      return (a.position || 0) - (b.position || 0);
    });
  };

  // Enrich albums with display data
  const enrichedAlbums = albums.map(album => {
    const { coverPath, thumbnailPath, smallThumbnailPath } = getCoverPaths(album.cover);
    const tracks = loadTracks(album.tracks);
    const totalSize = tracks.reduce((sum, t) => sum + (t.fileSize || 0), 0);

    // Migrate legacy boolean fields to characteristics array if needed
    let characteristics = album.characteristics || [];
    if (!album.characteristics) {
      // Migrate from legacy boolean fields
      if (album.isCompilation) characteristics.push('Compilation');
      if (album.isSoundtrack) characteristics.push('Soundtrack');
      if (album.isComposerWork) characteristics.push('ComposerWork');
      if (album.isConcert) characteristics.push('Concert');
      if (album.isMiscellanea) characteristics.push('Miscellanea');
      if (album.isReissue) characteristics.push('Reissue');
    }

    // Derive format from isLP for legacy records, default to LP
    const format = album.format || (album.isLP === false ? 'EP' : 'LP');

    return {
      id: album.id,
      type: 'album',
      title: album.name,
      artist: album.artist,
      sortArtist: album.sortArtist,
      sortName: album.sortName,
      sortTitle: album.sortTitle || album.sortName, // sortName is the canonical field
      releaseDate: album.releaseDate,
      genre: album.genre,
      format: format,
      characteristics: characteristics,
      isLP: format === 'LP', // Derive from format for backwards compatibility
      includeInLedgers: album.includeInLedgers,
      backdropBlur: album.backdropBlur,
      useBackgroundImage: album.useBackgroundImage,
      backdropImageId: album.backdropImageId,
      coverPath: coverPath,
      thumbnailPath: thumbnailPath,
      smallThumbnailPath: smallThumbnailPath,
      tracks: tracks,
      trackCount: tracks.length,
      totalSize: totalSize,
      eraParent: album.eraParent,
      eraChildren: album.eraChildren,
      showOnGrid: album.showOnGrid, // For subordinates: show in grid even though they have a parent
      discLabels: album.discLabels,
      createdAt: album.createdAt,
      facets: album.facets || []
    };
  });

  return { albums: enrichedAlbums };
}

/**
 * Create main window
 */
function createWindow() {
  // Start with flexible constraints - the renderer will set appropriate mode
  // once it determines if we're in Foyer or Library mode
  mainWindow = new BrowserWindow({
    width: 700,
    height: 1200,
    minWidth: 700,
    minHeight: 600,
    transparent: false,
    backgroundColor: '#1a0f0a', // Dark mahogany background (no vibrancy)
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // CSP for local-first app: allow local:// protocol, data: URLs, and dev server
      // In production, localhost is not needed but including it doesn't hurt
      devTools: process.env.NODE_ENV !== 'production'
    },
    frame: false,
    titleBarStyle: 'customButtonsOnHover',
    titleBarOverlay: false,
    hasShadow: true,
    trafficLightPosition: { x: -100, y: -100 } // Hide traffic lights by moving them off-screen
  });

  // Load from Vite dev server only in explicit development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    // Uncomment to open dev tools:
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

// ============================================
// App lifecycle
// ============================================

app.whenReady().then(() => {
  // Handle permission requests - auto-grant audio output (not microphone input)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow audio output for Web Audio API, deny microphone/camera
    if (permission === 'media') {
      // We only need audio output, not input - but Chromium bundles them together
      // We'll allow it since we're a music player and need audio output
      callback(true);
    } else if (permission === 'audioCapture') {
      // Explicitly deny microphone capture
      callback(false);
    } else {
      // Default behavior for other permissions
      callback(true);
    }
  });

  // Register custom protocol for serving local files
  protocol.registerFileProtocol('local', (request, callback) => {
    // Strip query parameters (used for cache busting) before resolving the file path
    const urlWithoutProtocol = request.url.replace('local://', '');
    const filePath = urlWithoutProtocol.split('?')[0];
    callback({ path: decodeURIComponent(filePath) });
  });
  
  // Ensure library exists
  ensureLibrary();

  // Set Content Security Policy to silence Electron security warning
  // This is a local-first app with no external resources, so we allow:
  // - 'self' for bundled assets
  // - local: protocol for serving local audio/images
  // - data: for inline SVGs and placeholders
  // - blob: for audio processing
  // - localhost:3000 for Vite dev server (dev only)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' local: data: blob:; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' local: data: blob:; " +
          "media-src 'self' local: blob:; " +
          "connect-src 'self' ws://localhost:* http://localhost:*"
        ]
      }
    });
  });

  // Create window
  createWindow();
});

app.on('window-all-closed', () => {
  // Shutdown audio bridge
  audioBridge.quit();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure audio bridge is shutdown
  audioBridge.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============================================
// Filesystem IPC handlers
// ============================================

// fs:stat - Check if path is file or directory
ipcMain.handle('fs:stat', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
      mtime: stats.mtime
    };
  } catch (err) {
    console.error('fs:stat error:', err);
    return null;
  }
});

