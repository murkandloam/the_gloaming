/**
 * Context Menu Builder Functions
 *
 * These factory functions create context menu builders with the necessary dependencies.
 * Each function returns a useCallback-compatible function that builds menu items.
 */

// Get Electron IPC if available
const { ipcRenderer } = window.require ? window.require('electron') : {};

/**
 * Creates a track context menu builder
 * @param {Object} deps - Dependencies
 * @returns {Function} Menu builder function
 */
export function createTrackContextMenuBuilder(deps) {
  const {
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
  } = deps;

  /**
   * Build context menu items for a track
   * @param {Object} track - Track object
   * @param {string} context - Context: 'queue' | 'history' | 'sleeve' | 'facet' | 'mixtape' | 'ledgers' | 'search' | 'inspector'
   * @param {Object} extraData - Additional context-specific data
   * @returns {Array} Menu items
   */
  return (track, context = 'queue', extraData = {}) => {
    const items = [];

    // Interrupt - clear queue and play this track only
    items.push({
      label: 'Interrupt',
      action: () => {
        const trackWithMeta = {
          ...track,
          queueId: `playing-${Date.now()}`,
          audioPath: track.audioPath || track.path
        };
        // Load track first, then set queue to just this track at position 0
        loadTrack(trackWithMeta, true);
        setQueue([trackWithMeta]);
      }
    });

    // Interject - insert track at current position and play it
    items.push({
      label: 'Interject',
      action: async () => {
        const trackWithMeta = {
          ...track,
          queueId: `interject-${Date.now()}`,
          audioPath: track.audioPath || track.path
        };
        // IMPORTANT: Load track FIRST, then update queue
        // This ensures preload useEffect fires AFTER loadTrack clears preloaded state
        await loadTrack(trackWithMeta, true);
        // Insert track at current position in queue (position stays the same, now points to interjected track)
        setQueue(prev => {
          const newQueue = [...prev];
          newQueue.splice(queuePosition, 0, trackWithMeta);
          return newQueue;
        });
      }
    });

    // Add to Queue
    items.push({
      label: 'Add to Queue',
      action: () => handleAddToQueue(track)
    });

    items.push({ type: 'separator' });

    // Add to Cassette...
    items.push({
      label: 'Add to Cassette...',
      action: () => {
        // Select this track and trigger the add to mixtape modal
        setSelectedTrack(track);
        setInspectorTab('selected');
        setTriggerAddToMixtape(Date.now());
      }
    });

    // Add Facet...
    items.push({
      label: 'Add Facet...',
      action: () => {
        // Select this track and trigger the facet picker
        setSelectedTrack(track);
        setInspectorTab('selected');
        setTriggerFacetPicker(Date.now());
      }
    });

    items.push({ type: 'separator' });

    // Open Record Sleeve (opens vessel's sleeve if subordinate)
    items.push({
      label: 'Open Record Sleeve',
      action: () => {
        if (track.albumId) {
          const album = albums.find(a => a.id === track.albumId);
          if (album) {
            setSearchActive(false);
            setCurrentView('RECORDS');
            // If subordinate, open vessel's sleeve instead
            if (album.eraParent) {
              const vessel = albums.find(a => a.id === album.eraParent);
              if (vessel) {
                setViewingSleeve(vessel);
                return;
              }
            }
            setViewingSleeve(album);
          }
        }
      },
      disabled: !track.albumId
    });

    // View in Panopticon
    items.push({
      label: 'View in Panopticon',
      action: async () => {
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

        setPanopticonInitialId(null);
        setPanopticonInitialRecordId(null);
        setPanopticonInitialTrackId(trackId);
        setPanopticonInitialMixtapeId(null);
        setPanopticonInductionPath(null);
        setCurrentView('PANOPTICON');
      }
    });

    // Copy File Path
    items.push({
      label: 'Copy File Path',
      action: async () => {
        if (track.audioPath) {
          try {
            await navigator.clipboard.writeText(track.audioPath);
          } catch (err) {
            console.error('Failed to copy path:', err);
          }
        }
      }
    });

    // Reveal in Finder
    items.push({
      label: 'Reveal in Finder',
      action: async () => {
        if (track.audioPath && ipcRenderer) {
          await ipcRenderer.invoke('reveal-in-finder', track.audioPath);
        }
      }
    });

    // Context-specific additions
    if (context === 'queue') {
      items.push({ type: 'separator' });
      items.push({
        label: 'Remove from Queue',
        action: () => {
          setQueue(prev => prev.filter(t => t.queueId !== track.queueId));
        }
      });
    }

    if (context === 'mixtape' && extraData.mixtapeId) {
      items.push({ type: 'separator' });
      items.push({
        label: 'Detach from Cassette',
        action: async () => {
          if (ipcRenderer) {
            await ipcRenderer.invoke('remove-track-from-mixtape', {
              trackId: track.id,
              mixtapeId: extraData.mixtapeId
            });
            extraData.onUpdate?.();
          }
        }
      });
    }

    if (context === 'facet' && extraData.facetName) {
      items.push({ type: 'separator' });
      items.push({
        label: `Remove "${extraData.facetName}"`,
        action: async () => {
          if (ipcRenderer) {
            await ipcRenderer.invoke('remove-facet-from-track', {
              trackId: track.id,
              facetName: extraData.facetName
            });
            extraData.onUpdate?.();
          }
        }
      });
    }

    // Ledgers context - toggle inclusion
    if (context === 'ledgers') {
      items.push({ type: 'separator' });
      const isIncluded = track.includeInLedgers !== false;
      items.push({
        label: isIncluded ? 'Exclude from Ledgers' : 'Include in Ledgers',
        action: async () => {
          if (ipcRenderer) {
            await ipcRenderer.invoke('update-track-metadata', {
              trackId: track.id,
              albumId: track.albumId,
              updates: { includeInLedgers: !isIncluded }
            });
            // Refresh ledgers view
            setLibraryRefreshKey(k => k + 1);
          }
        }
      });
    }

    items.push({ type: 'separator' });

    // Delete from Library - danger action
    items.push({
      label: 'Delete from Library',
      danger: true,
      action: () => {
        setDeleteConfirm({
          type: 'track',
          item: track,
          onConfirm: async () => {
            if (ipcRenderer) {
              const result = await ipcRenderer.invoke('delete-track', {
                trackId: track.id,
                albumId: track.albumId
              });
              if (result.success) {
                // Clear selection if this track was selected
                if (selectedTrack?.id === track.id) {
                  setSelectedTrack(null);
                }
                // Remove from queue if present
                setQueue(prevQueue => prevQueue.filter(t => t.id !== track.id));
                // Update sleeve view if viewing the affected album
                if (viewingSleeve?.id === track.albumId) {
                  setViewingSleeve(prev => ({
                    ...prev,
                    tracks: (prev.tracks || []).filter(t => t.id !== track.id)
                  }));
                }
                // Refresh library and trigger view refreshes
                loadLibrary();
                setLibraryRefreshKey(k => k + 1);
                setFacetRefreshKey(k => k + 1);
              } else {
                console.error('Failed to delete track:', result.error);
              }
            }
            setDeleteConfirm(null);
          }
        });
      }
    });

    return items;
  };
}

/**
 * Creates a record (album) context menu builder
 * @param {Object} deps - Dependencies
 * @returns {Function} Menu builder function
 */
export function createRecordContextMenuBuilder(deps) {
  const {
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
  } = deps;

  /**
   * Build context menu items for a record (album)
   * @param {Object} album - Album object
   * @param {string} context - Context: 'grid' | 'sleeve'
   * @returns {Array} Menu items
   */
  return (album, context = 'grid') => {
    const items = [];

    // Play Record - clear queue and play from track 1
    items.push({
      label: 'Play Record',
      action: async () => {
        if (album.tracks && album.tracks.length > 0) {
          const firstTrack = album.tracks[0];
          // Build full queue with all tracks (position-based model)
          const fullQueue = album.tracks.map((t, i) => ({
            queueId: `album-${Date.now()}-${i}`,
            id: t.id,
            title: t.title,
            artist: t.trackArtist || album.artist,
            album: album.title,
            albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: t.audioPath || t.path
          }));
          await loadTrack({
            id: firstTrack.id,
            title: firstTrack.title,
            artist: firstTrack.trackArtist || album.artist,
            album: album.title,
            albumArt: firstTrack.trackThumbnailPath || firstTrack.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: firstTrack.audioPath || firstTrack.path
          }, true);
          setQueue(fullQueue);
        }
      }
    });

    // Interject Record - insert entire album at current position and play first track
    items.push({
      label: 'Interject Record',
      action: async () => {
        if (album.tracks && album.tracks.length > 0) {
          const albumTracks = album.tracks.map((t, i) => ({
            queueId: `interject-album-${Date.now()}-${i}`,
            id: t.id,
            title: t.title,
            artist: t.trackArtist || album.artist,
            album: album.title,
            albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: t.audioPath || t.path
          }));

          // IMPORTANT: Load track FIRST, then update queue
          // This ensures preload useEffect fires AFTER loadTrack clears preloaded state
          await loadTrack(albumTracks[0], true);
          // Insert all album tracks at current position (position stays the same, now points to first album track)
          setQueue(prev => {
            const newQueue = [...prev];
            newQueue.splice(queuePosition, 0, ...albumTracks);
            return newQueue;
          });
        }
      }
    });

    // Add to Queue
    items.push({
      label: 'Add to Queue',
      action: () => {
        if (album.tracks && album.tracks.length > 0) {
          const queueTracks = album.tracks.map((t, i) => ({
            queueId: `album-queue-${Date.now()}-${i}`,
            id: t.id,
            title: t.title,
            artist: t.trackArtist || album.artist,
            album: album.title,
            albumArt: t.trackThumbnailPath || t.trackCoverPath || album.thumbnailPath || album.coverPath,
            albumId: album.id,
            audioPath: t.audioPath || t.path
          }));
          setQueue(prev => [...prev, ...queueTracks]);
        }
      }
    });

    items.push({ type: 'separator' });

    // Open Sleeve - only if from grid (not already in sleeve)
    // If subordinate, open vessel's sleeve instead
    if (context === 'grid') {
      items.push({
        label: 'Open Sleeve',
        action: () => {
          if (album.eraParent) {
            const vessel = albums.find(a => a.id === album.eraParent);
            if (vessel) {
              setViewingSleeve(vessel);
              return;
            }
          }
          setViewingSleeve(album);
        }
      });
    }

    // View in Panopticon
    items.push({
      label: 'View in Panopticon',
      action: () => {
        // Open Panopticon with this record selected
        setPanopticonInitialId(null);
        setPanopticonInitialRecordId(album.id);
        setPanopticonInitialTrackId(null);
        setPanopticonInitialMixtapeId(null);
        setPanopticonInductionPath(null);
        setCurrentView('PANOPTICON');
      }
    });

    // Reveal Record JSON in Finder
    items.push({
      label: 'Reveal Record JSON',
      action: async () => {
        if (ipcRenderer) {
          await ipcRenderer.invoke('reveal-record-json', album.id);
        }
      }
    });

    items.push({ type: 'separator' });

    // Delete from Library - danger action
    items.push({
      label: 'Delete from Library',
      danger: true,
      action: () => {
        setDeleteConfirm({
          type: 'album',
          item: album,
          onConfirm: async () => {
            if (ipcRenderer) {
              const result = await ipcRenderer.invoke('delete-album', { albumId: album.id });
              if (result.success) {
                // Clear selection if this album was selected
                if (selectedAlbum?.id === album.id) {
                  setSelectedAlbum(null);
                }
                if (viewingSleeve?.id === album.id) {
                  setViewingSleeve(null);
                }
                // Clear selected track if it belongs to this album
                if (selectedTrack?.albumId === album.id) {
                  setSelectedTrack(null);
                }
                // Remove any tracks from this album from queue
                setQueue(prevQueue => prevQueue.filter(t => t.albumId !== album.id));
                // Refresh library and trigger view refreshes
                loadLibrary();
                setLibraryRefreshKey(k => k + 1);
                setFacetRefreshKey(k => k + 1);
              } else {
                console.error('Failed to delete album:', result.error);
              }
            }
            setDeleteConfirm(null);
          }
        });
      }
    });

    return items;
  };
}

/**
 * Creates a mixtape context menu builder
 * @param {Object} deps - Dependencies
 * @returns {Function} Menu builder function
 */
export function createMixtapeContextMenuBuilder(deps) {
  const {
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
  } = deps;

  /**
   * Build context menu items for a mixtape
   * @param {Object} mixtape - Mixtape object
   * @returns {Array} Menu items
   */
  return (mixtape) => {
    const items = [];

    // Play Cassette
    items.push({
      label: 'Play Cassette',
      action: async () => {
        if (ipcRenderer) {
          try {
            const result = await ipcRenderer.invoke('get-mixtape-tracks', mixtape.id);
            if (result.tracks && result.tracks.length > 0) {
              const firstTrack = result.tracks[0];
              // Build full queue with all tracks (position-based model)
              const fullQueue = result.tracks.map((t, i) => ({
                queueId: `mixtape-${Date.now()}-${i}`,
                ...t,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              }));
              // Load first track, then set queue and position
              await loadTrack({
                ...firstTrack,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              }, true);
              setQueue(fullQueue);
            }
          } catch (err) {
            console.error('Error playing mixtape:', err);
          }
        }
      }
    });

    // Add to Queue
    items.push({
      label: 'Add to Queue',
      action: async () => {
        if (ipcRenderer) {
          try {
            const result = await ipcRenderer.invoke('get-mixtape-tracks', mixtape.id);
            if (result.tracks && result.tracks.length > 0) {
              const queueTracks = result.tracks.map((t, i) => ({
                queueId: `mixtape-queue-${Date.now()}-${i}`,
                ...t,
                sourceType: 'mixtape',
                sourceId: mixtape.id,
                sourceName: mixtape.name
              }));
              setQueue(prev => [...prev, ...queueTracks]);
            }
          } catch (err) {
            console.error('Error queueing mixtape:', err);
          }
        }
      }
    });

    items.push({ type: 'separator' });

    // Open J-Card
    items.push({
      label: 'Open J-Card',
      action: () => {
        setViewingMixtape(mixtape);
      }
    });

    // View in Panopticon
    items.push({
      label: 'View in Panopticon',
      action: () => {
        setPanopticonInitialId(null);
        setPanopticonInitialRecordId(null);
        setPanopticonInitialTrackId(null);
        setPanopticonInitialMixtapeId(mixtape.id);
        setPanopticonInductionPath(null);
        setCurrentView('PANOPTICON');
      }
    });

    items.push({ type: 'separator' });

    // Delete
    items.push({
      label: 'Delete Cassette',
      danger: true,
      action: () => {
        if (!ipcRenderer) return;
        setDeleteConfirm({
          type: 'mixtape',
          item: mixtape,
          onConfirm: async () => {
            setDeleteConfirm(null);
            try {
              const result = await ipcRenderer.invoke('delete-mixtape', mixtape.id);
              if (result.success) {
                // Clear viewing state if this mixtape was being viewed
                if (viewingMixtape?.id === mixtape.id) {
                  setViewingMixtape(null);
                }
                // Trigger a library reload to refresh the mixtapes view
                loadLibrary();
              }
            } catch (err) {
              console.error('Error deleting mixtape:', err);
            }
          }
        });
      }
    });

    return items;
  };
}

/**
 * Creates a facet context menu builder
 * @param {Object} deps - Dependencies
 * @returns {Function} Menu builder function
 */
export function createFacetContextMenuBuilder(deps) {
  const {
    loadTrack,
    setQueue,
    setViewingFacet
  } = deps;

  /**
   * Build context menu items for a facet
   * @param {Object|string} facet - Facet object or name string
   * @param {Object} extraData - Additional data including onUpdate callback
   * @returns {Array} Menu items
   */
  return (facet, extraData = {}) => {
    const items = [];
    const facetName = typeof facet === 'string' ? facet : facet.name;

    // Play All - play all tracks with this facet
    items.push({
      label: 'Play All',
      action: async () => {
        if (ipcRenderer) {
          try {
            const tracks = await ipcRenderer.invoke('get-tracks-with-facet', facetName);
            if (tracks && tracks.length > 0) {
              const firstTrack = tracks[0];
              // Build full queue (position-based model)
              const fullQueue = tracks.map((t, i) => ({
                queueId: `facet-${Date.now()}-${i}`,
                ...t
              }));
              await loadTrack(firstTrack, true);
              setQueue(fullQueue);
            }
          } catch (err) {
            console.error('Error playing facet:', err);
          }
        }
      }
    });

    // Roam - shuffle and play
    items.push({
      label: 'Roam',
      action: async () => {
        if (ipcRenderer) {
          try {
            const tracks = await ipcRenderer.invoke('get-tracks-with-facet', facetName);
            if (tracks && tracks.length > 0) {
              // Fisher-Yates shuffle
              const shuffled = [...tracks];
              for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              const firstTrack = shuffled[0];
              // Build full queue (position-based model)
              const fullQueue = shuffled.map((t, i) => ({
                queueId: `facet-roam-${Date.now()}-${i}`,
                ...t
              }));
              await loadTrack(firstTrack, true);
              setQueue(fullQueue);
            }
          } catch (err) {
            console.error('Error roaming facet:', err);
          }
        }
      }
    });

    // Add to Queue
    items.push({
      label: 'Add to Queue',
      action: async () => {
        if (ipcRenderer) {
          try {
            const tracks = await ipcRenderer.invoke('get-tracks-with-facet', facetName);
            if (tracks && tracks.length > 0) {
              const queueTracks = tracks.map((t, i) => ({
                queueId: `facet-queue-${Date.now()}-${i}`,
                ...t
              }));
              setQueue(prev => [...prev, ...queueTracks]);
            }
          } catch (err) {
            console.error('Error queueing facet:', err);
          }
        }
      }
    });

    items.push({ type: 'separator' });

    // Browse Facet
    items.push({
      label: 'Browse Facet',
      action: () => {
        setViewingFacet(facetName);
      }
    });

    // Toggle Star
    items.push({
      label: facet.starred ? 'Unstar' : 'Star',
      action: async () => {
        if (ipcRenderer) {
          try {
            await ipcRenderer.invoke('toggle-facet-star', facetName);
            extraData.onUpdate?.();
          } catch (err) {
            console.error('Error toggling facet star:', err);
          }
        }
      }
    });

    // Rename
    items.push({
      label: 'Rename...',
      action: () => {
        // TODO: Show rename modal
        console.log('Rename facet:', facetName);
      }
    });

    items.push({ type: 'separator' });

    // Delete
    items.push({
      label: 'Delete Facet',
      danger: true,
      action: () => {
        // TODO: Show confirmation modal
        console.log('Delete facet:', facetName);
      }
    });

    return items;
  };
}

/**
 * Creates an attachment context menu builder
 * @param {Object} deps - Dependencies
 * @returns {Function} Menu builder function
 */
export function createAttachmentContextMenuBuilder(deps) {
  const {
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
  } = deps;

  /**
   * Build context menu items for an attachment
   * @param {Object} attachment - Attachment object
   * @param {Object} extraData - Additional data including entityType, entityId, onUpdate
   * @returns {Array} Menu items
   */
  return (attachment, extraData = {}) => {
    const items = [];
    const { entityType, entityId, onUpdate } = extraData;

    // Open in Viewer
    items.push({
      label: 'Open',
      action: async () => {
        if (attachment.path && ipcRenderer) {
          await ipcRenderer.invoke('open-file', attachment.path);
        }
      }
    });

    // Reveal in Finder
    items.push({
      label: 'Reveal in Finder',
      action: async () => {
        if (attachment.path && ipcRenderer) {
          await ipcRenderer.invoke('reveal-in-finder', attachment.path);
        }
      }
    });

    // Copy File Path
    items.push({
      label: 'Copy File Path',
      action: async () => {
        if (attachment.path) {
          try {
            await navigator.clipboard.writeText(attachment.path);
          } catch (err) {
            console.error('Failed to copy path:', err);
          }
        }
      }
    });

    items.push({ type: 'separator' });

    // View in Panopticon
    items.push({
      label: 'View in Panopticon...',
      action: () => {
        // Clear sleeve/mixtape/search so Panopticon actually shows
        setSearchActive(false);
        setViewingSleeve(null);
        setViewingMixtape(null);

        // Set the attachment to focus on, clear others
        setPanopticonInitialId(attachment.id);
        setPanopticonInitialRecordId(null);
        setPanopticonInitialTrackId(null);
        setPanopticonInitialMixtapeId(null);
        setPanopticonInductionPath(null);
        setCurrentView('PANOPTICON');
      }
    });

    items.push({ type: 'separator' });

    // Detach from entity
    if (entityType && entityId) {
      items.push({
        label: `Detach from ${entityType === 'album' ? 'Record' : entityType.charAt(0).toUpperCase() + entityType.slice(1)}`,
        action: async () => {
          if (ipcRenderer) {
            const handler = `remove-attachment-from-${entityType}`;
            await ipcRenderer.invoke(handler, {
              [`${entityType}Id`]: entityId,
              attachmentId: attachment.id
            });
            onUpdate?.();
          }
        }
      });
    }

    items.push({ type: 'separator' });

    // Delete from Library
    items.push({
      label: 'Delete from Library',
      danger: true,
      action: () => {
        setDeleteConfirm({
          type: 'attachment',
          item: attachment,
          onConfirm: async () => {
            if (ipcRenderer) {
              const result = await ipcRenderer.invoke('delete-attachment', attachment.id);
              if (result.success) {
                onUpdate?.();
              } else {
                console.error('Failed to delete attachment:', result.error);
                // Could show an error toast - attachment is still in use
              }
            }
            setDeleteConfirm(null);
          }
        });
      }
    });

    return items;
  };
}
