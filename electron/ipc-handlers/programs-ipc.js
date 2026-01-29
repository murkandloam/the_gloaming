/**
 * Programs IPC Handlers
 *
 * Radio station scheduling - modules play in sequence, rules interleave.
 */

module.exports = function registerProgramsHandlers({ ipcMain, programs }) {

  ipcMain.handle('get-programs', async () => {
    try {
      return programs.getAllPrograms();
    } catch (err) {
      console.error('Error getting programs:', err);
      return [];
    }
  });

  ipcMain.handle('get-all-programs', async () => {
    try {
      return programs.getAllPrograms();
    } catch (err) {
      console.error('Error getting all programs:', err);
      return [];
    }
  });

  ipcMain.handle('get-program', async (event, programId) => {
    try {
      return programs.getProgram(programId);
    } catch (err) {
      console.error('Error getting program:', err);
      return null;
    }
  });

  ipcMain.handle('create-program', async (event, { name }) => {
    try {
      const program = programs.createProgram(name);
      return { success: true, program };
    } catch (err) {
      console.error('Error creating program:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('update-program', async (event, { programId, updates }) => {
    try {
      const program = programs.updateProgram(programId, updates);
      if (!program) {
        return { success: false, error: 'Program not found' };
      }
      return { success: true, program };
    } catch (err) {
      console.error('Error updating program:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-program', async (event, programId) => {
    try {
      const success = programs.deleteProgram(programId);
      return { success };
    } catch (err) {
      console.error('Error deleting program:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('add-program-module', async (event, { programId, module }) => {
    try {
      const newModule = programs.addModule(programId, module);
      if (!newModule) {
        return { success: false, error: 'Program not found' };
      }
      return { success: true, module: newModule };
    } catch (err) {
      console.error('Error adding module:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('update-program-module', async (event, { programId, moduleId, updates }) => {
    try {
      const module = programs.updateModule(programId, moduleId, updates);
      if (!module) {
        return { success: false, error: 'Module not found' };
      }
      return { success: true, module };
    } catch (err) {
      console.error('Error updating module:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-program-module', async (event, { programId, moduleId }) => {
    try {
      const success = programs.deleteModule(programId, moduleId);
      return { success };
    } catch (err) {
      console.error('Error deleting module:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('reorder-program-modules', async (event, { programId, moduleIds }) => {
    try {
      const success = programs.reorderModules(programId, moduleIds);
      return { success };
    } catch (err) {
      console.error('Error reordering modules:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('validate-program', async (event, programId) => {
    try {
      return programs.validateProgram(programId);
    } catch (err) {
      console.error('Error validating program:', err);
      return { valid: false, errors: [err.message], warnings: [] };
    }
  });

  ipcMain.handle('run-program', async (event, { programId }) => {
    try {
      return programs.generateProgramRun(programId);
    } catch (err) {
      console.error('Error running program:', err);
      return { success: false, error: err.message, tracks: [] };
    }
  });

  ipcMain.handle('get-program-sources', async () => {
    try {
      return programs.getAvailableSources();
    } catch (err) {
      console.error('Error getting program sources:', err);
      return { facets: [], artists: [], albums: [], mixtapes: [] };
    }
  });

};
