import React, { useMemo, useState, useCallback, useEffect } from 'react';
import ViewOptionsBar from '../components/ViewOptionsBar';
import RecordFilterBar from '../components/RecordFilterBar';
import eyecentre from '../assets/panopticon/eyecentre.png';
import '../styles/GridView.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// Default SOME filter settings
const DEFAULT_SOME_FILTERS = {
  LPs: true,
  EPs: true,
  Singles: true,
  Soundtracks: true,
  Compilations: true,
  Concerts: false,
  ComposerWorks: false,
  Miscellanea: false,
  Reissues: false,
  Invisible: false  // Records with showOnGrid: false
};

function GridView({
  albums = [],
  loading,
  error,
  coverCacheBust = 0,
  showAlbumLabels = false,
  onAlbumSelect,
  onTrackSelect,
  onRoamGroup,
  viewState,
  onViewStateChange,
  onAlbumContextMenu,
  onInductFolder // callback to open Panopticon in induction mode
}) {
  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // Album listening stats for Listen Time sorting
  const [albumListenStats, setAlbumListenStats] = useState({});

  // Use external state if provided (for persistence across tab switches)
  // Filter bar state
  const filterMode = viewState?.filterMode ?? 'all';
  const someFilters = viewState?.someFilters ?? DEFAULT_SOME_FILTERS;

  // Sort/display state
  const separatorsEnabled = viewState?.separatorsEnabled ?? false;
  const separatorField = viewState?.separatorField ?? 'artist';
  const separatorDirection = viewState?.separatorDirection ?? 'asc';
  const sortPills = viewState?.sortPills ?? [{ field: 'artist', direction: 'asc' }];
  const gridSize = viewState?.gridSize ?? 180;
  const distinguishFilters = viewState?.distinguishFilters ?? {
    Soundtrack: false,
    Compilation: false,
    Concert: false,
    ComposerWork: false,
    Miscellanea: false,
    Reissue: false,
  };
  const honourThe = viewState?.honourThe ?? false;

  // State updaters that work with external state
  const setFilterMode = (value) => onViewStateChange?.(prev => ({ ...prev, filterMode: value }));
  const setSomeFilters = (value) => onViewStateChange?.(prev => ({
    ...prev,
    someFilters: typeof value === 'function' ? value(prev.someFilters ?? DEFAULT_SOME_FILTERS) : value
  }));
  const setSeparatorsEnabled = (value) => onViewStateChange?.(prev => ({ ...prev, separatorsEnabled: value }));
  const setSeparatorField = (value) => onViewStateChange?.(prev => ({ ...prev, separatorField: value }));
  const setSeparatorDirection = (value) => onViewStateChange?.(prev => ({ ...prev, separatorDirection: value }));
  const setSortPills = (value) => onViewStateChange?.(prev => ({
    ...prev,
    sortPills: typeof value === 'function' ? value(prev.sortPills) : value
  }));
  const setGridSize = (value) => onViewStateChange?.(prev => ({ ...prev, gridSize: value }));
  const setDistinguishFilters = (value) => onViewStateChange?.(prev => ({ ...prev, distinguishFilters: value }));
  const setHonourThe = (value) => onViewStateChange?.(prev => ({ ...prev, honourThe: value }));

  // Check if we need listen time stats for sorting
  const needsListenStats = sortPills.some(p => p.field === 'listenTime');

  // Fetch album listening stats when needed
  useEffect(() => {
    if (!needsListenStats || albums.length === 0 || !ipcRenderer) return;

    const albumIds = albums.map(a => a.id);
    ipcRenderer.invoke('get-albums-listening-stats', albumIds)
      .then(stats => {
        setAlbumListenStats(stats || {});
      })
      .catch(err => {
        console.error('[GridView] Error fetching album listen stats:', err);
        setAlbumListenStats({});
      });
  }, [albums, needsListenStats]);

  // Drag and drop handlers for folder induction
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && items[0].kind === 'file') {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    console.log('[GridView] Drop received, files:', files.length, 'onInductFolder:', !!onInductFolder);
    if (files.length === 0 || !onInductFolder) return;

    try {
      // Collect all valid paths (folders and audio files)
      const folderPaths = [];
      const filePaths = [];

      for (const file of files) {
        const stats = await ipcRenderer.invoke('fs:stat', file.path);
        if (stats?.isDirectory) {
          folderPaths.push(file.path);
        } else if (stats?.isFile) {
          // Check if it's an audio file
          const ext = file.name.toLowerCase().split('.').pop();
          const audioExts = ['m4a', 'flac', 'mp3', 'wav', 'aiff', 'aac', 'ogg', 'wma'];
          if (audioExts.includes(ext)) {
            filePaths.push(file.path);
          }
        }
      }

      console.log('[GridView] Folders:', folderPaths.length, 'Audio files:', filePaths.length);

      // Pass both folders and files to the induction handler
      if (folderPaths.length > 0 || filePaths.length > 0) {
        onInductFolder({ folders: folderPaths, files: filePaths });
      }
    } catch (err) {
      console.error('Drop handling error:', err);
    }
  }, [onInductFolder]);

  // Filter, sort, and group albums
  const { displayAlbums, groupedAlbums } = useMemo(() => {
    let filtered = [...albums];

    // Filter out records with showOnGrid: false (hidden records)
    // These only appear when "Invisible" is checked in the "Some" filter
    if (!someFilters.Invisible) {
      filtered = filtered.filter(album => album.showOnGrid !== false);
    }

    // Apply filter based on filterMode
    if (filterMode === 'all') {
      // Show everything (except hidden records, handled above)
    } else if (filterMode === 'some') {
      // Show records matching checked filters in someFilters (AND logic)
      // Album must: 1) match an enabled format, AND 2) not have any disabled characteristics
      filtered = filtered.filter(album => {
        const format = album.format || 'LP';
        const characteristics = album.characteristics || [];

        // First check: format must be enabled
        const formatEnabled = (
          (format === 'LP' && someFilters.LPs) ||
          (format === 'EP' && someFilters.EPs) ||
          (format === 'Single' && someFilters.Singles)
        );
        if (!formatEnabled) return false;

        // Second check: if album has a characteristic, that characteristic must be enabled
        if (characteristics.includes('Soundtrack') && !someFilters.Soundtracks) return false;
        if (characteristics.includes('Compilation') && !someFilters.Compilations) return false;
        if (characteristics.includes('Concert') && !someFilters.Concerts) return false;
        if (characteristics.includes('ComposerWork') && !someFilters.ComposerWorks) return false;
        if (characteristics.includes('Miscellanea') && !someFilters.Miscellanea) return false;
        if (characteristics.includes('Reissue') && !someFilters.Reissues) return false;

        return true;
      });
    } else if (filterMode === 'lps') {
      filtered = filtered.filter(a => (a.format || 'LP') === 'LP');
    } else if (filterMode === 'eps') {
      filtered = filtered.filter(a => a.format === 'EP');
    } else if (filterMode === 'singles') {
      filtered = filtered.filter(a => a.format === 'Single');
    } else if (filterMode === 'soundtracks') {
      filtered = filtered.filter(a => (a.characteristics || []).includes('Soundtrack'));
    } else if (filterMode === 'compilations') {
      filtered = filtered.filter(a => (a.characteristics || []).includes('Compilation'));
    } else if (filterMode === 'invisible') {
      // Show ONLY invisible records (those with showOnGrid: false)
      filtered = filtered.filter(a => a.showOnGrid === false);
    }

    // Sort
    if (sortPills.length > 0) {
      filtered.sort((a, b) => {
        for (const pill of sortPills) {
          let aVal = a[pill.field];
          let bVal = b[pill.field];

          // Handle special fields
          if (pill.field === 'releaseDate') {
            // Parse releaseDate - could be "YYYY", "DD-MM-YYYY", or "YYYY-MM-DD"
            const parseYear = (val) => {
              if (!val) return 9999;
              const str = String(val);
              // Check for DD-MM-YYYY format
              if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
                return parseInt(str.slice(-4), 10);
              }
              // Check for YYYY-MM-DD format
              if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                return parseInt(str.slice(0, 4), 10);
              }
              // Assume it's just a year or extract first 4 digits
              const match = str.match(/\d{4}/);
              return match ? parseInt(match[0], 10) : 9999;
            };
            aVal = parseYear(aVal);
            bVal = parseYear(bVal);
          } else if (pill.field === 'dateAdded') {
            aVal = a.createdAt || '';
            bVal = b.createdAt || '';
          } else if (pill.field === 'title') {
            aVal = a.sortName || a.sortTitle || a.title || '';
            bVal = b.sortName || b.sortTitle || b.title || '';
            // Strip leading "The " unless honourThe is enabled
            if (!honourThe) {
              aVal = aVal.replace(/^the\s+/i, '');
              bVal = bVal.replace(/^the\s+/i, '');
            }
          } else if (pill.field === 'artist') {
            aVal = a.sortArtist || a.artist || '';
            bVal = b.sortArtist || b.artist || '';
            // Strip leading "The " unless honourThe is enabled
            if (!honourThe) {
              aVal = aVal.replace(/^the\s+/i, '');
              bVal = bVal.replace(/^the\s+/i, '');
            }
          } else if (pill.field === 'listenTime') {
            // Use listening stats from ledgers
            aVal = albumListenStats[a.id]?.total_seconds || 0;
            bVal = albumListenStats[b.id]?.total_seconds || 0;
          }

          // Normalize for comparison
          if (typeof aVal === 'string') aVal = aVal.toLowerCase();
          if (typeof bVal === 'string') bVal = bVal.toLowerCase();

          if (aVal < bVal) return pill.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return pill.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    // Group by separator field if enabled
    let grouped = null;
    if (separatorsEnabled) {
      grouped = {};
      filtered.forEach(album => {
        let key;
        switch (separatorField) {
          case 'releaseDate':
            key = album.releaseDate?.slice(0, 4) || 'Unknown Year';
            break;
          case 'decade':
            const year = album.releaseDate?.slice(0, 4);
            if (year && !isNaN(year)) {
              const decadeStart = Math.floor(parseInt(year) / 10) * 10;
              key = `${decadeStart}s`;
            } else {
              key = 'Unknown Decade';
            }
            break;
          case 'genre':
            key = album.genre || 'Unknown Genre';
            break;
          case 'artist':
          default:
            key = album.sortArtist || album.artist || 'Unknown Artist';
            // Strip leading "The " unless honourThe is enabled
            if (!honourThe) {
              key = key.replace(/^the\s+/i, '');
            }
        }
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(album);
      });
    }

    // Apply "Distinguish" filters - separate albums with these characteristics at the end
    const activeDistinguish = Object.entries(distinguishFilters)
      .filter(([_, enabled]) => enabled)
      .map(([id]) => id);

    const characteristicLabels = {
      Soundtrack: 'Soundtracks',
      Compilation: 'Compilations',
      Concert: 'Concerts',
      ComposerWork: 'Composer Works',
      Miscellanea: 'Miscellanea',
      Reissue: 'Reissues',
    };

    if (activeDistinguish.length > 0) {
      // Separate distinguished albums from regular albums
      const regularAlbums = [];
      const distinguishedGroups = {};

      // Initialize groups for each active distinguish filter
      activeDistinguish.forEach(characteristic => {
        distinguishedGroups[characteristic] = [];
      });

      filtered.forEach(album => {
        const characteristics = album.characteristics || [];
        // Find first matching distinguish characteristic
        const matchedCharacteristic = activeDistinguish.find(c => characteristics.includes(c));

        if (matchedCharacteristic) {
          distinguishedGroups[matchedCharacteristic].push(album);
        } else {
          regularAlbums.push(album);
        }
      });

      // If separators enabled, modify existing groups
      if (separatorsEnabled && grouped) {
        // Filter grouped to only include regular albums, then add distinguished groups
        const filteredGrouped = {};
        Object.entries(grouped).forEach(([key, albums]) => {
          const regularInGroup = albums.filter(a => {
            const chars = a.characteristics || [];
            return !activeDistinguish.some(c => chars.includes(c));
          });
          if (regularInGroup.length > 0) {
            filteredGrouped[key] = regularInGroup;
          }
        });

        // Add distinguished groups with special keys (prefixed for sorting at end)
        activeDistinguish.forEach(characteristic => {
          if (distinguishedGroups[characteristic].length > 0) {
            filteredGrouped[`zzz_${characteristicLabels[characteristic] || characteristic}`] = distinguishedGroups[characteristic];
          }
        });

        grouped = filteredGrouped;
      } else if (!separatorsEnabled) {
        // Create grouped view just for distinguish, even without separators
        grouped = {};

        // Add regular albums as one group (no header shown)
        if (regularAlbums.length > 0) {
          grouped[''] = regularAlbums;
        }

        // Add distinguished groups
        activeDistinguish.forEach(characteristic => {
          if (distinguishedGroups[characteristic].length > 0) {
            grouped[`zzz_${characteristicLabels[characteristic] || characteristic}`] = distinguishedGroups[characteristic];
          }
        });
      }

      // Update displayAlbums to put distinguished at the end
      const distinguishedFlat = activeDistinguish.flatMap(c => distinguishedGroups[c]);
      filtered = [...regularAlbums, ...distinguishedFlat];
    }

    return { displayAlbums: filtered, groupedAlbums: grouped };
  }, [albums, filterMode, someFilters, sortPills, separatorsEnabled, separatorField, distinguishFilters, albumListenStats]);

  const handleAlbumClick = (album) => {
    console.log('Album clicked:', album);
    if (onAlbumSelect) {
      onAlbumSelect(album);
    }
  };

  // CSS variable for grid size
  const gridStyle = {
    '--album-size': `${gridSize}px`
  };

  // Determine what content to render
  const renderContent = () => {
    if (loading) {
      return (
        <div className="grid-loading">
          <span>Scanning library...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="grid-error">
          <span>Error: {error}</span>
        </div>
      );
    }

    if (albums.length === 0) {
      return (
        <div className="grid-empty">
          <img src={eyecentre} alt="The Eye awaits" className="grid-empty-eye" />
          <span className="grid-empty-title">Your shelf is empty.</span>
          <span className="grid-empty-hint">Drag folders or tracks here to import.</span>
        </div>
      );
    }

    return (
      <>
        <RecordFilterBar
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          someFilters={someFilters}
          onSomeFiltersChange={setSomeFilters}
        />

        <div className="grid-content">
          {groupedAlbums && Object.keys(groupedAlbums).length > 0 ? (
            renderGrouped()
          ) : (
            <div className="album-grid" style={gridStyle}>
              {displayAlbums.map(album => renderAlbumCard(album))}
            </div>
          )}
        </div>

        <ViewOptionsBar
          separatorsEnabled={separatorsEnabled}
          onSeparatorsEnabledChange={setSeparatorsEnabled}
          separatorField={separatorField}
          onSeparatorFieldChange={setSeparatorField}
          separatorDirection={separatorDirection}
          onSeparatorDirectionChange={setSeparatorDirection}
          distinguishFilters={distinguishFilters}
          onDistinguishFiltersChange={setDistinguishFilters}
          sortPills={sortPills}
          onSortPillsChange={setSortPills}
          honourThe={honourThe}
          onHonourTheChange={setHonourThe}
          gridSize={gridSize}
          onGridSizeChange={setGridSize}
        />
      </>
    );
  };

  // Render grouped view
  const renderGrouped = () => {
    // Use first sort pill's direction for group ordering
    const groupDirection = sortPills[0]?.direction ?? 'asc';
    const keys = Object.keys(groupedAlbums).sort((a, b) => {
      const cmp = a.localeCompare(b, undefined, { numeric: true });
      return groupDirection === 'asc' ? cmp : -cmp;
    });

    return keys.map(key => {
      // Handle special "distinguish" groups (prefixed with zzz_ to sort at end)
      const displayKey = key.startsWith('zzz_') ? key.slice(4) : key;
      const isDistinguished = key.startsWith('zzz_');
      const isEmptyKey = key === '';

      return (
        <div key={key || '__regular__'} className={`album-group ${isDistinguished ? 'distinguished' : ''}`}>
          {/* Only show header if there's a key to display */}
          {!isEmptyKey && (
            <div className="album-group-header">
              <span className="album-group-title">{displayKey}</span>
              <span className="album-group-count">{groupedAlbums[key].length}</span>
              {onRoamGroup && (
                <button
                  className="album-group-roam"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRoamGroup(groupedAlbums[key], displayKey, separatorField);
                  }}
                  title={`Roam ${displayKey}`}
                >
                  ↻
                </button>
              )}
            </div>
          )}
          <div className="album-grid" style={gridStyle}>
            {groupedAlbums[key].map(album => renderAlbumCard(album))}
          </div>
        </div>
      );
    });
  };

  // Render single album card
  const renderAlbumCard = (album) => (
    <div
      key={album.id}
      className="album-card"
      onClick={() => handleAlbumClick(album)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onAlbumContextMenu) {
          onAlbumContextMenu(e, album);
        }
      }}
      title={`${album.title} · ${album.artist}`}
    >
      <div className="album-cover">
        {(album.thumbnailPath || album.coverPath) ? (
          <img
            src={`local://${album.thumbnailPath || album.coverPath}?v=${coverCacheBust}`}
            alt={album.title}
            className="album-cover-image"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className="album-cover-placeholder"
          style={{ display: (album.thumbnailPath || album.coverPath) ? 'none' : 'flex' }}
        >
          ♪
        </div>
        {showAlbumLabels && (
          <div className="album-label">
            <span className="album-label-title">{album.title}</span>
            <span className="album-label-artist">{album.artist}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="grid-view"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop Zone Overlay */}
      {isDragOver && (
        <div className="grid-dropzone">
          <div className="grid-dropzone-content">
            <img src={eyecentre} alt="The Eye watches" className="grid-dropzone-eye" />
            <span className="grid-dropzone-text">Drop folder to induct</span>
          </div>
        </div>
      )}

      {renderContent()}
    </div>
  );
}

export default GridView;
