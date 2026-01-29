/**
 * Audio IPC Handlers
 *
 * Bridges between renderer process and the Swift audio service.
 * Forwards commands from renderer to audio-bridge, and events back to renderer.
 */

module.exports = function registerAudioHandlers({ ipcMain, audioBridge, getMainWindow }) {

  // ============================================
  // Forward events from Swift to renderer
  // ============================================

  const forwardEvent = (eventName) => {
    audioBridge.on(eventName, (data) => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`audio:${eventName}`, data);
      }
    });
  };

  // Forward all audio events
  forwardEvent('ready');
  forwardEvent('loaded');
  forwardEvent('preloaded');
  forwardEvent('state');
  forwardEvent('trackEnded');
  forwardEvent('trackChanged');
  forwardEvent('error');
  forwardEvent('closed');
  forwardEvent('spectrum');  // FFT visualizer data

  // ============================================
  // IPC Handlers (renderer → main → Swift)
  // ============================================

  /**
   * Load a track
   * @param {Object} param - { id: string, audioPath: string }
   */
  ipcMain.handle('audio:load', async (event, { id, audioPath }) => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.load(id, audioPath);
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] load error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Preload next track for gapless playback
   * @param {Object} param - { id: string, audioPath: string }
   */
  ipcMain.handle('audio:preload', async (event, { id, audioPath }) => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.preload(id, audioPath);
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] preload error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Start/resume playback
   */
  ipcMain.handle('audio:play', async () => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.play();
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] play error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Pause playback
   */
  ipcMain.handle('audio:pause', async () => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.pause();
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] pause error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Stop playback and clear state
   */
  ipcMain.handle('audio:stop', async () => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.stop();
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] stop error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Seek to position
   * @param {number} position - Position in seconds
   */
  ipcMain.handle('audio:seek', async (event, position) => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.seek(position);
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] seek error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set volume
   * @param {number} level - Volume level (0.0 to 1.0)
   */
  ipcMain.handle('audio:volume', async (event, level) => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.setVolume(level);
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] volume error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Skip to next preloaded track
   */
  ipcMain.handle('audio:playNext', async () => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.playNext();
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] playNext error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set visualizer lookahead for sync adjustment
   * @param {number} seconds - Lookahead in seconds (0-0.5)
   */
  ipcMain.handle('audio:setLookahead', async (event, seconds) => {
    try {
      if (!audioBridge.isReady()) {
        return { success: false, error: 'Audio service not ready' };
      }
      audioBridge.setLookahead(seconds);
      return { success: true };
    } catch (err) {
      console.error('[audio-ipc] setLookahead error:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Check if audio service is ready
   */
  ipcMain.handle('audio:isReady', async () => {
    return { ready: audioBridge.isReady() };
  });

  console.log('[audio-ipc] Handlers registered');
};
