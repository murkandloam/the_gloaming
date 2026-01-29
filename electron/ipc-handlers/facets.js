/**
 * Facets IPC Handlers
 *
 * Tag management - facets are user-defined tags applied to tracks and albums.
 * Supports groups for organization and fast indexed lookups.
 */

const fs = require('fs');
const path = require('path');

module.exports = function registerFacetsHandlers({
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
}) {

  // Facets - using facetIndex for fast lookups
  ipcMain.handle('get-facets', async () => {
    return loadFacets(getLibraryPath());
  });

  ipcMain.handle('save-facets', async (event, facets) => {
    saveFacets(getLibraryPath(), facets);
    return { success: true };
  });

  // Remove a facet from recently used list
  ipcMain.handle('remove-from-recent', async (event, facetName) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.recent = (facetsConfig.recent || []).filter(f => f !== facetName);
      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error removing from recent:', err);
      return { success: false, error: err.message };
    }
  });

  // Get all facets with counts
  ipcMain.handle('get-all-facets', async () => {
    return facetIndex.getAllFacets();
  });

  // Search facets
  ipcMain.handle('search-facets', async (event, query) => {
    return facetIndex.searchFacets(query);
  });

  // Get facets for a specific track
  ipcMain.handle('get-track-facets', async (event, trackId) => {
    return facetIndex.getFacetsForTrack(trackId);
  });

  // Get all tracks with a specific facet
  ipcMain.handle('get-tracks-with-facet', async (event, facetName) => {
    const currentLibraryPath = getLibraryPath();
    const trackIds = facetIndex.getTracksWithFacet(facetName);

    // Load full track info for each
    const paths = getLibraryPaths(currentLibraryPath);

    // Load all albums to get cover paths
    const albumsData = listCollections(currentLibraryPath, 'album');
    const albumCoverMap = {};
    const albumNameMap = {};
    const albumArtistMap = {};

    albumsData.forEach(album => {
      // Store album name and artist for track display
      albumNameMap[album.id] = album.name;
      albumArtistMap[album.id] = album.artist;

      // Find cover path - all covers now in attachments/
      let coverPath = null;
      if (album.cover) {
        const coverFolderPath = path.join(paths.attachments, `${album.cover}.info`);
        if (fs.existsSync(coverFolderPath)) {
          const coverMetaPath = path.join(coverFolderPath, 'metadata.json');
          if (fs.existsSync(coverMetaPath)) {
            try {
              const coverMeta = JSON.parse(fs.readFileSync(coverMetaPath, 'utf-8'));
              if (coverMeta && coverMeta.filename) {
                // Prefer thumbnail for track displays (queue, inspector, etc.)
                const thumbPath = path.join(coverFolderPath, 'thumbnail.jpg');
                if (fs.existsSync(thumbPath)) {
                  coverPath = thumbPath;
                } else {
                  coverPath = path.join(coverFolderPath, coverMeta.filename);
                }
              }
            } catch (e) {
              console.error('Error reading cover metadata:', e);
            }
          }
        }
      }

      albumCoverMap[album.id] = coverPath;
    });

    const tracks = trackIds.map(trackId => {
      const trackFolder = path.join(paths.tracks, `${trackId}.info`);
      const metadata = readTrackMetadata(trackFolder);
      if (metadata) {
        // Get album art from album
        const albumArt = albumCoverMap[metadata.albumId] || null;

        return {
          ...metadata,
          audioPath: path.join(trackFolder, metadata.filename),
          albumArt: albumArt,
          artist: metadata.trackArtist || 'Unknown Artist',
          album: metadata.album || albumNameMap[metadata.albumId] || 'Unknown Album'
        };
      }
      return null;
    }).filter(Boolean);

    return tracks;
  });

  // Add facet to track
  ipcMain.handle('add-facet-to-track', async (event, { trackId, facetName }) => {
    const currentLibraryPath = getLibraryPath();
    const success = facetIndex.addFacetToTrack(trackId, facetName);

    // Update recent facets
    if (success) {
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.recent = facetsConfig.recent || [];
      // Remove if already in recent, then add to front
      facetsConfig.recent = facetsConfig.recent.filter(f => f !== facetName);
      facetsConfig.recent.unshift(facetName);
      // Keep only last 12
      facetsConfig.recent = facetsConfig.recent.slice(0, 12);
      saveFacets(currentLibraryPath, facetsConfig);
    }

    return { success };
  });

  // Remove facet from track
  ipcMain.handle('remove-facet-from-track', async (event, { trackId, facetName }) => {
    const success = facetIndex.removeFacetFromTrack(trackId, facetName);
    return { success };
  });

  // Rename a facet across all tracks
  ipcMain.handle('rename-facet', async (event, { oldName, newName }) => {
    const success = facetIndex.renameFacet(oldName, newName);
    return { success };
  });

  // Delete a facet from all tracks and clean up from facets.json
  ipcMain.handle('delete-facet', async (event, facetName) => {
    // Delete from track metadata (may return false if no tracks have this facet)
    facetIndex.deleteFacet(facetName);

    // Also clean up from facets.json (groups, colors, starred, recent)
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      let changed = false;

      // Remove from groups
      if (facetsConfig.groups) {
        for (const group of facetsConfig.groups) {
          if (group.facets && group.facets.includes(facetName)) {
            group.facets = group.facets.filter(f => f !== facetName);
            changed = true;
          }
        }
      }

      // Remove from colors
      if (facetsConfig.colors && facetsConfig.colors[facetName]) {
        delete facetsConfig.colors[facetName];
        changed = true;
      }

      // Remove from starred
      if (facetsConfig.starred && facetsConfig.starred.includes(facetName)) {
        facetsConfig.starred = facetsConfig.starred.filter(f => f !== facetName);
        changed = true;
      }

      // Remove from recent
      if (facetsConfig.recent && facetsConfig.recent.includes(facetName)) {
        facetsConfig.recent = facetsConfig.recent.filter(f => f !== facetName);
        changed = true;
      }

      if (changed) {
        saveFacets(currentLibraryPath, facetsConfig);
      }
    } catch (err) {
      console.error('Error cleaning up facet from config:', err);
    }

    return { success: true };
  });

  // Get facet index stats
  ipcMain.handle('get-facet-stats', async () => {
    return facetIndex.getStats();
  });

  // ============================================
  // Facet Groups
  // ============================================

  // Create a new facet group
  ipcMain.handle('create-facet-group', async (event, { name, color }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      // Generate simple ID from name
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

      // Check if group already exists
      if (facetsConfig.groups.some(g => g.id === id)) {
        return { success: false, error: 'Group already exists' };
      }

      facetsConfig.groups.push({
        id,
        name,
        color: color || '#d4843a',
        facets: []
      });

      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true, group: { id, name, color: color || '#d4843a', facets: [] } };
    } catch (err) {
      console.error('Error creating facet group:', err);
      return { success: false, error: err.message };
    }
  });

  // Delete a facet group (facets become uncategorized)
  ipcMain.handle('delete-facet-group', async (event, groupId) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      const groupIndex = facetsConfig.groups.findIndex(g => g.id === groupId);
      if (groupIndex === -1) {
        return { success: false, error: 'Group not found' };
      }

      // Remove the group (facets within it become uncategorized automatically)
      facetsConfig.groups.splice(groupIndex, 1);

      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error deleting facet group:', err);
      return { success: false, error: err.message };
    }
  });

  // Rename a facet group
  ipcMain.handle('rename-facet-group', async (event, { groupId, newName }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      const group = facetsConfig.groups.find(g => g.id === groupId);
      if (!group) {
        return { success: false, error: 'Group not found' };
      }

      group.name = newName;

      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error renaming facet group:', err);
      return { success: false, error: err.message };
    }
  });

  // Move a facet to a group (or to uncategorized if groupId is null)
  ipcMain.handle('move-facet-to-group', async (event, { facetName, groupId }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      // Remove facet from all groups first
      for (const group of facetsConfig.groups) {
        group.facets = (group.facets || []).filter(f => f !== facetName);
      }

      // Add to target group (if not moving to uncategorized)
      if (groupId) {
        const targetGroup = facetsConfig.groups.find(g => g.id === groupId);
        if (!targetGroup) {
          return { success: false, error: 'Target group not found' };
        }
        targetGroup.facets = targetGroup.facets || [];
        targetGroup.facets.push(facetName);
      }

      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error moving facet to group:', err);
      return { success: false, error: err.message };
    }
  });

  // Update group color
  ipcMain.handle('update-facet-group-color', async (event, { groupId, color }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      const group = facetsConfig.groups.find(g => g.id === groupId);
      if (!group) {
        return { success: false, error: 'Group not found' };
      }

      group.color = color;

      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error updating group color:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder groups
  ipcMain.handle('reorder-facet-groups', async (event, { groupIds }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      // Build new ordered array
      const groupMap = new Map(facetsConfig.groups.map(g => [g.id, g]));
      const newGroups = groupIds.map(id => groupMap.get(id)).filter(Boolean);

      // Add any groups that weren't in the order (shouldn't happen, but safety)
      for (const group of facetsConfig.groups) {
        if (!groupIds.includes(group.id)) {
          newGroups.push(group);
        }
      }

      facetsConfig.groups = newGroups;
      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error reordering groups:', err);
      return { success: false, error: err.message };
    }
  });

  // Reorder facets within a group
  ipcMain.handle('reorder-facets-in-group', async (event, { groupId, facetNames }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.groups = facetsConfig.groups || [];

      const group = facetsConfig.groups.find(g => g.id === groupId);
      if (!group) {
        return { success: false, error: 'Group not found' };
      }

      group.facets = facetNames;
      saveFacets(currentLibraryPath, facetsConfig);
      return { success: true };
    } catch (err) {
      console.error('Error reordering facets:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Album Facets
  // ============================================

  // Get facets for an album
  ipcMain.handle('get-album-facets', async (event, albumId) => {
    try {
      const album = readCollection(getLibraryPath(), albumId);
      return album?.facets || [];
    } catch (err) {
      console.error('Error getting album facets:', err);
      return [];
    }
  });

  // Add facet to album (and all its tracks)
  ipcMain.handle('add-facet-to-album', async (event, { albumId, facetName }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return { success: false, error: 'Album not found' };

      // Add to album's own facets
      album.facets = album.facets || [];
      if (!album.facets.includes(facetName)) {
        album.facets.push(facetName);
        writeCollection(currentLibraryPath, album);
      }

      // Also add to all tracks in the album
      for (const trackRef of (album.tracks || [])) {
        facetIndex.addFacetToTrack(trackRef.id, facetName);
      }

      // Update recent facets
      const facetsConfig = loadFacets(currentLibraryPath);
      facetsConfig.recent = facetsConfig.recent || [];
      facetsConfig.recent = facetsConfig.recent.filter(f => f !== facetName);
      facetsConfig.recent.unshift(facetName);
      facetsConfig.recent = facetsConfig.recent.slice(0, 12);
      saveFacets(currentLibraryPath, facetsConfig);

      return { success: true };
    } catch (err) {
      console.error('Error adding album facet:', err);
      return { success: false, error: err.message };
    }
  });

  // Remove facet from album (and all its tracks)
  ipcMain.handle('remove-facet-from-album', async (event, { albumId, facetName }) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const album = readCollection(currentLibraryPath, albumId);
      if (!album) return { success: false, error: 'Album not found' };

      // Remove from album's facets
      album.facets = (album.facets || []).filter(f => f !== facetName);
      writeCollection(currentLibraryPath, album);

      // Also remove from all tracks in the album
      for (const trackRef of (album.tracks || [])) {
        facetIndex.removeFacetFromTrack(trackRef.id, facetName);
      }

      return { success: true };
    } catch (err) {
      console.error('Error removing album facet:', err);
      return { success: false, error: err.message };
    }
  });

};
