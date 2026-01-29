/**
 * The Gloaming - Library Management
 * 
 * Handles library initialization, structure creation, and UUID generation.
 * The library is a self-contained folder that owns all imported music.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Default library location
const DEFAULT_LIBRARY_NAME = 'The Gloaming.library';
const DEFAULT_LIBRARY_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  'Music',
  DEFAULT_LIBRARY_NAME
);

/**
 * Generate a unique ID (similar to Eagle's format)
 * Format: 13 uppercase alphanumeric characters
 */
function generateUUID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(13);
  let result = '';
  for (let i = 0; i < 13; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Library folder structure
 * Note: covers/ folder has been deprecated - all images now live in attachments/
 * with auto-generated thumbnails for grid display.
 */
const LIBRARY_STRUCTURE = {
  tracks: 'tracks',           // Track UUID folders
  collections: 'collections', // Album, mixtape, facet, smart JSONs
  attachments: 'attachments', // Attachment UUID folders (includes album art + thumbnails)
};


/**
 * Default facets.json content
 * Facets are just strings. Groups are optional organization.
 */
const DEFAULT_FACETS = {
  version: 2,
  // Groups are optional user-created folders for organizing facets
  groups: [
    // { id: 'people', name: 'People', color: '#8B4D6B', facets: ['Joey', 'Marcus'] }
  ],
  // Colors for individual facets (optional)
  colors: {
    // 'Joey': '#8B4D6B'
  },
  // Starred/pinned facets for quick access
  starred: [],
  // Recently used facets (auto-updated)
  recent: []
};

/**
 * Default library.json content
 */
const DEFAULT_LIBRARY_CONFIG = {
  version: 1,
  name: 'My Library',
  createdAt: null,  // Set on creation
  settings: {
    showRatings: false,
    defaultView: 'RECORDS',
    defaultBackdropBlur: 0,
    theme: 'system'  // 'cabinet', 'daylight', or 'system'
  }
};

/**
 * Check if a library exists at the given path
 */
function libraryExists(libraryPath) {
  const libraryJsonPath = path.join(libraryPath, 'library.json');
  return fs.existsSync(libraryJsonPath);
}

/**
 * Initialize a new library at the given path
 * Creates folder structure and default config files
 */
function initializeLibrary(libraryPath = DEFAULT_LIBRARY_PATH) {
  console.log('Initializing library at:', libraryPath);
  
  // Create main library folder
  if (!fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath, { recursive: true });
  }
  
  // Create subfolders
  for (const [key, folder] of Object.entries(LIBRARY_STRUCTURE)) {
    const folderPath = path.join(libraryPath, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      console.log('Created:', folder);
    }
  }
  
  // Create library.json
  const libraryJsonPath = path.join(libraryPath, 'library.json');
  if (!fs.existsSync(libraryJsonPath)) {
    const config = {
      ...DEFAULT_LIBRARY_CONFIG,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(libraryJsonPath, JSON.stringify(config, null, 2));
    console.log('Created: library.json');
  }
  
  // Create facets.json
  const facetsJsonPath = path.join(libraryPath, 'facets.json');
  if (!fs.existsSync(facetsJsonPath)) {
    fs.writeFileSync(facetsJsonPath, JSON.stringify(DEFAULT_FACETS, null, 2));
    console.log('Created: facets.json');
  }
  
  // Create empty ledgers.db (SQLite)
  const ledgersDbPath = path.join(libraryPath, 'ledgers.db');
  if (!fs.existsSync(ledgersDbPath)) {
    // For now, just create empty file - we'll initialize SQLite properly later
    fs.writeFileSync(ledgersDbPath, '');
    console.log('Created: ledgers.db (placeholder)');
  }
  
  console.log('Library initialized successfully');
  return {
    success: true,
    path: libraryPath
  };
}

/**
 * Load library configuration
 */
function loadLibraryConfig(libraryPath) {
  const libraryJsonPath = path.join(libraryPath, 'library.json');
  
  if (!fs.existsSync(libraryJsonPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(libraryJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error loading library config:', err);
    return null;
  }
}

/**
 * Save library configuration
 */
function saveLibraryConfig(libraryPath, config) {
  const libraryJsonPath = path.join(libraryPath, 'library.json');
  fs.writeFileSync(libraryJsonPath, JSON.stringify(config, null, 2));
}

/**
 * Load facets configuration
 */
function loadFacets(libraryPath) {
  const facetsJsonPath = path.join(libraryPath, 'facets.json');
  
  if (!fs.existsSync(facetsJsonPath)) {
    return DEFAULT_FACETS;
  }
  
  try {
    const content = fs.readFileSync(facetsJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error loading facets:', err);
    return DEFAULT_FACETS;
  }
}

/**
 * Save facets configuration
 */
function saveFacets(libraryPath, facets) {
  if (!libraryPath) {
    console.error('[saveFacets] No library path provided');
    return false;
  }

  const facetsJsonPath = path.join(libraryPath, 'facets.json');

  try {
    fs.writeFileSync(facetsJsonPath, JSON.stringify(facets, null, 2));
    console.log('[saveFacets] Saved facets.json');
    return true;
  } catch (err) {
    console.error('[saveFacets] Error writing facets.json:', err);
    return false;
  }
}

/**
 * Ensure facets.json exists (creates it if missing)
 */
function ensureFacetsJson(libraryPath) {
  if (!libraryPath) return false;

  const facetsJsonPath = path.join(libraryPath, 'facets.json');

  if (!fs.existsSync(facetsJsonPath)) {
    console.log('[ensureFacetsJson] Creating missing facets.json');
    fs.writeFileSync(facetsJsonPath, JSON.stringify(DEFAULT_FACETS, null, 2));
  }

  return true;
}

/**
 * Get path helpers for library structure
 */
function getLibraryPaths(libraryPath) {
  return {
    root: libraryPath,
    tracks: path.join(libraryPath, LIBRARY_STRUCTURE.tracks),
    collections: path.join(libraryPath, LIBRARY_STRUCTURE.collections),
    attachments: path.join(libraryPath, LIBRARY_STRUCTURE.attachments),
    libraryJson: path.join(libraryPath, 'library.json'),
    facetsJson: path.join(libraryPath, 'facets.json'),
    ledgersDb: path.join(libraryPath, 'ledgers.db')
  };
}

/**
 * Create a track folder with metadata.json
 */
function createTrackFolder(libraryPath, trackId) {
  const trackFolderPath = path.join(
    libraryPath, 
    LIBRARY_STRUCTURE.tracks, 
    `${trackId}.info`
  );
  
  if (!fs.existsSync(trackFolderPath)) {
    fs.mkdirSync(trackFolderPath, { recursive: true });
  }
  
  return trackFolderPath;
}

/**
 * Create an attachment folder with metadata.json
 */
function createAttachmentFolder(libraryPath, attachmentId) {
  const attachmentFolderPath = path.join(
    libraryPath,
    LIBRARY_STRUCTURE.attachments,
    `${attachmentId}.info`
  );
  
  if (!fs.existsSync(attachmentFolderPath)) {
    fs.mkdirSync(attachmentFolderPath, { recursive: true });
  }
  
  return attachmentFolderPath;
}

/**
 * Write track metadata
 */
function writeTrackMetadata(trackFolderPath, metadata) {
  const metadataPath = path.join(trackFolderPath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Read track metadata
 */
function readTrackMetadata(trackFolderPath) {
  const metadataPath = path.join(trackFolderPath, 'metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading track metadata:', err);
    return null;
  }
}

/**
 * Write collection (album/mixtape/facet/smart)
 */
function writeCollection(libraryPath, collection) {
  const collectionPath = path.join(
    libraryPath,
    LIBRARY_STRUCTURE.collections,
    `${collection.id}.json`
  );
  fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));
}

/**
 * Read collection by ID
 */
function readCollection(libraryPath, collectionId) {
  const collectionPath = path.join(
    libraryPath,
    LIBRARY_STRUCTURE.collections,
    `${collectionId}.json`
  );
  
  if (!fs.existsSync(collectionPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(collectionPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading collection:', err);
    return null;
  }
}

/**
 * List all collections of a given type
 */
function listCollections(libraryPath, type = null) {
  const collectionsPath = path.join(libraryPath, LIBRARY_STRUCTURE.collections);
  
  if (!fs.existsSync(collectionsPath)) {
    return [];
  }
  
  const files = fs.readdirSync(collectionsPath)
    .filter(f => f.endsWith('.json'));
  
  const collections = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(collectionsPath, file), 'utf-8');
      const collection = JSON.parse(content);
      
      if (!type || collection.type === type) {
        collections.push(collection);
      }
    } catch (err) {
      console.error('Error reading collection file:', file, err);
    }
  }
  
  return collections;
}

/**
 * List all tracks in library
 */
function listAllTracks(libraryPath) {
  const tracksPath = path.join(libraryPath, LIBRARY_STRUCTURE.tracks);
  
  if (!fs.existsSync(tracksPath)) {
    return [];
  }
  
  const folders = fs.readdirSync(tracksPath)
    .filter(f => f.endsWith('.info'));
  
  const tracks = [];
  for (const folder of folders) {
    const metadata = readTrackMetadata(path.join(tracksPath, folder));
    if (metadata) {
      tracks.push(metadata);
    }
  }
  
  return tracks;
}

/**
 * Fisher-Yates shuffle algorithm with optional seed for reproducibility
 * @param {Array} array - Array to shuffle
 * @param {number|null} seed - Optional seed for reproducible randomization
 * @returns {Array} - New shuffled array (does not mutate original)
 */
function shuffleArray(array, seed = null) {
  const arr = [...array];

  // Simple seeded random number generator (mulberry32)
  let random;
  if (seed !== null) {
    let t = seed + 0x6D2B79F5;
    random = () => {
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  } else {
    random = Math.random;
  }

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

/**
 * Generate a random seed for shuffle reproducibility
 * @returns {number} - Random seed value
 */
function generateShuffleSeed() {
  return Math.floor(Math.random() * 2147483647);
}

/**
 * Write attachment metadata
 */
function writeAttachmentMetadata(attachmentFolderPath, metadata) {
  const metadataPath = path.join(attachmentFolderPath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Read attachment metadata
 */
function readAttachmentMetadata(attachmentFolderPath) {
  const metadataPath = path.join(attachmentFolderPath, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading attachment metadata:', err);
    return null;
  }
}

/**
 * List all attachments in library
 */
function listAllAttachments(libraryPath) {
  const attachmentsPath = path.join(libraryPath, LIBRARY_STRUCTURE.attachments);

  if (!fs.existsSync(attachmentsPath)) {
    return [];
  }

  const folders = fs.readdirSync(attachmentsPath)
    .filter(f => f.endsWith('.info'));

  const attachments = [];
  for (const folder of folders) {
    const metadata = readAttachmentMetadata(path.join(attachmentsPath, folder));
    if (metadata) {
      attachments.push({
        ...metadata,
        folderPath: path.join(attachmentsPath, folder)
      });
    }
  }

  return attachments;
}

/**
 * Load session state from session.json
 * @param {string} libraryPath - Path to library folder
 * @returns {object|null} - Session state or null if not found
 */
function loadSession(libraryPath) {
  try {
    const sessionPath = path.join(libraryPath, 'session.json');
    if (!fs.existsSync(sessionPath)) {
      return null;
    }
    const data = fs.readFileSync(sessionPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading session:', err);
    return null;
  }
}

/**
 * Save session state to session.json
 * @param {string} libraryPath - Path to library folder
 * @param {object} session - Session state to save
 * @returns {boolean} - Success status
 */
function saveSession(libraryPath, session) {
  try {
    const sessionPath = path.join(libraryPath, 'session.json');
    const data = {
      ...session,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving session:', err);
    return false;
  }
}


module.exports = {
  DEFAULT_LIBRARY_PATH,
  LIBRARY_STRUCTURE,
  generateUUID,
  libraryExists,
  initializeLibrary,
  loadLibraryConfig,
  saveLibraryConfig,
  loadFacets,
  saveFacets,
  ensureFacetsJson,
  getLibraryPaths,
  createTrackFolder,
  createAttachmentFolder,
  writeTrackMetadata,
  readTrackMetadata,
  writeAttachmentMetadata,
  readAttachmentMetadata,
  listAllAttachments,
  writeCollection,
  readCollection,
  listCollections,
  listAllTracks,
  shuffleArray,
  generateShuffleSeed,
  loadSession,
  saveSession
};
