/**
 * The Gloaming - Programs Engine v2
 *
 * A Program is a radio station. It generates an endless stream of tracks
 * from pools you define. Modules play in sequence, rules within a module
 * interleave. That's it.
 *
 * Track Selection: Least-Recently-Played (LRP)
 * - Find tracks with lowest play count in this program run
 * - Among ties, pick randomly
 * - No shuffle toggle needed - the algorithm always does the right thing
 */

const fs = require('fs');
const path = require('path');

let libraryPath = null;
let getLibraryPaths = null;
let readCollection = null;
let listCollections = null;
let readTrackMetadata = null;
let generateUUID = null;
let shuffleArray = null;
let facetIndex = null;

function initialize(libPath, libraryFns, facetIdx) {
  libraryPath = libPath;
  getLibraryPaths = libraryFns.getLibraryPaths;
  readCollection = libraryFns.readCollection;
  listCollections = libraryFns.listCollections;
  readTrackMetadata = libraryFns.readTrackMetadata;
  generateUUID = libraryFns.generateUUID;
  shuffleArray = libraryFns.shuffleArray;
  facetIndex = facetIdx;
}

function getProgramsPath() {
  return path.join(libraryPath, 'programs.json');
}

function loadPrograms() {
  const programsPath = getProgramsPath();
  if (!fs.existsSync(programsPath)) {
    return { version: 2, programs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(programsPath, 'utf8'));
  } catch (err) {
    console.error('Error loading programs:', err);
    return { version: 2, programs: [] };
  }
}

function savePrograms(data) {
  fs.writeFileSync(getProgramsPath(), JSON.stringify(data, null, 2));
}

function getAllPrograms() {
  return loadPrograms().programs;
}

function getProgram(programId) {
  return loadPrograms().programs.find(p => p.id === programId) || null;
}

function createProgram(name) {
  const data = loadPrograms();
  const program = {
    id: generateUUID(),
    name,
    modules: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  data.programs.push(program);
  savePrograms(data);
  return program;
}

function updateProgram(programId, updates) {
  const data = loadPrograms();
  const index = data.programs.findIndex(p => p.id === programId);
  if (index === -1) return null;
  data.programs[index] = {
    ...data.programs[index],
    ...updates,
    modifiedAt: new Date().toISOString()
  };
  savePrograms(data);
  return data.programs[index];
}

function deleteProgram(programId) {
  const data = loadPrograms();
  const index = data.programs.findIndex(p => p.id === programId);
  if (index === -1) return false;
  data.programs.splice(index, 1);
  savePrograms(data);
  return true;
}

function addModule(programId, module) {
  const data = loadPrograms();
  const program = data.programs.find(p => p.id === programId);
  if (!program) return null;

  const newModule = {
    id: generateUUID(),
    name: module.name || 'New Module',
    rules: module.rules || []
  };

  program.modules.push(newModule);
  program.modifiedAt = new Date().toISOString();
  savePrograms(data);
  return newModule;
}

function updateModule(programId, moduleId, updates) {
  const data = loadPrograms();
  const program = data.programs.find(p => p.id === programId);
  if (!program) return null;

  const moduleIndex = program.modules.findIndex(m => m.id === moduleId);
  if (moduleIndex === -1) return null;

  program.modules[moduleIndex] = {
    ...program.modules[moduleIndex],
    ...updates
  };
  program.modifiedAt = new Date().toISOString();
  savePrograms(data);
  return program.modules[moduleIndex];
}

function deleteModule(programId, moduleId) {
  const data = loadPrograms();
  const program = data.programs.find(p => p.id === programId);
  if (!program) return false;

  const moduleIndex = program.modules.findIndex(m => m.id === moduleId);
  if (moduleIndex === -1) return false;

  program.modules.splice(moduleIndex, 1);
  program.modifiedAt = new Date().toISOString();
  savePrograms(data);
  return true;
}

function reorderModules(programId, moduleIds) {
  const data = loadPrograms();
  const program = data.programs.find(p => p.id === programId);
  if (!program) return false;

  const reordered = moduleIds
    .map(id => program.modules.find(m => m.id === id))
    .filter(Boolean);
  program.modules = reordered;
  program.modifiedAt = new Date().toISOString();
  savePrograms(data);
  return true;
}

// Validation is minimal now - programs are always valid
function validateProgram(programId) {
  const program = getProgram(programId);
  if (!program) {
    return { valid: false, errors: ['Program not found'], warnings: [] };
  }

  const warnings = [];

  if (program.modules.length === 0) {
    warnings.push('Program has no modules');
  }

  for (const module of program.modules) {
    if (!module.rules || module.rules.length === 0) {
      warnings.push(`Module "${module.name}" has no rules`);
    }
  }

  return { valid: true, errors: [], warnings };
}

/**
 * Get track IDs for a rule source
 */
function getTrackIdsForSource(sourceType, sourceValue) {
  switch (sourceType) {
    case 'facet':
      return facetIndex ? (facetIndex.getTracksWithFacet(sourceValue) || []) : [];

    case 'artist': {
      const ids = [];
      const albums = listCollections(libraryPath, 'album');
      for (const album of albums) {
        if (album.artist?.toLowerCase() === sourceValue?.toLowerCase()) {
          for (const t of (album.tracks || [])) {
            ids.push(t.id);
          }
        }
      }
      return ids;
    }

    case 'album': {
      const album = readCollection(libraryPath, sourceValue);
      return album?.tracks?.map(t => t.id) || [];
    }

    case 'mixtape': {
      const mixtape = readCollection(libraryPath, sourceValue);
      return mixtape?.tracks?.map(t => t.id) || [];
    }

    case 'any': {
      const ids = [];
      const albums = listCollections(libraryPath, 'album');
      for (const album of albums) {
        for (const t of (album.tracks || [])) {
          ids.push(t.id);
        }
      }
      return ids;
    }

    default:
      return [];
  }
}

/**
 * Select tracks using Least-Recently-Played algorithm
 */
function selectLeastRecentlyPlayed(trackIds, count, playHistory) {
  if (trackIds.length === 0) return [];

  // Sort by play count (ascending), random tiebreaker
  const sorted = trackIds
    .map(id => ({ id, plays: playHistory.get(id) || 0 }))
    .sort((a, b) => {
      if (a.plays !== b.plays) return a.plays - b.plays;
      return Math.random() - 0.5;
    });

  return sorted.slice(0, count).map(t => t.id);
}

/**
 * Interleave tracks from different rules using round-robin
 */
function interleaveByRule(ruleTracks) {
  // Group by ruleId
  const groups = new Map();
  for (const rt of ruleTracks) {
    if (!groups.has(rt.ruleId)) groups.set(rt.ruleId, []);
    groups.get(rt.ruleId).push(rt);
  }

  const result = [];

  // Shuffle group order for variety
  const groupArrays = shuffleArray(Array.from(groups.values()));

  // Round-robin until all exhausted
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const group of groupArrays) {
      if (group.length > 0) {
        result.push(group.shift());
        hasMore = hasMore || group.length > 0;
      }
    }
  }

  return result;
}

/**
 * Generate one cycle of a program (all modules once)
 * Returns array of track IDs
 */
function generateProgramCycle(program, playHistory) {
  const cycleOutput = [];

  for (const module of program.modules) {
    const ruleTracks = [];

    for (const rule of (module.rules || [])) {
      const pool = getTrackIdsForSource(rule.sourceType, rule.sourceValue);
      const selected = selectLeastRecentlyPlayed(pool, rule.count || 1, playHistory);

      // Mark selected tracks as played
      for (const id of selected) {
        playHistory.set(id, (playHistory.get(id) || 0) + 1);
      }

      ruleTracks.push(...selected.map(id => ({ id, ruleId: rule.id })));
    }

    // Interleave tracks from different rules
    const interleaved = interleaveByRule(ruleTracks);
    cycleOutput.push(...interleaved.map(t => t.id));
  }

  return cycleOutput;
}

/**
 * Enrich track IDs with full metadata for queue
 */
function enrichTracks(trackIds) {
  const paths = getLibraryPaths(libraryPath);

  return trackIds.map(trackId => {
    const trackFolder = path.join(paths.tracks, `${trackId}.info`);
    const metadata = readTrackMetadata(trackFolder);
    if (!metadata) return null;

    const album = metadata.albumId ? readCollection(libraryPath, metadata.albumId) : null;
    let albumArt = null;

    if (album?.cover) {
      const coverFolder = path.join(paths.attachments, `${album.cover}.info`);
      const thumbPath = path.join(coverFolder, 'thumbnail.jpg');
      if (fs.existsSync(thumbPath)) {
        albumArt = thumbPath;
      } else {
        try {
          const coverMeta = JSON.parse(fs.readFileSync(path.join(coverFolder, 'metadata.json'), 'utf-8'));
          if (coverMeta?.filename) {
            albumArt = path.join(coverFolder, coverMeta.filename);
          }
        } catch (e) {}
      }
    }

    return {
      id: trackId,
      title: metadata.title || 'Unknown Track',
      artist: metadata.trackArtist || 'Unknown Artist',
      album: metadata.album || album?.name || 'Unknown Album',
      albumId: metadata.albumId,
      duration: metadata.duration || 0,
      audioPath: path.join(trackFolder, metadata.filename),
      albumArt
    };
  }).filter(Boolean);
}

/**
 * Generate a batch of tracks for the queue
 */
function generateProgramRun(programId, options = {}) {
  const program = getProgram(programId);
  if (!program) {
    return { success: false, error: 'Program not found', tracks: [] };
  }

  const validation = validateProgram(programId);

  // Start with empty play history for fresh run
  const playHistory = new Map();
  const maxTracks = options.maxTracks || 100;

  const allTrackIds = [];

  // Generate cycles until we have enough tracks
  while (allTrackIds.length < maxTracks) {
    const cycleIds = generateProgramCycle(program, playHistory);
    if (cycleIds.length === 0) break; // No tracks available
    allTrackIds.push(...cycleIds);
  }

  // Trim to max
  const finalIds = allTrackIds.slice(0, maxTracks);
  const tracks = enrichTracks(finalIds);

  return {
    success: true,
    tracks,
    program: { id: program.id, name: program.name },
    warnings: validation.warnings
  };
}

/**
 * Get available sources for rule creation
 */
function getAvailableSources() {
  const sources = {
    facets: [],
    artists: [],
    albums: [],
    mixtapes: []
  };

  if (facetIndex) {
    sources.facets = facetIndex.getAllFacets().map(f => ({
      value: f.name,
      label: f.name,
      count: f.count
    }));
  }

  const albums = listCollections(libraryPath, 'album');
  const artistSet = new Set();

  for (const album of albums) {
    sources.albums.push({
      value: album.id,
      label: album.name,
      artist: album.artist,
      trackCount: album.tracks?.length || 0
    });
    if (album.artist) artistSet.add(album.artist);
  }

  sources.artists = Array.from(artistSet).sort().map(artist => ({
    value: artist,
    label: artist
  }));

  const mixtapes = listCollections(libraryPath, 'mixtape');
  sources.mixtapes = mixtapes.map(m => ({
    value: m.id,
    label: m.name,
    trackCount: m.tracks?.length || 0
  }));

  return sources;
}

module.exports = {
  initialize,
  loadPrograms,
  getAllPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  addModule,
  updateModule,
  deleteModule,
  reorderModules,
  validateProgram,
  generateProgramRun,
  getAvailableSources,
  getTrackIdsForSource
};
