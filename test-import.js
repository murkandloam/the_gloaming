#!/usr/bin/env node
/**
 * The Gloaming - Import Test Script
 * 
 * Run this to test importing an album folder into the library.
 * 
 * Usage:
 *   node test-import.js /path/to/album/folder
 *   node test-import.js /path/to/artist/folder
 * 
 * This will:
 *   1. Initialize library at ~/Music/The Gloaming.library/ if needed
 *   2. Import the specified folder
 *   3. Print the resulting JSON files
 */

const path = require('path');
const fs = require('fs');

// Import our modules
const {
  DEFAULT_LIBRARY_PATH,
  libraryExists,
  initializeLibrary,
  getLibraryPaths,
  listCollections,
  readTrackMetadata
} = require('./electron/library');

const {
  smartImport,
  detectFolderType
} = require('./electron/import');

// Get folder path from command line
const folderPath = process.argv[2];

if (!folderPath) {
  console.log('Usage: node test-import.js /path/to/album/or/artist/folder');
  console.log('');
  console.log('Examples:');
  console.log('  node test-import.js "/path/to/Music/Radiohead/In Rainbows"');
  console.log('  node test-import.js "/path/to/Music/Beach House"');
  process.exit(1);
}

// Resolve to absolute path
const absolutePath = path.resolve(folderPath);

if (!fs.existsSync(absolutePath)) {
  console.error('❌ Folder not found:', absolutePath);
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  THE GLOAMING - Import Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

async function runTest() {
  // Step 1: Ensure library exists
  console.log('📁 Library path:', DEFAULT_LIBRARY_PATH);
  
  if (!libraryExists(DEFAULT_LIBRARY_PATH)) {
    console.log('📦 Initializing new library...');
    initializeLibrary(DEFAULT_LIBRARY_PATH);
    console.log('✅ Library created');
  } else {
    console.log('✅ Library already exists');
  }
  console.log('');
  
  // Step 2: Detect folder type
  const folderType = detectFolderType(absolutePath);
  console.log('🔍 Source folder:', absolutePath);
  console.log('📂 Detected type:', folderType);
  console.log('');
  
  if (folderType === 'unknown') {
    console.error('❌ No audio files found in folder or subfolders');
    process.exit(1);
  }
  
  // Step 3: Run import
  console.log('🎵 Starting import...');
  console.log('───────────────────────────────────────────────────────────────');
  
  const startTime = Date.now();
  
  const result = await smartImport(absolutePath, DEFAULT_LIBRARY_PATH, {
    onProgress: (progress) => {
      if (progress.stage === 'tracks' && progress.progress) {
        const pct = Math.round(progress.progress * 100);
        process.stdout.write(`\r   ${progress.message} (${pct}%)`);
      } else {
        console.log(`   ${progress.message}`);
      }
    }
  });
  
  console.log(''); // New line after progress
  console.log('───────────────────────────────────────────────────────────────');
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`⏱️  Completed in ${elapsed}s`);
  console.log('');
  
  // Step 4: Print results
  if (result.success || result.albums) {
    // Single album result
    if (result.albumId) {
      console.log('✅ Import successful!');
      console.log('');
      console.log('📀 Album:', result.albumName);
      console.log('🎤 Artist:', result.artistName);
      console.log('🎵 Tracks:', result.trackCount);
      console.log('🖼️  Cover:', result.hasCover ? 'Yes' : 'No');
      console.log('🆔 Album ID:', result.albumId);
    }
    // Multiple albums (artist folder)
    else if (result.albums) {
      console.log('✅ Import successful!');
      console.log('');
      console.log('🎤 Artist:', result.artistName);
      console.log('📀 Albums:', result.successCount);
      console.log('🎵 Total tracks:', result.totalTracks);
      
      console.log('');
      console.log('Albums imported:');
      result.albums.forEach((album, i) => {
        if (album.success) {
          console.log(`   ${i + 1}. ${album.albumName} (${album.trackCount} tracks)`);
        } else {
          console.log(`   ${i + 1}. ❌ ${album.error}`);
        }
      });
    }
    
    if (result.errors) {
      console.log('');
      console.log('⚠️  Errors:', result.errors.length);
      result.errors.forEach(err => {
        console.log(`   - ${err.file}: ${err.error}`);
      });
    }
  } else {
    console.log('❌ Import failed:', result.error);
    process.exit(1);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Library Contents');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  // Step 5: Show what's in the library now
  const paths = getLibraryPaths(DEFAULT_LIBRARY_PATH);
  const albums = listCollections(DEFAULT_LIBRARY_PATH, 'album');
  
  console.log(`📚 Total albums in library: ${albums.length}`);
  console.log('');
  
  albums.forEach((album, i) => {
    console.log(`${i + 1}. ${album.artist} - ${album.name}`);
    console.log(`   ID: ${album.id}`);
    console.log(`   Tracks: ${album.tracks?.length || 0}`);
    console.log(`   Year: ${album.releaseDate || 'Unknown'}`);
    console.log(`   Genre: ${album.genre || 'Unknown'}`);
    console.log(`   Cover: ${album.cover ? 'Yes' : 'No'}`);
    console.log('');
  });
  
  // Step 6: Show sample track metadata
  if (albums.length > 0) {
    const lastAlbum = albums[albums.length - 1];
    if (lastAlbum.tracks && lastAlbum.tracks.length > 0) {
      const firstTrackRef = lastAlbum.tracks[0];
      const trackFolderPath = path.join(paths.tracks, `${firstTrackRef.id}.info`);
      const trackMeta = readTrackMetadata(trackFolderPath);
      
      if (trackMeta) {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('  Sample Track Metadata (first track of last album)');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
        console.log(JSON.stringify(trackMeta, null, 2));
      }
    }
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Done! Check ~/Music/The Gloaming.library/ for files.');
  console.log('═══════════════════════════════════════════════════════════════');
}

runTest().catch(err => {
  console.error('');
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
