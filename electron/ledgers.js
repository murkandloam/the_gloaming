/**
 * The Gloaming - Ledgers Module
 *
 * SQLite-based listening history tracking.
 * Tracks play time per track, aggregates by artist/album/mixtape.
 */

const path = require('path');
const fs = require('fs');

// We'll use better-sqlite3 for synchronous, performant SQLite access
// If not available, fall back to a simple JSON-based implementation
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log('[Ledgers] better-sqlite3 not available, using JSON fallback');
  Database = null;
}

/**
 * Ledgers class - manages listening history
 */
class Ledgers {
  constructor() {
    this.db = null;
    this.libraryPath = null;
    this.jsonFallback = null; // Used when SQLite isn't available
  }

  /**
   * Initialize the ledgers database
   * @param {string} libraryPath - Path to the library folder
   */
  initialize(libraryPath) {
    this.libraryPath = libraryPath;
    const dbPath = path.join(libraryPath, 'ledgers.db');

    if (Database) {
      try {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.createTables();
        console.log('[Ledgers] SQLite database initialized');

        // Migrate any existing JSON data to SQLite
        this.migrateFromJson();
      } catch (err) {
        console.error('[Ledgers] SQLite error, falling back to JSON:', err.message);
        this.initJsonFallback();
      }
    } else {
      this.initJsonFallback();
    }
  }

  /**
   * Migrate data from ledgers.json to SQLite (one-time migration)
   */
  migrateFromJson() {
    const jsonPath = path.join(this.libraryPath, 'ledgers.json');

    if (!fs.existsSync(jsonPath)) {
      return; // No JSON file to migrate
    }

    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

      if (!jsonData.listens || jsonData.listens.length === 0) {
        // Empty JSON file, just delete it
        fs.unlinkSync(jsonPath);
        console.log('[Ledgers] Removed empty ledgers.json');
        return;
      }

      // Check if we already have data in SQLite (avoid double-migration)
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM listens');
      const { count } = countStmt.get();

      if (count > 0) {
        // Already have SQLite data - just remove the JSON file
        fs.unlinkSync(jsonPath);
        console.log('[Ledgers] SQLite already has data, removed legacy ledgers.json');
        return;
      }

      // Migrate JSON data to SQLite
      console.log(`[Ledgers] Migrating ${jsonData.listens.length} listens from JSON to SQLite...`);

      const insertStmt = this.db.prepare(`
        INSERT INTO listens (track_id, album_id, artist, timestamp, seconds)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertMany = this.db.transaction((listens) => {
        for (const listen of listens) {
          insertStmt.run(
            listen.track_id,
            listen.album_id,
            listen.artist,
            listen.timestamp,
            listen.seconds
          );
        }
      });

      insertMany(jsonData.listens);

      // Remove the JSON file after successful migration
      fs.unlinkSync(jsonPath);
      console.log(`[Ledgers] Migration complete, removed ledgers.json`);

    } catch (err) {
      console.error('[Ledgers] Migration error:', err.message);
      // Don't delete JSON on error - keep it as backup
    }
  }

  /**
   * Initialize JSON fallback for environments without better-sqlite3
   */
  initJsonFallback() {
    const jsonPath = path.join(this.libraryPath, 'ledgers.json');

    if (fs.existsSync(jsonPath)) {
      try {
        this.jsonFallback = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (err) {
        console.error('[Ledgers] Error reading ledgers.json:', err);
        this.jsonFallback = { listens: [] };
      }
    } else {
      this.jsonFallback = { listens: [] };
    }

    console.log('[Ledgers] Using JSON fallback with', this.jsonFallback.listens.length, 'listens');
  }

  /**
   * Save JSON fallback to disk
   */
  saveJsonFallback() {
    if (!this.jsonFallback) return;

    const jsonPath = path.join(this.libraryPath, 'ledgers.json');
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(this.jsonFallback, null, 2));
    } catch (err) {
      console.error('[Ledgers] Error saving ledgers.json:', err);
    }
  }

  /**
   * Create database tables
   */
  createTables() {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        album_id TEXT,
        artist TEXT,
        timestamp INTEGER NOT NULL,
        seconds INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_listens_timestamp ON listens(timestamp);
      CREATE INDEX IF NOT EXISTS idx_listens_track ON listens(track_id);
      CREATE INDEX IF NOT EXISTS idx_listens_album ON listens(album_id);
      CREATE INDEX IF NOT EXISTS idx_listens_artist ON listens(artist);
    `);
  }

  /**
   * Record a listening session
   * @param {Object} params - Session parameters
   * @param {string} params.trackId - Track ID
   * @param {string} params.albumId - Album ID
   * @param {string} params.artist - Artist name
   * @param {number} params.seconds - Seconds listened
   */
  recordListen({ trackId, albumId, artist, seconds }) {
    // Minimum threshold: 5 seconds
    if (seconds < 5) {
      console.log('[Ledgers] Ignoring listen < 5 seconds');
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO listens (track_id, album_id, artist, timestamp, seconds)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(trackId, albumId, artist, timestamp, seconds);
        console.log(`[Ledgers] Recorded ${seconds}s for track ${trackId}`);
      } catch (err) {
        console.error('[Ledgers] Error recording listen:', err);
      }
    } else if (this.jsonFallback) {
      this.jsonFallback.listens.push({
        track_id: trackId,
        album_id: albumId,
        artist: artist,
        timestamp,
        seconds
      });
      this.saveJsonFallback();
      console.log(`[Ledgers] (JSON) Recorded ${seconds}s for track ${trackId}`);
    }
  }

  /**
   * Get time range for a period
   * @param {string} period - 'day', 'week', 'month', 'year', 'all'
   * @returns {number} - Unix timestamp for start of period
   */
  getPeriodStart(period) {
    const now = Math.floor(Date.now() / 1000);

    switch (period) {
      case 'day':
        return now - (24 * 60 * 60);
      case 'week':
        return now - (7 * 24 * 60 * 60);
      case 'month':
        return now - (30 * 24 * 60 * 60);
      case 'year':
        return now - (365 * 24 * 60 * 60);
      case 'all':
      default:
        return 0;
    }
  }

  /**
   * Get top tracks by listening time
   * @param {Object} options - Query options
   * @param {string} options.period - Time period
   * @param {number} options.limit - Max results
   * @param {string} options.sortBy - 'time' or 'plays'
   */
  getTopTracks({ period = 'all', limit = 50, sortBy = 'time' } = {}) {
    const startTime = this.getPeriodStart(period);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            track_id,
            album_id,
            artist,
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count
          FROM listens
          WHERE timestamp >= ?
          GROUP BY track_id
          ORDER BY ${sortBy === 'plays' ? 'listen_count' : 'total_seconds'} DESC
          LIMIT ?
        `);
        return stmt.all(startTime, limit);
      } catch (err) {
        console.error('[Ledgers] Error getting top tracks:', err);
        return [];
      }
    } else if (this.jsonFallback) {
      return this.getTopTracksJson(startTime, limit, sortBy);
    }

    return [];
  }

  /**
   * JSON fallback for getTopTracks
   */
  getTopTracksJson(startTime, limit, sortBy) {
    const filtered = this.jsonFallback.listens.filter(l => l.timestamp >= startTime);

    // Aggregate by track
    const trackMap = {};
    for (const listen of filtered) {
      if (!trackMap[listen.track_id]) {
        trackMap[listen.track_id] = {
          track_id: listen.track_id,
          album_id: listen.album_id,
          artist: listen.artist,
          total_seconds: 0,
          listen_count: 0
        };
      }
      trackMap[listen.track_id].total_seconds += listen.seconds;
      trackMap[listen.track_id].listen_count += 1;
    }

    const tracks = Object.values(trackMap);
    tracks.sort((a, b) => {
      if (sortBy === 'plays') {
        return b.listen_count - a.listen_count;
      }
      return b.total_seconds - a.total_seconds;
    });

    return tracks.slice(0, limit);
  }

  /**
   * Get top albums by listening time
   */
  getTopAlbums({ period = 'all', limit = 50, sortBy = 'time' } = {}) {
    const startTime = this.getPeriodStart(period);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            album_id,
            artist,
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count,
            COUNT(DISTINCT track_id) as unique_tracks
          FROM listens
          WHERE timestamp >= ? AND album_id IS NOT NULL
          GROUP BY album_id
          ORDER BY ${sortBy === 'plays' ? 'listen_count' : 'total_seconds'} DESC
          LIMIT ?
        `);
        return stmt.all(startTime, limit);
      } catch (err) {
        console.error('[Ledgers] Error getting top albums:', err);
        return [];
      }
    } else if (this.jsonFallback) {
      return this.getTopAlbumsJson(startTime, limit, sortBy);
    }

    return [];
  }

  /**
   * JSON fallback for getTopAlbums
   */
  getTopAlbumsJson(startTime, limit, sortBy) {
    const filtered = this.jsonFallback.listens.filter(
      l => l.timestamp >= startTime && l.album_id
    );

    const albumMap = {};
    for (const listen of filtered) {
      if (!albumMap[listen.album_id]) {
        albumMap[listen.album_id] = {
          album_id: listen.album_id,
          artist: listen.artist,
          total_seconds: 0,
          listen_count: 0,
          tracks: new Set()
        };
      }
      albumMap[listen.album_id].total_seconds += listen.seconds;
      albumMap[listen.album_id].listen_count += 1;
      albumMap[listen.album_id].tracks.add(listen.track_id);
    }

    const albums = Object.values(albumMap).map(a => ({
      ...a,
      unique_tracks: a.tracks.size,
      tracks: undefined
    }));

    albums.sort((a, b) => {
      if (sortBy === 'plays') {
        return b.listen_count - a.listen_count;
      }
      return b.total_seconds - a.total_seconds;
    });

    return albums.slice(0, limit);
  }

  /**
   * Get top artists by listening time
   */
  getTopArtists({ period = 'all', limit = 50, sortBy = 'time' } = {}) {
    const startTime = this.getPeriodStart(period);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            artist,
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count,
            COUNT(DISTINCT track_id) as unique_tracks,
            COUNT(DISTINCT album_id) as unique_albums
          FROM listens
          WHERE timestamp >= ? AND artist IS NOT NULL
          GROUP BY artist
          ORDER BY ${sortBy === 'plays' ? 'listen_count' : 'total_seconds'} DESC
          LIMIT ?
        `);
        return stmt.all(startTime, limit);
      } catch (err) {
        console.error('[Ledgers] Error getting top artists:', err);
        return [];
      }
    } else if (this.jsonFallback) {
      return this.getTopArtistsJson(startTime, limit, sortBy);
    }

    return [];
  }

  /**
   * JSON fallback for getTopArtists
   */
  getTopArtistsJson(startTime, limit, sortBy) {
    const filtered = this.jsonFallback.listens.filter(
      l => l.timestamp >= startTime && l.artist
    );

    const artistMap = {};
    for (const listen of filtered) {
      if (!artistMap[listen.artist]) {
        artistMap[listen.artist] = {
          artist: listen.artist,
          total_seconds: 0,
          listen_count: 0,
          tracks: new Set(),
          albums: new Set()
        };
      }
      artistMap[listen.artist].total_seconds += listen.seconds;
      artistMap[listen.artist].listen_count += 1;
      artistMap[listen.artist].tracks.add(listen.track_id);
      if (listen.album_id) {
        artistMap[listen.artist].albums.add(listen.album_id);
      }
    }

    const artists = Object.values(artistMap).map(a => ({
      artist: a.artist,
      total_seconds: a.total_seconds,
      listen_count: a.listen_count,
      unique_tracks: a.tracks.size,
      unique_albums: a.albums.size
    }));

    artists.sort((a, b) => {
      if (sortBy === 'plays') {
        return b.listen_count - a.listen_count;
      }
      return b.total_seconds - a.total_seconds;
    });

    return artists.slice(0, limit);
  }

  /**
   * Get stats for a specific album
   */
  getAlbumStats(albumId) {
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count
          FROM listens
          WHERE album_id = ?
        `);
        return stmt.get(albumId) || { total_seconds: 0, listen_count: 0 };
      } catch (err) {
        console.error('[Ledgers] Error getting album stats:', err);
        return { total_seconds: 0, listen_count: 0 };
      }
    } else if (this.jsonFallback) {
      const filtered = this.jsonFallback.listens.filter(l => l.album_id === albumId);
      return {
        total_seconds: filtered.reduce((sum, l) => sum + l.seconds, 0),
        listen_count: filtered.length
      };
    }

    return { total_seconds: 0, listen_count: 0 };
  }

  /**
   * Get stats for multiple albums at once (for grid sorting)
   * @param {string[]} albumIds - Array of album IDs
   * @returns {Object} - Map of album_id -> { total_seconds, listen_count }
   */
  getAlbumsStats(albumIds) {
    const result = {};

    if (this.db) {
      try {
        // Use a single query to get all album stats
        const placeholders = albumIds.map(() => '?').join(',');
        const stmt = this.db.prepare(`
          SELECT
            album_id,
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count
          FROM listens
          WHERE album_id IN (${placeholders})
          GROUP BY album_id
        `);
        const rows = stmt.all(...albumIds);

        // Convert to map
        for (const row of rows) {
          result[row.album_id] = {
            total_seconds: row.total_seconds || 0,
            listen_count: row.listen_count || 0
          };
        }
      } catch (err) {
        console.error('[Ledgers] Error getting albums stats:', err);
      }
    } else if (this.jsonFallback) {
      const albumSet = new Set(albumIds);
      for (const listen of this.jsonFallback.listens) {
        if (albumSet.has(listen.album_id)) {
          if (!result[listen.album_id]) {
            result[listen.album_id] = { total_seconds: 0, listen_count: 0 };
          }
          result[listen.album_id].total_seconds += listen.seconds;
          result[listen.album_id].listen_count += 1;
        }
      }
    }

    return result;
  }

  /**
   * Get stats for a specific track
   */
  getTrackStats(trackId) {
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            SUM(seconds) as total_seconds,
            COUNT(*) as listen_count
          FROM listens
          WHERE track_id = ?
        `);
        return stmt.get(trackId) || { total_seconds: 0, listen_count: 0 };
      } catch (err) {
        console.error('[Ledgers] Error getting track stats:', err);
        return { total_seconds: 0, listen_count: 0 };
      }
    } else if (this.jsonFallback) {
      const filtered = this.jsonFallback.listens.filter(l => l.track_id === trackId);
      return {
        total_seconds: filtered.reduce((sum, l) => sum + l.seconds, 0),
        listen_count: filtered.length
      };
    }

    return { total_seconds: 0, listen_count: 0 };
  }

  /**
   * Reset listening stats for a specific track
   * @param {string} trackId - Track ID to reset
   * @returns {boolean} - Success
   */
  resetTrackStats(trackId) {
    if (this.db) {
      try {
        const stmt = this.db.prepare('DELETE FROM listens WHERE track_id = ?');
        const result = stmt.run(trackId);
        console.log(`[Ledgers] Reset stats for track ${trackId}, deleted ${result.changes} entries`);
        return true;
      } catch (err) {
        console.error('[Ledgers] Error resetting track stats:', err);
        return false;
      }
    } else if (this.jsonFallback) {
      const before = this.jsonFallback.listens.length;
      this.jsonFallback.listens = this.jsonFallback.listens.filter(l => l.track_id !== trackId);
      const deleted = before - this.jsonFallback.listens.length;
      this.saveJsonFallback();
      console.log(`[Ledgers] (JSON) Reset stats for track ${trackId}, deleted ${deleted} entries`);
      return true;
    }

    return false;
  }

  /**
   * Delete listening stats for all tracks in an album
   * @param {string} albumId - Album ID to delete
   * @returns {boolean} - Success
   */
  deleteAlbumStats(albumId) {
    if (this.db) {
      try {
        const stmt = this.db.prepare('DELETE FROM listens WHERE album_id = ?');
        const result = stmt.run(albumId);
        console.log(`[Ledgers] Deleted stats for album ${albumId}, removed ${result.changes} entries`);
        return true;
      } catch (err) {
        console.error('[Ledgers] Error deleting album stats:', err);
        return false;
      }
    } else if (this.jsonFallback) {
      const before = this.jsonFallback.listens.length;
      this.jsonFallback.listens = this.jsonFallback.listens.filter(l => l.album_id !== albumId);
      const deleted = before - this.jsonFallback.listens.length;
      this.saveJsonFallback();
      console.log(`[Ledgers] (JSON) Deleted stats for album ${albumId}, removed ${deleted} entries`);
      return true;
    }

    return false;
  }

  /**
   * Get overall listening stats
   */
  getOverallStats({ period = 'all' } = {}) {
    const startTime = this.getPeriodStart(period);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT
            SUM(seconds) as total_seconds,
            COUNT(*) as total_listens,
            COUNT(DISTINCT track_id) as unique_tracks,
            COUNT(DISTINCT album_id) as unique_albums,
            COUNT(DISTINCT artist) as unique_artists
          FROM listens
          WHERE timestamp >= ?
        `);
        const result = stmt.get(startTime);
        return result || {
          total_seconds: 0,
          total_listens: 0,
          unique_tracks: 0,
          unique_albums: 0,
          unique_artists: 0
        };
      } catch (err) {
        console.error('[Ledgers] Error getting overall stats:', err);
        return {
          total_seconds: 0,
          total_listens: 0,
          unique_tracks: 0,
          unique_albums: 0,
          unique_artists: 0
        };
      }
    } else if (this.jsonFallback) {
      const filtered = this.jsonFallback.listens.filter(l => l.timestamp >= startTime);
      const tracks = new Set();
      const albums = new Set();
      const artists = new Set();
      let totalSeconds = 0;

      for (const listen of filtered) {
        totalSeconds += listen.seconds;
        tracks.add(listen.track_id);
        if (listen.album_id) albums.add(listen.album_id);
        if (listen.artist) artists.add(listen.artist);
      }

      return {
        total_seconds: totalSeconds,
        total_listens: filtered.length,
        unique_tracks: tracks.size,
        unique_albums: albums.size,
        unique_artists: artists.size
      };
    }

    return {
      total_seconds: 0,
      total_listens: 0,
      unique_tracks: 0,
      unique_albums: 0,
      unique_artists: 0
    };
  }

  /**
   * Merge duplicate track entries that have the same album_id
   * This consolidates listens for tracks that got different track_ids
   * @returns {Object} - { merged: number, affected: number }
   */
  mergeDuplicates() {
    if (this.db) {
      try {
        // Find duplicate track_ids within the same album
        // We'll keep the track_id that has the most listens
        const findDupes = this.db.prepare(`
          SELECT album_id, COUNT(DISTINCT track_id) as id_count
          FROM listens
          WHERE album_id IS NOT NULL
          GROUP BY album_id
          HAVING COUNT(DISTINCT track_id) > (
            SELECT COUNT(DISTINCT track_id) FROM listens l2
            WHERE l2.album_id = listens.album_id
            GROUP BY l2.album_id, substr(l2.track_id, 1, instr(l2.track_id || '-', '-') - 1)
          )
        `);

        // Alternative approach: group by album_id and the base part of track_id
        // to find where multiple different track_ids exist for what should be the same track

        // Actually, let's do a simpler approach:
        // Find all track_ids per album, and merge any that look like duplicates
        // (same album, similar position in the track_id)

        const getAlbumTracks = this.db.prepare(`
          SELECT DISTINCT track_id, album_id,
                 SUM(seconds) as total_seconds,
                 COUNT(*) as listen_count
          FROM listens
          WHERE album_id IS NOT NULL
          GROUP BY track_id
        `);

        const allTracks = getAlbumTracks.all();

        // Group by album
        const albumGroups = {};
        for (const track of allTracks) {
          if (!albumGroups[track.album_id]) {
            albumGroups[track.album_id] = [];
          }
          albumGroups[track.album_id].push(track);
        }

        let totalMerged = 0;
        let totalAffected = 0;

        const updateStmt = this.db.prepare(`
          UPDATE listens SET track_id = ? WHERE track_id = ?
        `);

        // For each album, check if there are track_ids that should be merged
        for (const [albumId, tracks] of Object.entries(albumGroups)) {
          if (tracks.length <= 1) continue;

          // Extract track numbers from track_ids (usually format: albumId-trackNum)
          const tracksByNum = {};
          for (const track of tracks) {
            // Try to extract track number from track_id
            const parts = track.track_id.split('-');
            const lastPart = parts[parts.length - 1];
            const trackNum = parseInt(lastPart, 10);

            if (!isNaN(trackNum)) {
              if (!tracksByNum[trackNum]) {
                tracksByNum[trackNum] = [];
              }
              tracksByNum[trackNum].push(track);
            }
          }

          // Merge duplicates within each track number
          for (const [trackNum, dupes] of Object.entries(tracksByNum)) {
            if (dupes.length <= 1) continue;

            // Keep the one with most listens as canonical
            dupes.sort((a, b) => b.listen_count - a.listen_count);
            const canonical = dupes[0];

            for (let i = 1; i < dupes.length; i++) {
              const dupe = dupes[i];
              updateStmt.run(canonical.track_id, dupe.track_id);
              totalMerged++;
              totalAffected += dupe.listen_count;
              console.log(`[Ledgers] Merged ${dupe.track_id} -> ${canonical.track_id} (${dupe.listen_count} listens)`);
            }
          }
        }

        console.log(`[Ledgers] Merge complete: ${totalMerged} track IDs merged, ${totalAffected} listen entries updated`);
        return { merged: totalMerged, affected: totalAffected };

      } catch (err) {
        console.error('[Ledgers] Error merging duplicates:', err);
        return { merged: 0, affected: 0, error: err.message };
      }
    } else if (this.jsonFallback) {
      // JSON fallback merge
      const listens = this.jsonFallback.listens;

      // Group by album
      const albumGroups = {};
      for (const listen of listens) {
        if (!listen.album_id) continue;
        if (!albumGroups[listen.album_id]) {
          albumGroups[listen.album_id] = {};
        }

        // Extract track number
        const parts = listen.track_id.split('-');
        const lastPart = parts[parts.length - 1];
        const trackNum = parseInt(lastPart, 10);

        if (!isNaN(trackNum)) {
          if (!albumGroups[listen.album_id][trackNum]) {
            albumGroups[listen.album_id][trackNum] = { ids: {}, canonical: null };
          }
          if (!albumGroups[listen.album_id][trackNum].ids[listen.track_id]) {
            albumGroups[listen.album_id][trackNum].ids[listen.track_id] = 0;
          }
          albumGroups[listen.album_id][trackNum].ids[listen.track_id]++;
        }
      }

      // Determine canonical IDs
      const idMap = {}; // oldId -> canonicalId
      let totalMerged = 0;

      for (const [albumId, trackNums] of Object.entries(albumGroups)) {
        for (const [trackNum, data] of Object.entries(trackNums)) {
          const ids = Object.entries(data.ids);
          if (ids.length <= 1) continue;

          // Most used ID becomes canonical
          ids.sort((a, b) => b[1] - a[1]);
          const canonical = ids[0][0];

          for (let i = 1; i < ids.length; i++) {
            idMap[ids[i][0]] = canonical;
            totalMerged++;
          }
        }
      }

      // Apply merges
      let totalAffected = 0;
      for (const listen of listens) {
        if (idMap[listen.track_id]) {
          listen.track_id = idMap[listen.track_id];
          totalAffected++;
        }
      }

      if (totalMerged > 0) {
        this.saveJsonFallback();
      }

      console.log(`[Ledgers] (JSON) Merge complete: ${totalMerged} track IDs merged, ${totalAffected} listen entries updated`);
      return { merged: totalMerged, affected: totalAffected };
    }

    return { merged: 0, affected: 0 };
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (this.jsonFallback) {
      this.saveJsonFallback();
      this.jsonFallback = null;
    }
  }
}

// Singleton instance
const ledgers = new Ledgers();

module.exports = ledgers;
