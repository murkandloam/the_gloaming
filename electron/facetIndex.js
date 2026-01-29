/**
 * The Gloaming - Facet Index System
 * 
 * Maintains an in-memory index of facets -> track IDs for fast lookups.
 * Built on startup by scanning all track metadata, then kept in sync
 * as facets are added/removed.
 */

const path = require('path');
const fs = require('fs');

// The index: { 'facet name': Set of track IDs }
let facetIndex = {};

// Reverse index: { trackId: Set of facets }
let trackFacets = {};

// All unique facets with counts
let facetCounts = {};

// Library path reference
let libraryPath = null;

/**
 * Initialize/rebuild the facet index by scanning all tracks
 */
function buildIndex(libPath) {
  libraryPath = libPath;
  facetIndex = {};
  trackFacets = {};
  facetCounts = {};
  
  const tracksPath = path.join(libraryPath, 'tracks');
  
  if (!fs.existsSync(tracksPath)) {
    console.log('[FacetIndex] No tracks folder found');
    return;
  }
  
  const trackFolders = fs.readdirSync(tracksPath)
    .filter(f => f.endsWith('.info'));
  
  console.log(`[FacetIndex] Scanning ${trackFolders.length} tracks...`);
  
  for (const folder of trackFolders) {
    const metadataPath = path.join(tracksPath, folder, 'metadata.json');
    
    if (!fs.existsSync(metadataPath)) continue;
    
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const trackId = metadata.id || folder.replace('.info', '');
      const facets = metadata.facets || [];
      
      // Store track's facets
      trackFacets[trackId] = new Set(facets);
      
      // Add to index
      for (const facet of facets) {
        if (!facetIndex[facet]) {
          facetIndex[facet] = new Set();
        }
        facetIndex[facet].add(trackId);
      }
    } catch (err) {
      console.warn(`[FacetIndex] Error reading ${folder}:`, err.message);
    }
  }
  
  // Build counts
  for (const [facet, tracks] of Object.entries(facetIndex)) {
    facetCounts[facet] = tracks.size;
  }
  
  console.log(`[FacetIndex] Indexed ${Object.keys(facetIndex).length} unique facets`);
}

/**
 * Get all unique facets with their track counts
 * Returns: [{ name: 'Joey', count: 5 }, ...]
 */
function getAllFacets() {
  return Object.entries(facetCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count); // Most used first
}

/**
 * Get track IDs for a specific facet
 */
function getTracksWithFacet(facetName) {
  const tracks = facetIndex[facetName];
  return tracks ? Array.from(tracks) : [];
}

/**
 * Get all facets for a specific track
 */
function getFacetsForTrack(trackId) {
  const facets = trackFacets[trackId];
  return facets ? Array.from(facets) : [];
}

/**
 * Add a facet to a track
 * Updates both index and track's metadata.json
 */
function addFacetToTrack(trackId, facetName) {
  // Normalize facet name (trim whitespace)
  facetName = facetName.trim();
  if (!facetName) return false;

  // Update in-memory index
  if (!facetIndex[facetName]) {
    facetIndex[facetName] = new Set();
  }
  facetIndex[facetName].add(trackId);

  if (!trackFacets[trackId]) {
    trackFacets[trackId] = new Set();
  }
  trackFacets[trackId].add(facetName);

  // Update counts
  facetCounts[facetName] = facetIndex[facetName].size;

  // Persist to disk
  return persistTrackFacets(trackId);
}

/**
 * Remove a facet from a track
 */
function removeFacetFromTrack(trackId, facetName) {
  // Update in-memory index
  if (facetIndex[facetName]) {
    facetIndex[facetName].delete(trackId);
    if (facetIndex[facetName].size === 0) {
      delete facetIndex[facetName];
      delete facetCounts[facetName];
    } else {
      facetCounts[facetName] = facetIndex[facetName].size;
    }
  }
  
  if (trackFacets[trackId]) {
    trackFacets[trackId].delete(facetName);
  }
  
  // Persist to disk
  return persistTrackFacets(trackId);
}

/**
 * Write track's facets to its metadata.json
 */
function persistTrackFacets(trackId) {
  if (!libraryPath) return false;
  
  const metadataPath = path.join(libraryPath, 'tracks', `${trackId}.info`, 'metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    console.warn(`[FacetIndex] Track metadata not found: ${trackId}`);
    return false;
  }
  
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.facets = Array.from(trackFacets[trackId] || []);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    return true;
  } catch (err) {
    console.error(`[FacetIndex] Error persisting facets for ${trackId}:`, err);
    return false;
  }
}

/**
 * Search facets by partial match
 */
function searchFacets(query) {
  if (!query || !query.trim()) {
    return getAllFacets();
  }
  
  const lowerQuery = query.toLowerCase().trim();
  
  return Object.entries(facetCounts)
    .filter(([name]) => name.toLowerCase().includes(lowerQuery))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      // Exact match first, then starts-with, then includes
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      
      if (aLower === lowerQuery) return -1;
      if (bLower === lowerQuery) return 1;
      if (aLower.startsWith(lowerQuery) && !bLower.startsWith(lowerQuery)) return -1;
      if (bLower.startsWith(lowerQuery) && !aLower.startsWith(lowerQuery)) return 1;
      
      return b.count - a.count;
    });
}

/**
 * Check if a facet exists
 */
function facetExists(facetName) {
  return facetName in facetIndex;
}

/**
 * Rename a facet across all tracks
 */
function renameFacet(oldName, newName) {
  newName = newName.trim();
  if (!newName || oldName === newName) return false;
  if (!facetIndex[oldName]) return false;
  
  // Get all tracks with this facet
  const affectedTracks = Array.from(facetIndex[oldName]);
  
  // Update each track
  for (const trackId of affectedTracks) {
    trackFacets[trackId].delete(oldName);
    trackFacets[trackId].add(newName);
    persistTrackFacets(trackId);
  }
  
  // Update index
  facetIndex[newName] = facetIndex[oldName];
  delete facetIndex[oldName];
  
  facetCounts[newName] = facetCounts[oldName];
  delete facetCounts[oldName];
  
  return true;
}

/**
 * Delete a facet from all tracks
 */
function deleteFacet(facetName) {
  if (!facetIndex[facetName]) return false;
  
  const affectedTracks = Array.from(facetIndex[facetName]);
  
  for (const trackId of affectedTracks) {
    trackFacets[trackId].delete(facetName);
    persistTrackFacets(trackId);
  }
  
  delete facetIndex[facetName];
  delete facetCounts[facetName];
  
  return true;
}

/**
 * Get index stats
 */
function getStats() {
  return {
    totalFacets: Object.keys(facetIndex).length,
    totalTracks: Object.keys(trackFacets).length,
    tracksWithFacets: Object.values(trackFacets).filter(f => f.size > 0).length
  };
}

module.exports = {
  buildIndex,
  getAllFacets,
  getTracksWithFacet,
  getFacetsForTrack,
  addFacetToTrack,
  removeFacetFromTrack,
  searchFacets,
  facetExists,
  renameFacet,
  deleteFacet,
  getStats
};
