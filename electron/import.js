/**
 * The Gloaming - Import Module v2
 *
 * Philosophy: Import fast and dumb. Fix in Panopticon.
 *
 * Flow:
 * 1. User drops file(s)/folder(s)
 * 2. Scan recursively for audio files
 * 3. Extract metadata, group by albumArtist:::album
 * 4. Exact match existing records or create new ones
 * 5. Copy files, report errors
 */

const path = require('path');
const fs = require('fs');
const mm = require('music-metadata');
const {
  generateUUID,
  writeCollection,
  readCollection,
  getLibraryPaths,
  listCollections
} = require('./library');
const { generateThumbnailsFromBuffer } = require('./thumbnails');

// Supported formats
const AUDIO_EXTENSIONS = ['.m4a', '.flac', '.mp3', '.wav', '.aiff', '.aac', '.ogg', '.wma'];

// Folder names that shouldn't be used as album names (case-insensitive)
const UNHELPFUL_FOLDER_NAMES = [
  'downloads', 'desktop', 'documents', 'music', 'audio', 'files',
  'new folder', 'temp', 'tmp', 'untitled', 'folder', 'unknown',
  'misc', 'miscellaneous', 'various', 'stuff', 'other', 'unsorted'
];

/**
 * Check if a folder name is unhelpful for deriving album info
 */
function isUnhelpfulFolderName(name) {
  return UNHELPFUL_FOLDER_NAMES.includes(name.toLowerCase().trim());
}

/**
 * Parse track filename to extract title (and optionally track number)
 * Used as fallback when no title tag exists
 */
function parseTrackFilename(filename) {
  const name = filename.replace(/\.[^.]+$/, ''); // Remove extension

  // Pattern: "1-01 Track Name" (disc-track)
  const discTrackMatch = name.match(/^(\d+)-(\d+)[\s\-._]+(.+)$/);
  if (discTrackMatch) {
    return {
      disc: parseInt(discTrackMatch[1]),
      trackNumber: parseInt(discTrackMatch[2]),
      title: discTrackMatch[3].trim()
    };
  }

  // Pattern: "01 Track Name" or "01. Track Name" or "01 - Track Name"
  const trackMatch = name.match(/^(\d+)[\s\-._]+(.+)$/);
  if (trackMatch) {
    return {
      disc: null,
      trackNumber: parseInt(trackMatch[1]),
      title: trackMatch[2].trim()
    };
  }

  // No number prefix - just title
  return { disc: null, trackNumber: null, title: name.trim() };
}

/**
 * Get audio file extension type for format field
 */
function getFormatFromExtension(ext) {
  const formats = {
    '.flac': 'FLAC',
    '.m4a': 'AAC',
    '.mp3': 'MP3',
    '.wav': 'WAV',
    '.aiff': 'AIFF',
    '.aac': 'AAC',
    '.ogg': 'OGG',
    '.wma': 'WMA'
  };
  return formats[ext.toLowerCase()] || 'Unknown';
}

/**
 * Extract metadata from audio file using music-metadata
 */
async function extractAudioMetadata(filePath) {
  try {
    const metadata = await mm.parseFile(filePath);
    const { format, common } = metadata;

    return {
      // From embedded tags
      title: common.title || null,
      artist: common.artist || null,
      albumArtist: common.albumartist || null,
      album: common.album || null,
      trackNumber: common.track?.no || null,
      trackTotal: common.track?.of || null,
      discNumber: common.disk?.no || null,
      discTotal: common.disk?.of || null,
      year: common.year || null,
      date: common.date || null,
      genre: common.genre?.[0] || null,

      // Audio properties
      duration: format.duration || null,
      bitrate: format.bitrate || null,
      sampleRate: format.sampleRate || null,
      bitDepth: format.bitsPerSample || null,
      channels: format.numberOfChannels || null,
      codec: format.codec || null,
      lossless: format.lossless || false,

      // Has embedded picture?
      hasPicture: common.picture && common.picture.length > 0
    };
  } catch (err) {
    console.error('Error extracting metadata from:', filePath, err.message);
    return null;
  }
}

/**
 * Extract embedded cover art from audio file
 * Returns { data: Buffer, format: string } or null
 */
async function extractEmbeddedCover(filePath) {
  try {
    const metadata = await mm.parseFile(filePath);
    const pictures = metadata.common.picture;

    if (pictures && pictures.length > 0) {
      const pic = pictures[0];
      return {
        data: pic.data,
        format: pic.format
      };
    }

    return null;
  } catch (err) {
    console.error('Error extracting cover from:', filePath, err.message);
    return null;
  }
}

/**
 * Scan input paths recursively for audio files
 * Returns array of { sourcePath, filename, parentFolder }
 */
function scanForAudioFiles(inputPaths) {
  const results = [];

  const scanDir = (dirPath) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      console.error('Error reading directory:', dirPath, err.message);
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and macOS resource forks
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recurse into all directories
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          results.push({
            sourcePath: fullPath,
            filename: entry.name,
            ext,
            parentFolder: path.basename(dirPath)
          });
        }
      }
    }
  };

  for (const inputPath of inputPaths) {
    try {
      const stats = fs.statSync(inputPath);
      if (stats.isFile()) {
        const ext = path.extname(inputPath).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          results.push({
            sourcePath: inputPath,
            filename: path.basename(inputPath),
            ext,
            parentFolder: path.basename(path.dirname(inputPath))
          });
        }
      } else if (stats.isDirectory()) {
        scanDir(inputPath);
      }
    } catch (err) {
      console.error('Error accessing path:', inputPath, err.message);
    }
  }

  return results;
}

/**
 * Normalize string for grouping key - trim whitespace
 * Empty or whitespace-only strings become placeholder
 */
function normalizeForKey(str, placeholder) {
  if (!str || typeof str !== 'string') return placeholder;
  const trimmed = str.trim();
  return trimmed === '' ? placeholder : trimmed;
}

/**
 * Build grouping key for a track
 * Key format: albumArtist:::album
 *
 * Tag extraction priority (per spec):
 * - Album Artist: [Album Artist] → [Artist] → "[Unknown Artist]"
 * - Album: [Album] → parent folder name (if helpful) → "Strays"
 */
function buildGroupKey(metadata, parentFolder) {
  // Album Artist priority
  const albumArtist = normalizeForKey(
    metadata?.albumArtist || metadata?.artist,
    '[Unknown Artist]'
  );

  // Album priority - if no album tag and unhelpful folder, it's a stray
  let album = metadata?.album?.trim();
  if (!album) {
    if (isUnhelpfulFolderName(parentFolder)) {
      album = 'Strays';
    } else {
      album = parentFolder || 'Strays';
    }
  }
  album = normalizeForKey(album, 'Strays');

  return `${albumArtist}:::${album}`;
}

/**
 * Import cover art from embedded data
 * Creates attachment with original image + thumbnail
 */
async function importCoverFromData(embeddedCover, recordId, recordName, paths) {
  const coverAttachmentId = generateUUID();

  // Determine extension from mime type
  const extMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const coverExt = extMap[embeddedCover.format] || '.jpg';
  const coverFilename = `cover${coverExt}`;

  // Create attachment folder and write cover
  const coverFolderPath = path.join(paths.attachments, `${coverAttachmentId}.info`);
  fs.mkdirSync(coverFolderPath, { recursive: true });

  const coverDestPath = path.join(coverFolderPath, coverFilename);
  fs.writeFileSync(coverDestPath, embeddedCover.data);

  // Generate both large (600x600) and small (80x80) thumbnails
  let hasThumbnail = false;
  let hasSmallThumbnail = false;
  try {
    const result = await generateThumbnailsFromBuffer(embeddedCover.data, coverFolderPath);
    hasThumbnail = result.large;
    hasSmallThumbnail = result.small;
  } catch (err) {
    console.error('Failed to generate thumbnails:', err.message);
  }

  // Write cover attachment metadata
  const coverMetadata = {
    id: coverAttachmentId,
    filename: coverFilename,
    name: `${recordName} Cover`,
    type: 'image',
    hasThumbnail,
    hasSmallThumbnail,
    fileSize: embeddedCover.data.length,
    addedAt: new Date().toISOString(),
    source: 'embedded',
    linkedTo: [{ type: 'collection', id: recordId }]
  };
  fs.writeFileSync(
    path.join(coverFolderPath, 'metadata.json'),
    JSON.stringify(coverMetadata, null, 2)
  );

  return coverAttachmentId;
}

/**
 * Import a single track file to the library
 * Returns { success, trackId, error }
 */
async function importTrackFile(audioFile, metadata, recordId, paths) {
  try {
    const trackId = generateUUID();
    const trackFolderPath = path.join(paths.tracks, `${trackId}.info`);
    fs.mkdirSync(trackFolderPath, { recursive: true });

    // Copy audio file (preserve original filename)
    const destAudioPath = path.join(trackFolderPath, audioFile.filename);
    fs.copyFileSync(audioFile.sourcePath, destAudioPath);

    // Get file stats
    const stats = fs.statSync(destAudioPath);

    // Parse filename for fallbacks
    const parsed = parseTrackFilename(audioFile.filename);

    // Track artist: the performer of this specific track (from ARTIST tag)
    const trackArtist = metadata?.artist || metadata?.albumArtist || parsed.artist || '[Unknown Artist]';

    // Album artist: the record's artist (from ALBUMARTIST tag, or ARTIST if not set)
    const albumArtist = metadata?.albumArtist || metadata?.artist || parsed.artist || '[Unknown Artist]';

    // Album name: the record's title
    const album = metadata?.album || '[Unknown Album]';

    // Create track metadata
    const trackMetadata = {
      id: trackId,
      albumId: recordId,
      filename: audioFile.filename,
      title: metadata?.title || parsed.title || '[Unknown Track]',
      trackArtist,   // Track's performer (always populated)
      albumArtist,   // Parent record's artist (always populated)
      album,         // Parent record's name (always populated)
      duration: metadata?.duration || null,
      disc: metadata?.discNumber || null,
      trackNumber: metadata?.trackNumber || null,
      format: metadata?.codec || getFormatFromExtension(audioFile.ext),
      bitDepth: metadata?.bitDepth || null,
      sampleRate: metadata?.sampleRate || null,
      bitrate: metadata?.bitrate || null,
      channels: metadata?.channels || null,
      lossless: metadata?.lossless || false,
      fileSize: stats.size,
      addedAt: new Date().toISOString(),
      importSource: {
        path: audioFile.sourcePath
      },
      facets: [],
      rating: null,
      lyrics: null,
      notes: null,
      attachments: []
    };

    // Write track metadata
    fs.writeFileSync(
      path.join(trackFolderPath, 'metadata.json'),
      JSON.stringify(trackMetadata, null, 2)
    );

    return { success: true, trackId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Main import function - v2 simplified flow
 *
 * @param {string[]} inputPaths - Array of file/folder paths to import
 * @param {string} libraryPath - Path to the library
 * @param {object} options - { onProgress }
 * @returns {object} - { success, imported, failed, records }
 */
async function importFiles(inputPaths, libraryPath, options = {}) {
  const { onProgress = () => {} } = options;
  const paths = getLibraryPaths(libraryPath);

  // Results tracking
  const errors = [];
  const importedTracks = [];
  const affectedRecords = new Map(); // recordId -> record object

  // === PHASE 1: Scan for audio files ===
  onProgress({ stage: 'scanning', message: 'Scanning for audio files...' });

  const audioFiles = scanForAudioFiles(inputPaths);

  if (audioFiles.length === 0) {
    return {
      success: false,
      error: 'No audio files found',
      imported: 0,
      failed: 0,
      records: []
    };
  }

  onProgress({ stage: 'scanning', message: `Found ${audioFiles.length} audio files` });

  // === PHASE 2: Extract metadata and group tracks ===
  onProgress({ stage: 'analyzing', message: 'Reading metadata...' });

  const trackGroups = {}; // key -> { albumArtist, album, tracks: [] }

  for (let i = 0; i < audioFiles.length; i++) {
    const audioFile = audioFiles[i];

    if (i % 10 === 0) {
      onProgress({
        stage: 'analyzing',
        message: `Reading metadata... ${i + 1}/${audioFiles.length}`,
        progress: i / audioFiles.length
      });
    }

    const metadata = await extractAudioMetadata(audioFile.sourcePath);
    const groupKey = buildGroupKey(metadata, audioFile.parentFolder);

    if (!trackGroups[groupKey]) {
      // Parse the key to get artist and album
      const [albumArtist, album] = groupKey.split(':::');
      trackGroups[groupKey] = {
        albumArtist,
        album,
        tracks: []
      };
    }

    trackGroups[groupKey].tracks.push({
      audioFile,
      metadata
    });
  }

  // === PHASE 3: Build map of existing records ===
  const existingRecords = {};
  const allRecords = listCollections(libraryPath, 'album');
  for (const record of allRecords) {
    const key = `${record.artist}:::${record.name}`;
    existingRecords[key] = record;
  }

  // === PHASE 4: Import each group ===
  const groupKeys = Object.keys(trackGroups);

  for (let gi = 0; gi < groupKeys.length; gi++) {
    const groupKey = groupKeys[gi];
    const group = trackGroups[groupKey];

    onProgress({
      stage: 'importing',
      message: `Importing: ${group.album} (${group.tracks.length} tracks)`,
      progress: gi / groupKeys.length
    });

    // Check for exact match with existing record
    const existingRecord = existingRecords[groupKey];
    let record;
    let isNewRecord = false;

    if (existingRecord) {
      // Add to existing record - load fresh copy
      record = readCollection(libraryPath, existingRecord.id);
      if (!record) {
        // Shouldn't happen, but handle gracefully
        console.error('Could not read existing record:', existingRecord.id);
        continue;
      }
    } else {
      // Create new record
      isNewRecord = true;
      const recordId = generateUUID();
      const firstTrackMeta = group.tracks[0]?.metadata;

      record = {
        id: recordId,
        type: 'album',
        name: group.album,
        artist: group.albumArtist,
        releaseDate: firstTrackMeta?.year ? String(firstTrackMeta.year) : null,
        genre: firstTrackMeta?.genre || null,
        isLP: true,
        eraParent: null,
        eraChildren: [],
        cover: null,
        rating: null,
        discLabels: {},
        attachments: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        tracks: []
      };
    }

    // Import tracks
    for (let ti = 0; ti < group.tracks.length; ti++) {
      const { audioFile, metadata } = group.tracks[ti];

      const result = await importTrackFile(audioFile, metadata, record.id, paths);

      if (result.success) {
        // Add track reference with position: null (user reorders in Panopticon)
        record.tracks.push({ id: result.trackId, position: null });
        importedTracks.push({
          trackId: result.trackId,
          filename: audioFile.filename,
          recordId: record.id
        });
      } else {
        errors.push({
          file: audioFile.filename,
          path: audioFile.sourcePath,
          error: result.error
        });
      }
    }

    // Handle cover art for NEW records only
    if (isNewRecord && record.tracks.length > 0) {
      // Find first track with embedded art
      for (const { audioFile } of group.tracks) {
        const embeddedCover = await extractEmbeddedCover(audioFile.sourcePath);
        if (embeddedCover) {
          try {
            const coverId = await importCoverFromData(embeddedCover, record.id, record.name, paths);
            record.cover = coverId;
            record.attachments = [coverId];
          } catch (err) {
            console.error('Failed to import cover art:', err.message);
          }
          break; // Only use first cover found
        }
      }
    }

    // Save record
    record.modifiedAt = new Date().toISOString();
    writeCollection(libraryPath, record);
    affectedRecords.set(record.id, record);
  }

  onProgress({ stage: 'complete', message: 'Import complete!' });

  // Build result summary
  const recordSummary = Array.from(affectedRecords.values()).map(r => ({
    id: r.id,
    name: r.name,
    artist: r.artist,
    trackCount: r.tracks.length,
    isNew: !existingRecords[`${r.artist}:::${r.name}`]
  }));

  return {
    success: errors.length === 0,
    imported: importedTracks.length,
    failed: errors.length,
    errors: errors.length > 0 ? errors : null,
    records: recordSummary
  };
}

// ============================================
// Legacy functions for Panopticon induction system
// These are kept for backward compatibility
// ============================================

/**
 * Check if a folder name looks like a disc folder (e.g., "Disc 1", "CD 2")
 */
function isDiscFolder(folderName) {
  const discPatterns = [
    /^disc\s*\d+$/i,
    /^cd\s*\d+$/i,
    /^disk\s*\d+$/i,
    /^d\d+$/i
  ];
  return discPatterns.some(pattern => pattern.test(folderName.trim()));
}

/**
 * Extract disc number from a folder name
 */
function extractDiscNumber(folderName) {
  const match = folderName.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

/**
 * Legacy scan function for Panopticon induction
 * Returns array of { sourcePath, filename, parsed, ext, discFromFolder }
 */
function scanFolderForAudio(folderPath, recursive = true) {
  const results = [];

  const scanDir = (dirPath, inheritedDisc = null) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      console.error('Error reading directory:', dirPath, err.message);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        if (isDiscFolder(entry.name)) {
          const discNum = extractDiscNumber(entry.name);
          scanDir(fullPath, discNum);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          const parsed = parseTrackFilename(entry.name);
          results.push({
            sourcePath: fullPath,
            filename: entry.name,
            parsed,
            ext,
            discFromFolder: inheritedDisc
          });
        }
      }
    }
  };

  scanDir(folderPath);

  // Sort by disc, then track number, then filename
  results.sort((a, b) => {
    const discA = a.discFromFolder || a.parsed.disc || 1;
    const discB = b.discFromFolder || b.parsed.disc || 1;
    if (discA !== discB) return discA - discB;

    const trackA = a.parsed.trackNumber || 0;
    const trackB = b.parsed.trackNumber || 0;
    if (trackA !== trackB) return trackA - trackB;

    return a.filename.localeCompare(b.filename);
  });

  return results;
}

/**
 * Find cover art in a folder (legacy for Panopticon)
 */
function findCoverArt(folderPath) {
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  try {
    const files = fs.readdirSync(folderPath).filter(f => !f.startsWith('.'));

    // Priority 1: Named cover files
    const priorityNames = ['cover', 'folder', 'front', 'album', 'artwork'];
    for (const name of priorityNames) {
      for (const ext of IMAGE_EXTENSIONS) {
        const match = files.find(f => f.toLowerCase() === `${name}${ext}`);
        if (match) return path.join(folderPath, match);
      }
    }

    // Priority 2: Any image file (pick largest)
    const imageFiles = files.filter(f =>
      IMAGE_EXTENSIONS.some(ext => f.toLowerCase().endsWith(ext))
    );

    if (imageFiles.length === 1) {
      return path.join(folderPath, imageFiles[0]);
    }

    if (imageFiles.length > 1) {
      let largest = { file: null, size: 0 };
      for (const img of imageFiles) {
        const stats = fs.statSync(path.join(folderPath, img));
        if (stats.size > largest.size) {
          largest = { file: img, size: stats.size };
        }
      }
      if (largest.file) return path.join(folderPath, largest.file);
    }

    return null;
  } catch (err) {
    console.error('Error finding cover art:', err);
    return null;
  }
}

/**
 * Legacy import function for adding tracks to existing album (Panopticon)
 */
async function importToExistingAlbum(files, record, libraryPath) {
  // Use the new v2 import for this - it handles adding to existing records
  const paths = files.map(f => f.sourcePath || f);
  const result = await importFiles(paths, libraryPath, {});
  return {
    success: result.imported > 0,
    trackCount: result.imported,
    errors: result.errors
  };
}

/**
 * Legacy import function for creating new album (Panopticon induction)
 */
async function importAsNewAlbum(albumGroup, libraryPath, options = {}) {
  // Extract file paths from albumGroup
  const paths = albumGroup.files?.map(f => f.sourcePath || f) || [];
  if (paths.length === 0) {
    return { success: false, error: 'No files to import' };
  }

  const result = await importFiles(paths, libraryPath, {});

  // Return in legacy format
  if (result.records && result.records.length > 0) {
    const record = result.records[0];
    return {
      success: true,
      albumId: record.id,
      albumName: record.name,
      artistName: record.artist,
      trackCount: record.trackCount,
      hasCover: false // v2 handles cover internally
    };
  }

  return {
    success: result.imported > 0,
    error: result.error
  };
}

/**
 * Legacy single file import (Panopticon)
 */
async function importSingleFile(filePath, libraryPath, options = {}) {
  const result = await importFiles([filePath], libraryPath, {});
  return {
    success: result.imported > 0,
    trackId: result.records?.[0]?.id,
    error: result.error
  };
}

/**
 * Legacy cover import from file (Panopticon)
 */
async function importCoverFromFile(coverSourcePath, albumId, albumName, paths) {
  const { generateThumbnails } = require('./thumbnails');

  const coverAttachmentId = generateUUID();
  const coverExt = path.extname(coverSourcePath);
  const coverFilename = `cover${coverExt}`;

  const coverFolderPath = path.join(paths.attachments, `${coverAttachmentId}.info`);
  fs.mkdirSync(coverFolderPath, { recursive: true });

  const coverDestPath = path.join(coverFolderPath, coverFilename);
  fs.copyFileSync(coverSourcePath, coverDestPath);

  // Generate both large (600x600) and small (80x80) thumbnails
  let hasThumbnail = false;
  let hasSmallThumbnail = false;
  try {
    const result = await generateThumbnails(coverDestPath, coverFolderPath);
    hasThumbnail = result.large;
    hasSmallThumbnail = result.small;
  } catch (err) {
    console.error('Failed to generate thumbnails:', err.message);
  }

  const coverMetadata = {
    id: coverAttachmentId,
    filename: coverFilename,
    name: `${albumName} Cover`,
    type: 'image',
    hasThumbnail,
    hasSmallThumbnail,
    fileSize: fs.statSync(coverDestPath).size,
    addedAt: new Date().toISOString(),
    linkedTo: [{ type: 'collection', id: albumId }]
  };
  fs.writeFileSync(
    path.join(coverFolderPath, 'metadata.json'),
    JSON.stringify(coverMetadata, null, 2)
  );

  return coverAttachmentId;
}

module.exports = {
  // v2 exports
  AUDIO_EXTENSIONS,
  importFiles,
  extractAudioMetadata,
  extractEmbeddedCover,
  scanForAudioFiles,
  buildGroupKey,
  isUnhelpfulFolderName,

  // Legacy exports for Panopticon induction
  scanFolderForAudio,
  findCoverArt,
  importAsNewAlbum,
  importToExistingAlbum,
  importSingleFile,
  importCoverFromFile,
  importCoverFromData
};
