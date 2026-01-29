/**
 * Session IPC Handlers
 *
 * Persistence for playback state, queue, and UI state across app restarts.
 */

module.exports = function registerSessionHandlers({ ipcMain, getLibraryPath, loadSession, saveSession }) {

  // Load session state
  ipcMain.handle('load-session', async () => {
    try {
      const currentLibraryPath = getLibraryPath();
      const session = loadSession(currentLibraryPath);
      return { success: true, session };
    } catch (err) {
      console.error('Error loading session:', err);
      return { success: false, error: err.message };
    }
  });

  // Save session state
  ipcMain.handle('save-session', async (event, sessionData) => {
    try {
      const currentLibraryPath = getLibraryPath();
      const success = saveSession(currentLibraryPath, sessionData);
      return { success };
    } catch (err) {
      console.error('Error saving session:', err);
      return { success: false, error: err.message };
    }
  });

};
