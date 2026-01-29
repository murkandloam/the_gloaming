import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import TopBar from './components/TopBar';
import QueueSidebar from './components/QueueSidebar';
import InspectorSidebar from './components/InspectorSidebar';
import ContextMenu from './components/ContextMenu';
import Foyer from './components/Foyer';
import GridView from './views/GridView';
import RecordSleeveView from './views/RecordSleeveView';
import FacetsView from './views/FacetsView';
import FacetCollectionView from './views/FacetCollectionView';
import MixtapesView from './views/MixtapesView';
import MixtapeSleeveView from './views/MixtapeSleeveView';
import ProgramsView from './views/ProgramsView';
import LedgersView from './views/LedgersView';
import ConfigurationView from './views/ConfigurationView';
import SearchResultsView from './views/SearchResultsView';
import PanopticonView from './views/PanopticonView';
import ImportModal from './components/ImportModal';
import useAudioPlayer from './audio/useAudioPlayer';
import {
  createTrackContextMenuBuilder,
  createRecordContextMenuBuilder,
  createMixtapeContextMenuBuilder,
  createFacetContextMenuBuilder,
  createAttachmentContextMenuBuilder
} from './utils/contextMenuBuilders';
import './styles/App.css';
import './styles/themes.css';

// Eye asset for induction animation
import inductionEyeImage from './assets/panopticon/eyecentre.png';

// Get Electron IPC if available
const { ipcRenderer } = window.require ? window.require('electron') : {};

function App() {
  // App initialization state
  const [appState, setAppState] = useState('loading'); // 'loading' | 'foyer' | 'ready'
  const [libraryInfo, setLibraryInfo] = useState(null); // { path, name }
  
  const [currentView, setCurrentView] = useState('RECORDS');
  const [albums, setAlbums] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState(null);
  
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('nowPlaying');
  const [triggerFacetPicker, setTriggerFacetPicker] = useState(0);
  const [triggerAddToMixtape, setTriggerAddToMixtape] = useState(0);
  const [queue, setQueue] = useState([]);
  const [queuePosition, setQueuePosition] = useState(0); // Index into queue array
  const [playbackHistory, setPlaybackHistory] = useState([]); // For previous track
  const [activeProgramId, setActiveProgramId] = useState(null); // For continuous program playback
  const [activeProgramName, setActiveProgramName] = useState(null); // Program name for source display
  const [isGeneratingTracks, setIsGeneratingTracks] = useState(false); // Prevent duplicate requests
  const [viewingProgramId, setViewingProgramId] = useState(null); // For navigating to a specific program
  
  // Theme state - Cabinet mode only (dark wood aesthetic)
  const [theme, setTheme] = useState('cabinet');
  const [showAlbumLabels, setShowAlbumLabels] = useState(false);
  const [visualizerSync, setVisualizerSync] = useState(30); // ms lookahead (0-200)

  // Panopticon initial selection state (consumed when switching to PANOPTICON view)
  const [panopticonInitialId, setPanopticonInitialId] = useState(null); // Attachment ID
  const [panopticonInitialRecordId, setPanopticonInitialRecordId] = useState(null);
  const [panopticonInitialTrackId, setPanopticonInitialTrackId] = useState(null);
  const [panopticonInitialMixtapeId, setPanopticonInitialMixtapeId] = useState(null);
  const [panopticonInductionPath, setPanopticonInductionPath] = useState(null);

  // Handle showAlbumLabels change and persist to library config
  const handleShowAlbumLabelsChange = useCallback(async (value) => {
    setShowAlbumLabels(value);
    if (!ipcRenderer) return;

    try {
      const config = await ipcRenderer.invoke('get-library-config');
      const updatedConfig = {
        ...config,
        settings: {
          ...config?.settings,
          showAlbumLabels: value
        }
      };
      await ipcRenderer.invoke('save-library-config', updatedConfig);
      console.log('Saved showAlbumLabels:', value);
    } catch (err) {
      console.error('Failed to save showAlbumLabels:', err);
    }
  }, []);

  // Handle visualizerSync change, persist to config, and send to audio engine
  const handleVisualizerSyncChange = useCallback(async (value) => {
    setVisualizerSync(value);
    if (!ipcRenderer) return;

    try {
      // Send to audio engine immediately (convert ms to seconds)
      await ipcRenderer.invoke('audio:setLookahead', value / 1000);

      // Persist to config
      const config = await ipcRenderer.invoke('get-library-config');
      const updatedConfig = {
        ...config,
        settings: {
          ...config?.settings,
          visualizerSync: value
        }
      };
      await ipcRenderer.invoke('save-library-config', updatedConfig);
      console.log('Saved visualizerSync:', value);
    } catch (err) {
      console.error('Failed to save visualizerSync:', err);
    }
  }, []);

  // GridView persisted state (survives tab switches)
  const [gridViewState, setGridViewState] = useState({
    filterMode: 'all',
    someFilters: {
      LPs: true,
      EPs: true,
      Singles: true,
      Soundtracks: true,
      Compilations: true,
      Concerts: false,
      ComposerWorks: false,
      Miscellanea: false,
      Reissues: false
    },
    separatorsEnabled: false,
    separatorField: 'artist',
    sortPills: [{ field: 'artist', direction: 'asc' }],
    gridSize: 180
  });
  // MixtapesView persisted state
  const [mixtapesViewState, setMixtapesViewState] = useState({
    sortField: 'name',
    sortDirection: 'asc',
    gridSize: 140
  });
  // Sleeve view state
  const [viewingSleeve, setViewingSleeve] = useState(null); // Album being viewed as sleeve
  const [viewHistory, setViewHistory] = useState([]); // For back button navigation
  // Facet collection view state
  const [viewingFacet, setViewingFacet] = useState(null); // Facet being viewed as collection
  // Mixtape sleeve view state
  const [viewingMixtape, setViewingMixtape] = useState(null); // Mixtape being viewed
  // Cache buster for cover images (increment to force reload)
  const [coverCacheBust, setCoverCacheBust] = useState(0);
  // Refresh key for facet views (increment to force reload)
  const [facetRefreshKey, setFacetRefreshKey] = useState(0);
  // Refresh key for library-dependent views (ledgers, mixtapes, etc.)
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [allFacets, setAllFacets] = useState([]);
  const [allMixtapes, setAllMixtapes] = useState([]);
  const [allPrograms, setAllPrograms] = useState([]);
  const searchInputRef = useRef(null);

  // Eye animation state (for import ceremony)
  const [showInductionEye, setShowInductionEye] = useState(false);

  // Import modal state (v2 - fast and dumb)
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPaths, setImportPaths] = useState(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items: [...] } or null

  // Multi-track selection state (independent from Inspector)
  const [selectedTrackIds, setSelectedTrackIds] = useState(new Set());

  // Clipboard state for copy/paste
  const [clipboard, setClipboard] = useState({ type: null, data: null });
  // type: 'tracks' | 'attachment' | null
  // data: array of track objects, or attachment object

  // Delete confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  // { type: 'track' | 'album' | 'attachment', item: {...}, onConfirm: () => {} }

  // Handle queue advancement when track ends
  const handleQueueAdvance = useCallback(() => {
    setQueuePosition(prev => prev + 1);
  }, []);

  // Handle adding a track to playback history (called when 10+ seconds played or track ends)
  // History shows unique tracks only - if track already exists, move it to the end
  const handleAddToHistory = useCallback(({ trackId, albumId, artist }) => {
    if (!trackId) return;

    setPlaybackHistory(prev => {
      // Remove any existing entry for this track (we'll add it fresh at the end)
      const withoutThisTrack = prev.filter(t => t.id !== trackId);

      // If it was already the most recent, no change needed
      if (withoutThisTrack.length === prev.length - 1 && prev[prev.length - 1]?.id === trackId) {
        return prev;
      }

      // Find the full track info from albums
      let trackInfo = null;
      for (const album of albums) {
        const track = album.tracks?.find(t => t.id === trackId);
        if (track) {
          // Only copy the specific fields we need (avoid spreading unknown properties)
          trackInfo = {
            id: track.id,
            title: track.title,
            artist: track.trackArtist || album.artist,
            album: album.title,
            albumId: album.id,
            albumArt: track.trackThumbnailPath || track.trackCoverPath || album.thumbnailPath || album.coverPath,
            audioPath: track.audioPath || track.path
          };
          break;
        }
      }

      // If not found in albums, construct minimal info
      if (!trackInfo) {
        trackInfo = { id: trackId, albumId, artist, title: 'Unknown Track' };
      }

      // Add to end of history, keep last 50 unique tracks
      return [...withoutThisTrack.slice(-49), trackInfo];
    });
  }, [albums]);

  // Audio playback hook
  const {
    isPlaying,
    currentTrack: nowPlaying,
    currentTime,
    duration,
    volume,
    progress,
    currentTimeFormatted,
    durationFormatted,
    loadTrack,
    togglePlayPause,
    seek,
    seekPercent,
    setVolume,
    skipNext,
    skipPrev,
    stop,
    spectrumBands,
  } = useAudioPlayer({
    queue,
    queuePosition,
    onQueueAdvance: handleQueueAdvance,
    onAddToHistory: handleAddToHistory,
    onError: (error) => console.error('[App] Audio error:', error)
  });

  // Apply theme to body element
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  // Check for library on mount
  useEffect(() => {
    async function checkAppState() {
      if (!ipcRenderer) {
        console.log('No IPC - showing foyer');
        setAppState('foyer');
        return;
      }
      
      try {
        const result = await ipcRenderer.invoke('get-app-state');
        console.log('App state:', result);

        // Only skip foyer if shunFoyer is enabled AND we have a valid library
        if (result.hasLibrary && result.shunFoyer) {
          // Switch to library window mode (larger minimum size)
          await ipcRenderer.invoke('set-window-mode', 'library');
          setLibraryInfo(result.libraryInfo);
          setAppState('ready');
        } else {
          setAppState('foyer');
        }
      } catch (err) {
        console.error('Failed to check app state:', err);
        setAppState('foyer');
      }
    }
    
    checkAppState();
  }, []);

  // Session loaded flag - prevents saving before we've loaded
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Load library function - extracted so it can be called from context menus
  const loadLibrary = useCallback(async () => {
    if (appState !== 'ready' || !ipcRenderer) return;

    setLibraryLoading(true);

    try {
      // Load albums
      const result = await ipcRenderer.invoke('load-albums');
      if (result.error) {
        setLibraryError(result.error);
      } else {
        setAlbums(result.albums);
        console.log('Loaded albums:', result.albums.length);

        // Update viewingSleeve with fresh data if open
        setViewingSleeve(prev => {
          if (prev) {
            const freshAlbum = result.albums.find(a => a.id === prev.id);
            return freshAlbum || prev;
          }
          return prev;
        });
      }

      // Load settings from library config
      const config = await ipcRenderer.invoke('get-library-config');
      if (config?.settings?.showAlbumLabels !== undefined) {
        setShowAlbumLabels(config.settings.showAlbumLabels);
        console.log('Loaded showAlbumLabels:', config.settings.showAlbumLabels);
      }
      if (config?.settings?.visualizerSync !== undefined) {
        setVisualizerSync(config.settings.visualizerSync);
        // Also send to audio engine on load
        await ipcRenderer.invoke('audio:setLookahead', config.settings.visualizerSync / 1000);
        console.log('Loaded visualizerSync:', config.settings.visualizerSync);
      }
    } catch (err) {
      console.error('Failed to load library:', err);
      setLibraryError(err.message);
    } finally {
      setLibraryLoading(false);
    }
  }, [appState]);

  // Load library when app is ready
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Load session state after library is loaded (runs only once)
  useEffect(() => {
    async function loadSessionState() {
      // Only load session once - skip if already loaded or still loading library
      if (sessionLoaded || appState !== 'ready' || !ipcRenderer || libraryLoading) return;

      try {
        const result = await ipcRenderer.invoke('load-session');
        if (result.success && result.session) {
          const s = result.session;
          console.log('Loaded session:', s);

          // Restore current track (queue is not persisted - starts fresh)
          if (s.currentTrack) {
            // Load the track but don't auto-play
            await loadTrack(s.currentTrack, false);
            // Restore playback position if saved (with small delay to ensure audio is ready)
            if (s.currentTime && s.currentTime > 0) {
              setTimeout(() => seek(s.currentTime), 100);
            }
          }

          // Restore view states (with migration for legacy lpsOnly)
          if (s.gridViewState) {
            const migrated = { ...s.gridViewState };
            // Migrate legacy lpsOnly to new filterMode
            if ('lpsOnly' in migrated && !('filterMode' in migrated)) {
              migrated.filterMode = migrated.lpsOnly ? 'lps' : 'all';
              delete migrated.lpsOnly;
            }
            // Ensure someFilters exists with defaults
            if (!migrated.someFilters) {
              migrated.someFilters = {
                LPs: true, EPs: true, Singles: true, Soundtracks: true, Compilations: true,
                Concerts: false, ComposerWorks: false, Miscellanea: false, Reissues: false
              };
            }
            setGridViewState(migrated);
          }
          if (s.mixtapesViewState) setMixtapesViewState(s.mixtapesViewState);
        }
      } catch (err) {
        console.error('Failed to load session:', err);
      } finally {
        setSessionLoaded(true);
      }
    }

    loadSessionState();
  }, [appState, libraryLoading, loadTrack, seek, sessionLoaded]);

  // Save session helper
  const saveSessionState = useCallback(async (data) => {
    if (!ipcRenderer || !sessionLoaded) return;
    try {
      await ipcRenderer.invoke('save-session', data);
    } catch (err) {
      console.error('Failed to save session:', err);
    }
  }, [sessionLoaded]);

  // Debounced save for view options (2 second delay)
  const viewOptionsTimeoutRef = useRef(null);
  useEffect(() => {
    if (!sessionLoaded) return;

    // Clear previous timeout
    if (viewOptionsTimeoutRef.current) {
      clearTimeout(viewOptionsTimeoutRef.current);
    }

    // Set new timeout
    viewOptionsTimeoutRef.current = setTimeout(() => {
      saveSessionState({
        gridViewState,
        mixtapesViewState,
        currentTrack: nowPlaying
      });
    }, 2000);

    return () => {
      if (viewOptionsTimeoutRef.current) {
        clearTimeout(viewOptionsTimeoutRef.current);
      }
    };
  }, [gridViewState, mixtapesViewState, sessionLoaded, saveSessionState]);

  // Save current track immediately on track changes
  useEffect(() => {
    if (!sessionLoaded) return;

    saveSessionState({
      gridViewState,
      mixtapesViewState,
      currentTrack: nowPlaying,
      currentTime: currentTime
    });
  }, [nowPlaying, sessionLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save session before window closes
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleBeforeUnload = () => {
      // Synchronous save attempt - may not complete but worth trying
      ipcRenderer.invoke('save-session', {
        gridViewState,
        mixtapesViewState,
        currentTrack: nowPlaying,
        currentTime: currentTime
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [gridViewState, mixtapesViewState, nowPlaying]);

  // Load facets, mixtapes, and programs for search
  useEffect(() => {
    async function loadSearchData() {
      if (appState !== 'ready' || !ipcRenderer) return;
      try {
        const [facets, facetsConfig, mixtapes, programs] = await Promise.all([
          ipcRenderer.invoke('get-all-facets'),
          ipcRenderer.invoke('get-facets'),
          ipcRenderer.invoke('get-all-mixtapes'),
          ipcRenderer.invoke('get-all-programs')
        ]);
        // Merge in empty facets from the recent list that aren't already in allFacets
        const existingNames = new Set((facets || []).map(f => f.name));
        const emptyFacets = (facetsConfig?.recent || [])
          .filter(name => !existingNames.has(name))
          .map(name => ({ name, count: 0 }));
        setAllFacets([...(facets || []), ...emptyFacets]);
        setAllMixtapes(mixtapes || []);
        setAllPrograms(programs || []);
      } catch (err) {
        console.error('Failed to load search data:', err);
      }
    }
    loadSearchData();
  }, [appState, facetRefreshKey, libraryRefreshKey]);

  // Search results - computed from albums, tracks, facets, mixtapes, and programs
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) {
      return { albums: [], tracks: [], facets: [], mixtapes: [], programs: [] };
    }

    const query = searchQuery.toLowerCase();

    // Search albums by title, artist
    const matchingAlbums = albums.filter(album =>
      album.title?.toLowerCase().includes(query) ||
      album.artist?.toLowerCase().includes(query)
    );

    // Search tracks - need to flatten from albums
    const matchingTracks = [];
    albums.forEach(album => {
      if (album.tracks) {
        album.tracks.forEach(track => {
          if (
            track.title?.toLowerCase().includes(query) ||
            album.artist?.toLowerCase().includes(query) ||
            album.title?.toLowerCase().includes(query)
          ) {
            matchingTracks.push({
              ...track,
              id: track.id,  // Use actual track UUID
              artist: track.trackArtist || album.artist,
              album: album.title,
              albumId: album.id,
              albumArt: track.trackThumbnailPath || track.trackCoverPath || album.thumbnailPath || album.coverPath
            });
          }
        });
      }
    });

    // Search facets by name
    const matchingFacets = allFacets.filter(facet =>
      facet.name?.toLowerCase().includes(query)
    );

    // Search mixtapes by name
    const matchingMixtapes = allMixtapes.filter(mixtape =>
      mixtape.name?.toLowerCase().includes(query)
    );

    // Search programs by name
    const matchingPrograms = allPrograms.filter(program =>
      program.name?.toLowerCase().includes(query)
    );

    return {
      albums: matchingAlbums,
      tracks: matchingTracks,
      facets: matchingFacets,
      mixtapes: matchingMixtapes,
      programs: matchingPrograms
    };
  }, [searchQuery, albums, allFacets, allMixtapes, allPrograms]);

  // Handle library ready from Foyer
  const handleLibraryReady = async (info) => {
    console.log('Library ready:', info);
    // Switch to library window mode (larger minimum size)
    await ipcRenderer.invoke('set-window-mode', 'library');
    setLibraryInfo(info);
    setAppState('ready');
  };

  // Handle return to Foyer from Configuration
  const handleReturnToFoyer = async () => {
    // Stop any playing audio
    if (isPlaying) {
      togglePlayPause();
    }
    // Switch to foyer window mode (smaller fixed size)
    await ipcRenderer.invoke('set-window-mode', 'foyer');
    setAppState('foyer');
  };

  // Refresh albums from library
  const refreshAlbums = async () => {
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('load-albums');
      if (!result.error) {
        setAlbums(result.albums);
        console.log('Refreshed albums:', result.albums.length);
      }
    } catch (err) {
      console.error('Failed to refresh albums:', err);
    }
  };

  // Handle folder/file drop for Import v2 (fast and dumb - ceremonial Eye animation)
  const handleInductFolder = useCallback((dropData) => {
    // dropData can be: { folders: string[], files: string[] } (new format)
    // or string (legacy single path format)
    const isLegacy = typeof dropData === 'string';
    const folders = isLegacy ? [dropData] : (dropData.folders || []);
    const files = isLegacy ? [] : (dropData.files || []);

    // Combine all paths for import
    const allPaths = [...folders, ...files];
    if (allPaths.length === 0) return;

    console.log('[Import v2] Drop received - paths:', allPaths.length);

    // Show the Eye animation
    setShowInductionEye(true);

    // After the Eye animation, start the import
    setTimeout(() => {
      console.log('[Import v2] Eye animation complete, starting import');
      setShowInductionEye(false);
      setImportPaths(allPaths);
      setImportModalOpen(true);
    }, 1200); // Eye appears, blinks, then transitions
  }, []);

  // Handle import completion
  const handleImportComplete = useCallback((result) => {
    console.log('[Import v2] Import complete:', result);
    // Refresh library data
    refreshAlbums();
  }, []);

  // Close import modal
  const handleImportModalClose = useCallback(() => {
    setImportModalOpen(false);
    setImportPaths(null);
  }, []);

  // Context menu helpers
  const showContextMenu = useCallback((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Clear multi-selection when navigating away or pressing Escape
  const clearSelection = useCallback(() => {
    setSelectedTrackIds(new Set());
  }, []);

  // Keyboard shortcuts (must be after hideContextMenu and clearSelection definitions)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Space - toggle play/pause (unless in text field or modal)
      if (e.key === ' ' || e.code === 'Space') {
        const tag = e.target.tagName.toLowerCase();
        const isEditable = e.target.isContentEditable;
        const isTextInput = tag === 'input' || tag === 'textarea' || isEditable;
        const isModalOpen = importModalOpen || deleteConfirm;

        if (!isTextInput && !isModalOpen) {
          e.preventDefault();
          // Blur any focused button to prevent it from being triggered
          if (tag === 'button') {
            e.target.blur();
          }
          togglePlayPause();
        }
      }
      // Escape - close context menu, clear selection, close search, return to Now Playing
      if (e.key === 'Escape') {
        if (contextMenu) {
          hideContextMenu();
        } else if (selectedTrackIds.size > 0) {
          clearSelection();
        } else if (searchActive) {
          setSearchActive(false);
        } else {
          setSelectedTrack(null);
          setInspectorTab('nowPlaying');
        }
      }
      // Cmd+F or Ctrl+F - focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchActive(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchActive, contextMenu, selectedTrackIds.size, hideContextMenu, clearSelection, togglePlayPause, importModalOpen, deleteConfirm]);

  // Add track to queue - use functional update and add unique queueId
  const handleAddToQueue = useCallback((track) => {
    const queueItem = {
      ...track,
      queueId: `added-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      audioPath: track.audioPath || track.path
    };
    setQueue(prevQueue => [...prevQueue, queueItem]);
  }, []);

  // Build context menu items for a track (using extracted builder)
  const buildTrackContextMenu = useMemo(() => createTrackContextMenuBuilder({
    albums,
    loadTrack,
    handleAddToQueue,
    queuePosition,
    setQueue,
    setSelectedTrack,
    setInspectorTab,
    setTriggerAddToMixtape,
    setTriggerFacetPicker,
    setSearchActive,
    setCurrentView,
    setViewingSleeve,
    setViewingMixtape,
    setPanopticonInitialId,
    setPanopticonInitialRecordId,
    setPanopticonInitialTrackId,
    setPanopticonInitialMixtapeId,
    setPanopticonInductionPath,
    setLibraryRefreshKey,
    setFacetRefreshKey,
    setDeleteConfirm,
    selectedTrack,
    loadLibrary,
    viewingSleeve
  }), [albums, loadTrack, handleAddToQueue, queuePosition, selectedTrack, loadLibrary, viewingSleeve]);

  // Build context menu items for a record (using extracted builder)
  const buildRecordContextMenu = useMemo(() => createRecordContextMenuBuilder({
    albums,
    loadTrack,
    queuePosition,
    setQueue,
    setViewingSleeve,
    setPanopticonInitialId,
    setPanopticonInitialRecordId,
    setPanopticonInitialTrackId,
    setPanopticonInitialMixtapeId,
    setPanopticonInductionPath,
    setCurrentView,
    setDeleteConfirm,
    setSelectedAlbum,
    setSelectedTrack,
    selectedAlbum,
    viewingSleeve,
    selectedTrack,
    loadLibrary,
    setLibraryRefreshKey,
    setFacetRefreshKey
  }), [albums, loadTrack, queuePosition, selectedAlbum, viewingSleeve, selectedTrack, loadLibrary]);

  // Build context menu items for a mixtape (using extracted builder)
  const buildMixtapeContextMenu = useMemo(() => createMixtapeContextMenuBuilder({
    loadTrack,
    setQueue,
    setViewingMixtape,
    setPanopticonInitialId,
    setPanopticonInitialRecordId,
    setPanopticonInitialTrackId,
    setPanopticonInitialMixtapeId,
    setPanopticonInductionPath,
    setCurrentView,
    setDeleteConfirm,
    viewingMixtape,
    loadLibrary
  }), [loadTrack, viewingMixtape, loadLibrary]);

  // Build context menu items for a facet (using extracted builder)
  const buildFacetContextMenu = useMemo(() => createFacetContextMenuBuilder({
    loadTrack,
    setQueue,
    setViewingFacet
  }), [loadTrack]);

  // Build context menu items for an attachment (using extracted builder)
  const buildAttachmentContextMenu = useMemo(() => createAttachmentContextMenuBuilder({
    setPanopticonInitialId,
    setPanopticonInitialRecordId,
    setPanopticonInitialTrackId,
    setPanopticonInitialMixtapeId,
    setPanopticonInductionPath,
    setCurrentView,
    setDeleteConfirm,
    setSearchActive,
    setViewingSleeve,
    setViewingMixtape
  }), []);

  // When a track is selected, auto-switch to Selected tab
  const handleTrackSelect = (track) => {
    setSelectedTrack(track);
    setInspectorTab('selected');
  };
  
  // When an album is clicked in the grid - navigate to sleeve view
  // If album is a subordinate (has eraParent), open the vessel's sleeve instead
  const handleAlbumSelect = (album) => {
    // If album doesn't have tracks, look it up from our full albums list
    // (This handles Ledgers view which only has minimal album data)
    let fullAlbum = album;
    if (!album.tracks && album.id) {
      const found = albums.find(a => a.id === album.id);
      if (found) {
        fullAlbum = found;
      }
    }

    // If this album is a subordinate, open the vessel's sleeve instead
    if (fullAlbum.eraParent) {
      const vessel = albums.find(a => a.id === fullAlbum.eraParent);
      if (vessel) {
        setSelectedAlbum(vessel);
        setViewHistory(prev => [...prev, { view: currentView, sleeve: viewingSleeve }]);
        setViewingSleeve(vessel);
        return;
      }
    }

    setSelectedAlbum(fullAlbum);
    // Save current state to history for back navigation
    setViewHistory(prev => [...prev, { view: currentView, sleeve: viewingSleeve }]);
    setViewingSleeve(fullAlbum);
  };
  
  // Back button - always return to top-level view (no sleeve stacking)
  const handleBack = () => {
    setViewingSleeve(null);
    setViewingMixtape(null);
    setViewHistory([]);
    // Stay on current top-level view (RECORDS, FACETS, etc.)
  };
  
  // Open sleeve view for a track's album
  // If album is a subordinate (has eraParent), open the vessel's sleeve instead
  const handleOpenSleeve = (track) => {
    if (!track || !track.albumId) return;

    // Find the album in our albums list
    const album = albums.find(a => a.id === track.albumId);
    if (album) {
      // If this album is a subordinate, open the vessel's sleeve instead
      if (album.eraParent) {
        const vessel = albums.find(a => a.id === album.eraParent);
        if (vessel) {
          setCurrentView('RECORDS');
          setViewingSleeve(vessel);
          return;
        }
      }
      // Switch to RECORDS tab and open the sleeve
      setCurrentView('RECORDS');
      setViewingSleeve(album);
    }
  };
  
  // Play a track (set as now playing) and optionally queue the rest of its album
  // Options: { autoQueueAlbum: true }
  // Note: History is now managed by useAudioPlayer's onAddToHistory callback
  const handlePlayTrack = async (track, options = {}) => {
    // Support legacy boolean signature (ignored now - history handled by audio hook)
    const opts = typeof options === 'boolean'
      ? { autoQueueAlbum: true }
      : { autoQueueAlbum: true, ...options };

    // Clear active program when playing from a non-program source
    // (This stops continuous program track generation)
    setActiveProgramId(null);

    const trackWithMeta = {
      ...track,
      queueId: `playing-${Date.now()}`,
      releaseDate: track.releaseDate || null,
      fileType: track.fileType || 'ALAC',
      totalListeningTime: '0m',
      playCount: 0,
      facets: track.facets || [],
      // Ensure we have audioPath for the audio engine
      audioPath: track.audioPath || track.path
    };

    // Build full queue including current track (position-based model)
    let fullQueue = [trackWithMeta];
    let startPosition = 0;

    if (opts.autoQueueAlbum && track.albumId) {
      const album = albums.find(a => a.id === track.albumId);
      if (album && album.tracks) {
        // Find the index of this track in the album by ID or title
        const trackIndex = album.tracks.findIndex(t =>
          t.id === track.id || t.title === track.title
        );

        if (trackIndex !== -1) {
          // Build queue with ALL album tracks, starting from the clicked track
          fullQueue = album.tracks.slice(trackIndex).map((t, i) => ({
            queueId: `track-play-${Date.now()}-${i}`,
            id: t.id,
            title: t.title,
            artist: t.trackArtist || album.artist,
            album: album.title,
            albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: t.audioPath || t.path
          }));
          startPosition = 0; // Current track is at position 0 in the new queue
        }
      }
    }

    // IMPORTANT: Load the track FIRST, then set the queue
    // This ensures the preload (triggered by queue change) happens AFTER the load
    await loadTrack(trackWithMeta);

    // Now set the queue and position - this will trigger preload for the next track
    setQueue(fullQueue);
    setQueuePosition(startPosition);
  };
  
  // Skip to previous track in queue (or restart current if < 3 seconds or at position 0)
  const handleSkipPrev = async () => {
    // If we're more than 3 seconds into the track, just restart it
    if (currentTime > 3) {
      seek(0);
      return;
    }

    // If we can go back in the queue, do so
    if (queuePosition > 0) {
      const newPosition = queuePosition - 1;
      const prevTrack = queue[newPosition];
      if (prevTrack) {
        // IMPORTANT: Load track FIRST, then update position
        // This ensures the preload useEffect fires AFTER loadTrack clears the preloaded state
        await loadTrack(prevTrack);
        setQueuePosition(newPosition);
        return;
      }
    }

    // No previous track available, just restart
    seek(0);
  };

  // Handle tracks from Programs - clears queue and starts playing
  // Also stores programId for continuous generation
  // program can be { id, name } or just id for backwards compat
  const handleProgramTracks = async (tracks, program = null) => {
    if (!tracks || tracks.length === 0) return;

    // Extract program info - support both object and bare id
    const programId = program?.id || program;
    const programName = program?.name || null;

    // Store the program ID and name for continuous playback
    setActiveProgramId(programId);
    setActiveProgramName(programName);

    // Source metadata for these tracks
    const sourceInfo = programId ? {
      sourceType: 'program',
      sourceId: programId,
      sourceName: programName
    } : {};

    // Build full queue including first track (position-based model)
    const firstTrack = tracks[0];
    const fullQueue = tracks.map((t, i) => ({
      queueId: `program-${Date.now()}-${i}`,
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumId: t.albumId,
      albumArt: t.albumArt,
      audioPath: t.audioPath,
      duration: t.duration,
      ...sourceInfo
    }));

    // Load first track, then set queue and position
    await loadTrack({
      id: firstTrack.id,
      title: firstTrack.title,
      artist: firstTrack.artist,
      album: firstTrack.album,
      albumId: firstTrack.albumId,
      albumArt: firstTrack.albumArt,
      audioPath: firstTrack.audioPath,
      duration: firstTrack.duration,
      ...sourceInfo
    }, true);

    setQueue(fullQueue);
    setQueuePosition(0);
  };

  // Generate more tracks from the active program when queue runs low
  useEffect(() => {
    if (!activeProgramId || !ipcRenderer || isGeneratingTracks) return;

    // Generate more tracks when remaining tracks drops below threshold
    const QUEUE_THRESHOLD = 20;
    const remainingTracks = queue.length - queuePosition - 1; // tracks after current

    if (remainingTracks < QUEUE_THRESHOLD) {
      const generateMoreTracks = async () => {
        setIsGeneratingTracks(true);
        try {
          console.log('[App] Queue low, generating more tracks from program:', activeProgramId);
          const result = await ipcRenderer.invoke('run-program', { programId: activeProgramId });

          if (result.success && result.tracks.length > 0) {
            // Add new tracks to the queue with source metadata
            const newTracks = result.tracks.map((t, i) => ({
              queueId: `program-cont-${Date.now()}-${i}`,
              id: t.id,
              title: t.title,
              artist: t.artist,
              album: t.album,
              albumId: t.albumId,
              albumArt: t.albumArt,
              audioPath: t.audioPath,
              duration: t.duration,
              sourceType: 'program',
              sourceId: activeProgramId,
              sourceName: activeProgramName
            }));

            setQueue(prev => [...prev, ...newTracks]);
            console.log(`[App] Added ${newTracks.length} tracks to queue`);
          } else if (!result.success) {
            console.error('[App] Failed to generate more tracks:', result.error);
            // Clear active program on error to prevent infinite retries
            setActiveProgramId(null);
            setActiveProgramName(null);
          }
        } catch (err) {
          console.error('[App] Error generating tracks:', err);
          setActiveProgramId(null);
          setActiveProgramName(null);
        } finally {
          setIsGeneratingTracks(false);
        }
      };

      generateMoreTracks();
    }
  }, [queue.length, queuePosition, activeProgramId, isGeneratingTracks]);
  
  // Play entire album - clears queue and starts fresh
  const handlePlayAlbum = async (album) => {
    if (album.tracks && album.tracks.length > 0) {
      const firstTrack = album.tracks[0];

      // handlePlayTrack will set up the full queue with position-based model
      await handlePlayTrack({
        id: firstTrack.id,
        title: firstTrack.title,
        artist: firstTrack.trackArtist || album.artist,
        album: album.title,
        albumArt: firstTrack.trackThumbnailPath || firstTrack.trackCoverPath || album.thumbnailPath || album.coverPath,
        albumId: album.id,
        audioPath: firstTrack.audioPath || firstTrack.path
      });
    }
  };

  // Queue entire album
  const handleQueueAlbum = (album) => {
    if (album.tracks && album.tracks.length > 0) {
      const queueTracks = album.tracks.map((t, i) => ({
        queueId: `album-queue-${Date.now()}-${i}`,
        id: t.id,  // Use actual track UUID
        title: t.title,
        artist: t.trackArtist || album.artist,
        album: album.title,
        albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
        albumId: album.id,
        audioPath: t.audioPath || t.path
      }));
      setQueue(prevQueue => [...prevQueue, ...queueTracks]);
    }
  };
  
  // Find child albums for an album (from manual era links in _meta.json)
  // For now, returns empty - era linking is a future feature
  const getChildAlbums = (parentAlbum) => {
    if (!parentAlbum?.eraChildren?.length) {
      return [];
    }
    const children = albums.filter(a => parentAlbum.eraChildren.includes(a.id));
    return children;
  };

  // The track that inspector shows depends on active tab
  const inspectorTrack = inspectorTab === 'nowPlaying' ? nowPlaying : selectedTrack;

  // Handle album metadata update (from Manifest)
  const handleAlbumUpdate = async (updatedAlbum) => {
    // Bust the cover cache to force image reload
    setCoverCacheBust(Date.now());
    // Reload all albums to get updated eraChildren on parent
    try {
      const result = await ipcRenderer.invoke('load-albums');
      if (result.albums) {
        setAlbums(result.albums);
        // Update viewingSleeve with fresh data
        if (viewingSleeve) {
          const freshAlbum = result.albums.find(a => a.id === viewingSleeve.id);
          if (freshAlbum) {
            setViewingSleeve(freshAlbum);
          }
        }
      }
    } catch (err) {
      console.error('Error reloading albums:', err);
      // Fallback to local update
      setAlbums(prev => prev.map(a =>
        a.id === updatedAlbum.id ? { ...a, ...updatedAlbum } : a
      ));
      if (viewingSleeve?.id === updatedAlbum.id) {
        setViewingSleeve(prev => ({ ...prev, ...updatedAlbum }));
      }
    }
  };

  // Handle album delete (from Manifest)
  const handleAlbumDelete = (albumId) => {
    setAlbums(prev => prev.filter(a => a.id !== albumId));
    setViewingSleeve(null);
  };

  const renderView = () => {
    // If search is active, show search results
    if (searchActive) {
      return (
        <SearchResultsView
          query={searchQuery}
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          facets={searchResults.facets}
          mixtapes={searchResults.mixtapes}
          programs={searchResults.programs}
          coverCacheBust={coverCacheBust}
          onAlbumSelect={(album) => {
            setSearchActive(false);
            handleAlbumSelect(album);
          }}
          onTrackSelect={(track) => {
            handleTrackSelect(track);
          }}
          onFacetSelect={(facetName) => {
            setSearchActive(false);
            setViewingFacet(facetName);
            setCurrentView('FACETS');
          }}
          onMixtapeSelect={(mixtape) => {
            setSearchActive(false);
            setViewingMixtape(mixtape);
            setCurrentView('MIXTAPES');
          }}
          onProgramSelect={(program) => {
            setSearchActive(false);
            setCurrentView('PROGRAMS');
            // Programs view will handle selecting this program
          }}
        />
      );
    }

    // If viewing a sleeve, show that regardless of current tab
    if (viewingSleeve) {
      return (
        <RecordSleeveView
          album={viewingSleeve}
          childAlbums={getChildAlbums(viewingSleeve)}
          coverCacheBust={coverCacheBust}
          onBack={handleBack}
          onTrackSelect={handleTrackSelect}
          onPlayTrack={handlePlayTrack}
          onQueueTrack={handleAddToQueue}
          onPlayAlbum={handlePlayAlbum}
          onQueueAlbum={handleQueueAlbum}
          onRoamAlbum={async (album) => {
            // Shuffle album tracks and play
            if (album.tracks && album.tracks.length > 0) {
              // Fisher-Yates shuffle
              const shuffled = [...album.tracks];
              for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              // Build proper track objects with album metadata (position-based model)
              const tracksWithMeta = shuffled.map((t, i) => ({
                queueId: `roam-album-${Date.now()}-${i}`,
                id: t.id,  // Use actual track UUID
                title: t.title,
                artist: t.trackArtist || album.artist,
                album: album.title,
                albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
                albumId: album.id,
                audioPath: t.audioPath || t.path
              }));
              // Load first track, then set full queue
              await loadTrack(tracksWithMeta[0], true);
              setQueue(tracksWithMeta);
              setQueuePosition(0);
            }
          }}
          onToggleLP={() => {/* TODO: toggle LP status */}}
          onAlbumUpdate={handleAlbumUpdate}
          onAlbumDelete={handleAlbumDelete}
          onOpenChildSleeve={(childAlbum) => setViewingSleeve(childAlbum)}
          onTrackContextMenu={(e, track, context) => {
            const items = buildTrackContextMenu(track, context);
            showContextMenu(e, items);
          }}
          onAttachmentContextMenu={(e, attachment, extraData) => {
            const items = buildAttachmentContextMenu(attachment, extraData);
            showContextMenu(e, items);
          }}
          onFacetContextMenu={(e, facet) => {
            const items = buildFacetContextMenu(facet);
            showContextMenu(e, items);
          }}
          onFacetClick={(facetName) => {
            setViewingSleeve(null);
            setCurrentView('FACETS');
            setViewingFacet(facetName);
          }}
          onFacetsChange={() => setFacetRefreshKey(k => k + 1)}
          onViewInPanopticon={(album) => {
            // Open Panopticon with this record selected
            setPanopticonInitialId(null);
            setPanopticonInitialRecordId(album.id);
            setPanopticonInitialTrackId(null);
            setPanopticonInitialMixtapeId(null);
            setPanopticonInductionPath(null);
            setViewingSleeve(null); // Clear sleeve so Panopticon actually shows
            setCurrentView('PANOPTICON');
          }}
          refreshKey={libraryRefreshKey}
        />
      );
    }

    // If viewing a facet collection, show that
    if (viewingFacet) {
      return (
        <FacetCollectionView
          facetName={viewingFacet}
          refreshKey={facetRefreshKey}
          onBack={() => setViewingFacet(null)}
          onPlayTrack={async (track, remainingTracks) => {
            // Build full queue including current track (position-based model)
            const trackWithMeta = {
              ...track,
              queueId: `facet-${Date.now()}-0`
            };
            const fullQueue = [trackWithMeta];
            if (remainingTracks && remainingTracks.length > 0) {
              fullQueue.push(...remainingTracks.map((t, i) => ({
                ...t,
                queueId: `facet-${Date.now()}-${i + 1}`
              })));
            }
            await loadTrack(trackWithMeta, true);
            setQueue(fullQueue);
            setQueuePosition(0);
          }}
          onRoamFacet={async (tracks) => {
            if (tracks.length === 0) return;
            // Fisher-Yates shuffle
            const shuffled = [...tracks];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            // Build full queue (position-based model)
            const fullQueue = shuffled.map((t, i) => ({
              ...t,
              queueId: `facet-roam-${Date.now()}-${i}`
            }));
            await loadTrack(fullQueue[0], true);
            setQueue(fullQueue);
            setQueuePosition(0);
          }}
          onSelectTrack={handleTrackSelect}
        />
      );
    }

    // If viewing a mixtape sleeve, show that
    if (viewingMixtape) {
      return (
        <MixtapeSleeveView
          mixtape={viewingMixtape}
          onBack={handleBack}
          onTrackSelect={handleTrackSelect}
          onPlayTrack={async (track, remainingTracks) => {
            // Build full queue including current track (position-based model)
            const trackWithMeta = {
              ...track,
              queueId: `mixtape-${Date.now()}-0`,
              sourceType: 'mixtape',
              sourceId: viewingMixtape.id,
              sourceName: viewingMixtape.name
            };
            const fullQueue = [trackWithMeta];
            if (remainingTracks && remainingTracks.length > 0) {
              fullQueue.push(...remainingTracks.map((t, i) => ({
                ...t,
                queueId: `mixtape-${Date.now()}-${i + 1}`,
                sourceType: 'mixtape',
                sourceId: viewingMixtape.id,
                sourceName: viewingMixtape.name
              })));
            }
            await loadTrack(trackWithMeta, true);
            setQueue(fullQueue);
            setQueuePosition(0);
          }}
          onPlayMixtape={async (mixtape, tracks) => {
            if (tracks.length > 0) {
              const firstTrack = tracks[0];
              const trackWithMeta = {
                ...firstTrack,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              };
              // Build full queue (position-based model)
              const fullQueue = tracks.map((t, i) => ({
                ...t,
                queueId: `mixtape-play-${Date.now()}-${i}`,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              }));
              await loadTrack(trackWithMeta, true);
              setQueue(fullQueue);
              setQueuePosition(0);
            }
          }}
          onQueueMixtape={(mixtape, tracks) => {
            const queueTracks = tracks.map((t, i) => ({
              ...t,
              queueId: `mixtape-queue-${Date.now()}-${i}`,
              sourceType: 'mixtape',
              sourceId: mixtape.id,
              sourceName: mixtape.name
            }));
            setQueue(prev => [...prev, ...queueTracks]);
          }}
          onRoamMixtape={async (mixtape, shuffledTracks, seed) => {
            // Play shuffled tracks (position-based model)
            if (shuffledTracks.length > 0) {
              const firstTrack = shuffledTracks[0];
              const trackWithMeta = {
                ...firstTrack,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              };
              // Build full queue with all shuffled tracks
              const fullQueue = shuffledTracks.map((t, i) => ({
                ...t,
                queueId: `roam-${seed}-${Date.now()}-${i}`,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              }));
              await loadTrack(trackWithMeta, true);
              setQueue(fullQueue);
              setQueuePosition(0);
            }
          }}
          onMixtapeUpdate={(updated) => {
            setViewingMixtape(updated);
          }}
          onMixtapeDelete={() => {
            setViewingMixtape(null);
          }}
          onFacetClick={(facetName) => {
            setViewingMixtape(null);
            setCurrentView('FACETS');
            setViewingFacet(facetName);
          }}
          onAttachmentContextMenu={(e, attachment, extraData) => {
            const items = buildAttachmentContextMenu(attachment, extraData);
            showContextMenu(e, items);
          }}
          onViewInPanopticon={(mixtape) => {
            // Open Panopticon with this mixtape selected
            setPanopticonInitialId(null);
            setPanopticonInitialRecordId(null);
            setPanopticonInitialTrackId(null);
            setPanopticonInitialMixtapeId(mixtape.id);
            setPanopticonInductionPath(null);
            setViewingMixtape(null); // Clear mixtape so Panopticon actually shows
            setCurrentView('PANOPTICON');
          }}
          refreshKey={libraryRefreshKey}
        />
      );
    }

    switch(currentView) {
      case 'RECORDS':
        return <GridView
          albums={albums}
          loading={libraryLoading}
          error={libraryError}
          coverCacheBust={coverCacheBust}
          showAlbumLabels={showAlbumLabels}
          onAlbumSelect={handleAlbumSelect}
          onTrackSelect={handleTrackSelect}
          onRoamGroup={async (groupAlbums, groupName, groupField) => {
            // Collect all tracks from albums in this group and shuffle them
            const allTracks = [];
            groupAlbums.forEach(album => {
              if (album.tracks) {
                album.tracks.forEach(track => {
                  allTracks.push({
                    id: track.id,  // Use actual track UUID
                    title: track.title,
                    artist: track.trackArtist || album.artist,
                    album: album.title,
                    albumArt: track.trackThumbnailPath || track.trackCoverPath || album.thumbnailPath || album.coverPath,
                    albumId: album.id,
                    audioPath: track.audioPath || track.path
                  });
                });
              }
            });

            if (allTracks.length > 0) {
              // Fisher-Yates shuffle
              for (let i = allTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
              }

              // Add queueIds after shuffle (position-based model)
              const tracksWithIds = allTracks.map((t, i) => ({
                ...t,
                queueId: `roam-group-${Date.now()}-${i}`
              }));

              // Load first track, then set full queue
              await loadTrack(tracksWithIds[0], true);
              setQueue(tracksWithIds);
              setQueuePosition(0);
            }
          }}
          viewState={gridViewState}
          onViewStateChange={setGridViewState}
          onAlbumContextMenu={(e, album) => {
            const items = buildRecordContextMenu(album, 'grid');
            showContextMenu(e, items);
          }}
          onInductFolder={handleInductFolder}
        />;
      case 'FACETS':
        return <FacetsView
          refreshKey={facetRefreshKey}
          onFacetSelect={(facetName) => setViewingFacet(facetName)}
          onFacetContextMenu={(e, facet, onUpdate) => {
            const items = buildFacetContextMenu(facet, { onUpdate });
            showContextMenu(e, items);
          }}
          onFacetsChanged={() => setFacetRefreshKey(k => k + 1)}
        />;
      case 'MIXTAPES':
        return <MixtapesView
          onMixtapeSelect={(mixtape) => setViewingMixtape(mixtape)}
          onTrackSelect={handleTrackSelect}
          viewState={mixtapesViewState}
          onViewStateChange={setMixtapesViewState}
          onMixtapeContextMenu={(e, mixtape) => {
            const items = buildMixtapeContextMenu(mixtape);
            showContextMenu(e, items);
          }}
          onMixtapesChanged={() => setLibraryRefreshKey(k => k + 1)}
        />;
      case 'PROGRAMS':
        return <ProgramsView
          onQueueTracks={handleProgramTracks}
          initialProgramId={viewingProgramId}
          onProgramViewed={() => setViewingProgramId(null)}
        />;
      case 'LEDGERS':
        return <LedgersView
          onTrackSelect={handleTrackSelect}
          onAlbumSelect={handleAlbumSelect}
          currentTrackId={nowPlaying?.id}
          refreshKey={libraryRefreshKey}
          onTrackContextMenu={(e, track) => {
            const items = buildTrackContextMenu(track, 'ledgers');
            showContextMenu(e, items);
          }}
          onAlbumContextMenu={(e, album) => {
            // Look up full album from our albums list for context menu
            const fullAlbum = albums.find(a => a.id === album.id) || album;
            const items = buildRecordContextMenu(fullAlbum, 'grid');
            showContextMenu(e, items);
          }}
        />;
      case 'CONFIGURATION':
        return <ConfigurationView
          showAlbumLabels={showAlbumLabels}
          onShowAlbumLabelsChange={handleShowAlbumLabelsChange}
          visualizerSync={visualizerSync}
          onVisualizerSyncChange={handleVisualizerSyncChange}
          onReturnToFoyer={handleReturnToFoyer}
        />;
      case 'PANOPTICON':
        return <PanopticonView
          onDataChange={handlePanopticonDataChange}
          onOpenSleeve={(item) => {
            // Check if this is a mixtape
            if (item.entityType === 'mixtape') {
              setCurrentView('MIXTAPES');
              setViewingMixtape(item);
              return;
            }
            // Otherwise treat as a record/album
            const fullAlbum = albums.find(a => a.id === item.id) || item;
            // If this album is a subordinate, open the vessel's sleeve instead
            if (fullAlbum.eraParent) {
              const vessel = albums.find(a => a.id === fullAlbum.eraParent);
              if (vessel) {
                setCurrentView('RECORDS');
                setViewingSleeve(vessel);
                return;
              }
            }
            setCurrentView('RECORDS');
            setViewingSleeve(fullAlbum);
          }}
          initialAttachmentId={panopticonInitialId}
          initialRecordId={panopticonInitialRecordId}
          initialTrackId={panopticonInitialTrackId}
          initialMixtapeId={panopticonInitialMixtapeId}
          initialInductionPath={panopticonInductionPath}
        />;
      default:
        return <GridView
          albums={albums}
          loading={libraryLoading}
          error={libraryError}
          coverCacheBust={coverCacheBust}
          showAlbumLabels={showAlbumLabels}
          onAlbumSelect={handleAlbumSelect}
          onTrackSelect={handleTrackSelect}
          viewState={gridViewState}
          onViewStateChange={setGridViewState}
          onAlbumContextMenu={(e, album) => {
            const items = buildRecordContextMenu(album, 'grid');
            showContextMenu(e, items);
          }}
          onInductFolder={handleInductFolder}
        />;
    }
  };
  
  // Handle tab changes - close sleeve/facet/search and go to that tab
  const handleViewChange = (view) => {
    // If leaving Panopticon, clear its initial selection state and reload library
    if (currentView === 'PANOPTICON' && view !== 'PANOPTICON') {
      setPanopticonInitialId(null);
      setPanopticonInitialRecordId(null);
      setPanopticonInitialTrackId(null);
      setPanopticonInitialMixtapeId(null);
      setPanopticonInductionPath(null);
      loadLibrary(); // Reload library to pick up any changes made in Panopticon
    }

    setSearchActive(false);
    setViewingSleeve(null);
    setViewingFacet(null);
    setViewingMixtape(null);
    setViewHistory([]);
    setCurrentView(view);
    clearSelection(); // Clear multi-selection on view change
    hideContextMenu(); // Close any open context menu
  };

  // Handle data changes from Panopticon (track reorder, backdrop changes, etc.)
  // This keeps sleeve views in sync while Panopticon is open
  const handlePanopticonDataChange = useCallback(async () => {
    console.log('[App] handlePanopticonDataChange called');
    // Bust the cover cache to force image reload
    setCoverCacheBust(Date.now());
    // Increment refresh key to trigger sleeve view reloads (attachments, facets, etc.)
    setLibraryRefreshKey(k => k + 1);
    // Reload all albums to get updated data
    try {
      const result = await ipcRenderer.invoke('load-albums');
      if (result.albums) {
        setAlbums(result.albums);
        // Update viewingSleeve with fresh data if open (use functional form to avoid stale closure)
        setViewingSleeve(prev => {
          if (prev) {
            const freshAlbum = result.albums.find(a => a.id === prev.id);
            console.log('[App] Updating viewingSleeve:', prev.id, 'tracks before:', prev.tracks?.map(t => t.title), 'tracks after:', freshAlbum?.tracks?.map(t => t.title));
            return freshAlbum || prev;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Error reloading albums after Panopticon change:', err);
    }
  }, []);

  // Loading state
  if (appState === 'loading') {
    return (
      <div className="app app-loading">
        <div className="loading-message">Loading...</div>
      </div>
    );
  }

  // Foyer - no library configured
  if (appState === 'foyer') {
    return <Foyer onLibraryReady={handleLibraryReady} />;
  }

  // Main app
  return (
    <div className="app">
      <TopBar
        currentView={currentView}
        onViewChange={handleViewChange}
        nowPlaying={nowPlaying}
        isPlaying={isPlaying}
        progress={progress}
        currentTime={currentTimeFormatted}
        duration={durationFormatted}
        onSeek={seekPercent}
        libraryName={libraryInfo?.name}
        spectrumBands={spectrumBands}
      />

      <div className={`main-content ${currentView === 'PANOPTICON' ? 'panopticon-active' : ''}`}>
        {currentView !== 'PANOPTICON' && <QueueSidebar
          queue={queue}
          queuePosition={queuePosition}
          onQueueChange={(newQueue) => {
            setQueue(newQueue);
            // Reset position if queue was cleared or is now shorter than position
            if (newQueue.length === 0 || queuePosition >= newQueue.length) {
              setQueuePosition(0);
            }
          }}
          onTrackSelect={handleTrackSelect}
          playbackHistory={playbackHistory}
          isPlaying={isPlaying}
          onPlayPause={() => {
            // If nothing is playing but queue has items, play from current position
            if (!nowPlaying && queue.length > 0 && queuePosition < queue.length) {
              const trackToPlay = queue[queuePosition];
              // Play without auto-queuing album (we're playing from the queue)
              loadTrack({
                ...trackToPlay,
                audioPath: trackToPlay.audioPath || trackToPlay.path
              }, true);
            } else {
              togglePlayPause();
            }
          }}
          onStop={stop}
          onSkipNext={skipNext}
          onSkipPrev={handleSkipPrev}
          volume={volume}
          onVolumeChange={setVolume}
          activeProgramId={activeProgramId}
          onEndProgram={() => {
            stop();
            setActiveProgramId(null);
            setActiveProgramName(null);
          }}
          onTrackContextMenu={(e, track, context) => {
            const items = buildTrackContextMenu(track, context);
            showContextMenu(e, items);
          }}
        />}

        {/* View container - drops handled by GridView directly now */}
        <div className="view-container">
          {renderView()}
        </div>

        {currentView !== 'PANOPTICON' && <InspectorSidebar
            track={inspectorTrack}
            currentTrackId={nowPlaying?.id}
            coverCacheBust={coverCacheBust}
            facetsRefreshKey={facetRefreshKey}
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            triggerFacetPicker={triggerFacetPicker}
            triggerAddToMixtape={triggerAddToMixtape}
            onPlayTrack={handlePlayTrack}
            onAddToQueue={handleAddToQueue}
            onOpenSleeve={(track) => {
              setSearchActive(false);
              handleOpenSleeve(track);
            }}
            onViewInPanopticon={async (track) => {
              // Find the Panopticon track ID by matching audio path
              const audioPath = track.audioPath || track.path;
              let trackId = null;

              if (audioPath && ipcRenderer) {
                trackId = await ipcRenderer.invoke('panopticon:find-track-by-path', { audioPath });
              }

              // Clear sleeve/mixtape/search so Panopticon actually shows
              setSearchActive(false);
              setViewingSleeve(null);
              setViewingMixtape(null);

              if (trackId) {
                setPanopticonInitialId(null);
                setPanopticonInitialRecordId(null);
                setPanopticonInitialTrackId(trackId);
                setPanopticonInitialMixtapeId(null);
                setPanopticonInductionPath(null);
                setCurrentView('PANOPTICON');
              } else {
                // Fallback: just open Panopticon without selection
                console.warn('[Panopticon] Could not find track by path:', audioPath);
                setPanopticonInitialId(null);
                setPanopticonInitialRecordId(null);
                setPanopticonInitialTrackId(null);
                setPanopticonInitialMixtapeId(null);
                setPanopticonInductionPath(null);
                setCurrentView('PANOPTICON');
              }
            }}
            onFacetClick={(facetName) => {
              setSearchActive(false);
              setViewingSleeve(null); // Close sleeve view if open
              setCurrentView('FACETS');
              setViewingFacet(facetName);
            }}
            onFacetContextMenu={(e, facet) => {
              const items = buildFacetContextMenu(facet);
              showContextMenu(e, items);
            }}
            onMixtapeSelect={(mixtape) => {
              setSearchActive(false);
              setViewingSleeve(null);
              setViewingFacet(null);
              setCurrentView('MIXTAPES');
              setViewingMixtape(mixtape);
            }}
            onProgramSelect={(programId) => {
              setSearchActive(false);
              setViewingSleeve(null);
              setViewingFacet(null);
              setViewingMixtape(null);
              setViewingProgramId(programId);
              setCurrentView('PROGRAMS');
            }}
            onTrackContextMenu={(e, track, context) => {
              const items = buildTrackContextMenu(track, context);
              showContextMenu(e, items);
            }}
            onAttachmentContextMenu={(e, attachment, extraData) => {
              const items = buildAttachmentContextMenu(attachment, extraData);
              showContextMenu(e, items);
            }}
            // Search props
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchFocus={() => setSearchActive(true)}
            searchInputRef={searchInputRef}
            onTrackUpdate={async (updatedTrack) => {
              // Update selected track immediately for responsive UI
              if (updatedTrack && selectedTrack?.id === updatedTrack.id) {
                setSelectedTrack(prev => ({ ...prev, ...updatedTrack }));
              }
              // Refresh facet views if open
              setFacetRefreshKey(k => k + 1);
              // Reload albums to get updated track data
              try {
                const result = await ipcRenderer.invoke('load-albums');
                if (result.albums) {
                  setAlbums(result.albums);
                  // Update viewingSleeve if open
                  if (viewingSleeve) {
                    const freshAlbum = result.albums.find(a => a.id === viewingSleeve.id);
                    if (freshAlbum) {
                      setViewingSleeve(freshAlbum);
                    }
                  }
                }
              } catch (err) {
                console.error('Error reloading after track update:', err);
              }
            }}
          />}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={hideContextMenu}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="delete-confirm-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {deleteConfirm.type === 'album' ? 'Record' : deleteConfirm.type.charAt(0).toUpperCase() + deleteConfirm.type.slice(1)}?</h3>
            <p>
              {deleteConfirm.type === 'track' && (
                <>Are you sure you want to delete "{deleteConfirm.item.title}"?<br/><span className="delete-hint">This will remove the track from its album and any cassettes. This cannot be undone.</span></>
              )}
              {deleteConfirm.type === 'album' && (
                <>Are you sure you want to delete "{deleteConfirm.item.title || deleteConfirm.item.name}"?<br/><span className="delete-hint">This will delete the record and all its tracks. This cannot be undone.</span></>
              )}
              {deleteConfirm.type === 'attachment' && (
                <>Are you sure you want to delete this attachment?<br/><span className="delete-hint">This cannot be undone.</span></>
              )}
              {deleteConfirm.type === 'mixtape' && (
                <>Are you sure you want to delete "{deleteConfirm.item.name}"?<br/><span className="delete-hint">Tracks will not be affected. This cannot be undone.</span></>
              )}
            </p>
            <div className="delete-confirm-buttons">
              <button
                className="delete-confirm-cancel"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-delete"
                onClick={deleteConfirm.onConfirm}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Induction Eye Animation - ceremonial transition */}
      {showInductionEye && (
        <div className="induction-eye-overlay">
          <div className="induction-eye-container">
            <img
              src={inductionEyeImage}
              alt="The Eye"
              className="induction-eye-image"
            />
          </div>
        </div>
      )}

      {/* Import Modal - v2 fast and dumb */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={handleImportModalClose}
        importPaths={importPaths}
        onImportComplete={handleImportComplete}
      />

    </div>
  );
}

export default App;
