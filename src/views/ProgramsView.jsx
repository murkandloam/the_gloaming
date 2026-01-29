/**
 * ProgramsView - Radio Station Scheduler
 *
 * A Program is a radio station. Modules play in sequence.
 * Rules within a module interleave. That's it.
 */

import React, { useState, useEffect, useCallback } from 'react';
import '../styles/ProgramsView.css';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const SOURCE_TYPES = [
  { value: 'facet', label: 'Facet' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'mixtape', label: 'Cassette' },
  { value: 'any', label: 'Any' }
];

// Editable count input that allows empty field while typing
function RuleCountInput({ value, onChange }) {
  const [localValue, setLocalValue] = useState(String(value || 1));
  const [isFocused, setIsFocused] = useState(false);

  // Sync with external value when not focused
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value || 1));
    }
  }, [value, isFocused]);

  return (
    <input
      type="number"
      className="rule-count"
      min="1"
      max="50"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        const num = parseInt(localValue);
        if (isNaN(num) || num < 1) {
          setLocalValue('1');
          onChange(1);
        } else {
          const clamped = Math.min(50, Math.max(1, num));
          setLocalValue(String(clamped));
          onChange(clamped);
        }
      }}
    />
  );
}

function ProgramsView({ onQueueTracks, initialProgramId, onProgramViewed }) {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [sources, setSources] = useState({ facets: [], artists: [], albums: [], mixtapes: [] });
  const [editingName, setEditingName] = useState(false);
  const [dialog, setDialog] = useState(null);

  // Drag state for rules
  const [draggedRule, setDraggedRule] = useState(null);
  const [dragOverRule, setDragOverRule] = useState(null);

  useEffect(() => {
    loadPrograms();
    loadSources();
  }, []);

  useEffect(() => {
    if (initialProgramId && programs.length > 0 && !loading) {
      const program = programs.find(p => p.id === initialProgramId);
      if (program) {
        setSelectedProgram(program);
        onProgramViewed?.();
      }
    }
  }, [initialProgramId, programs, loading, onProgramViewed]);

  async function loadPrograms() {
    if (!ipcRenderer) return;
    try {
      setLoading(true);
      const result = await ipcRenderer.invoke('get-programs');
      setPrograms(result || []);
    } catch (err) {
      console.error('Error loading programs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSources() {
    if (!ipcRenderer) return;
    try {
      const result = await ipcRenderer.invoke('get-program-sources');
      setSources(result);
    } catch (err) {
      console.error('Error loading sources:', err);
    }
  }

  async function refreshProgram() {
    if (!selectedProgram) return;
    const program = await ipcRenderer.invoke('get-program', selectedProgram.id);
    setSelectedProgram(program);
    loadPrograms();
  }

  async function handleCreateProgram() {
    try {
      const result = await ipcRenderer.invoke('create-program', { name: 'New Program' });
      if (result.success) {
        loadPrograms();
        setSelectedProgram(result.program);
        setEditingName(true);
      }
    } catch (err) {
      console.error('Error creating program:', err);
    }
  }

  function handleDeleteProgram(programId) {
    setDialog({
      type: 'confirm',
      message: 'Delete this program?',
      onConfirm: async () => {
        setDialog(null);
        try {
          await ipcRenderer.invoke('delete-program', programId);
          if (selectedProgram?.id === programId) {
            setSelectedProgram(null);
          }
          loadPrograms();
        } catch (err) {
          console.error('Error deleting program:', err);
        }
      },
      onCancel: () => setDialog(null)
    });
  }

  async function handleUpdateProgram(updates) {
    if (!selectedProgram) return;
    try {
      const result = await ipcRenderer.invoke('update-program', {
        programId: selectedProgram.id,
        updates
      });
      if (result.success) {
        setSelectedProgram(result.program);
        loadPrograms();
      }
    } catch (err) {
      console.error('Error updating program:', err);
    }
  }

  async function handleAddModule() {
    if (!selectedProgram) return;
    try {
      const result = await ipcRenderer.invoke('add-program-module', {
        programId: selectedProgram.id,
        module: { name: 'New Module', rules: [] }
      });
      if (result.success) {
        refreshProgram();
      }
    } catch (err) {
      console.error('Error adding module:', err);
    }
  }

  async function handleUpdateModule(moduleId, updates) {
    if (!selectedProgram) return;
    try {
      await ipcRenderer.invoke('update-program-module', {
        programId: selectedProgram.id,
        moduleId,
        updates
      });
      refreshProgram();
    } catch (err) {
      console.error('Error updating module:', err);
    }
  }

  async function handleDeleteModule(moduleId) {
    if (!selectedProgram) return;
    setDialog({
      type: 'confirm',
      message: 'Delete this module?',
      onConfirm: async () => {
        setDialog(null);
        try {
          await ipcRenderer.invoke('delete-program-module', {
            programId: selectedProgram.id,
            moduleId
          });
          refreshProgram();
        } catch (err) {
          console.error('Error deleting module:', err);
        }
      },
      onCancel: () => setDialog(null)
    });
  }

  async function handleReorderModules(moduleIds) {
    if (!selectedProgram) return;
    try {
      await ipcRenderer.invoke('reorder-program-modules', {
        programId: selectedProgram.id,
        moduleIds
      });
      refreshProgram();
    } catch (err) {
      console.error('Error reordering modules:', err);
    }
  }

  function handleAddRule(moduleId) {
    const module = selectedProgram?.modules?.find(m => m.id === moduleId);
    if (!module) return;

    const newRule = {
      id: crypto.randomUUID(),
      sourceType: 'facet',
      sourceValue: '',
      count: 1
    };

    handleUpdateModule(moduleId, {
      rules: [...(module.rules || []), newRule]
    });
  }

  function handleUpdateRule(moduleId, ruleIndex, updates) {
    const module = selectedProgram?.modules?.find(m => m.id === moduleId);
    if (!module) return;

    const newRules = [...(module.rules || [])];
    newRules[ruleIndex] = { ...newRules[ruleIndex], ...updates };
    handleUpdateModule(moduleId, { rules: newRules });
  }

  function handleDeleteRule(moduleId, ruleIndex) {
    const module = selectedProgram?.modules?.find(m => m.id === moduleId);
    if (!module) return;

    const newRules = module.rules.filter((_, i) => i !== ruleIndex);
    handleUpdateModule(moduleId, { rules: newRules });
  }

  function handleRuleDragStart(e, moduleId, ruleIndex) {
    e.stopPropagation(); // Don't trigger module drag
    setDraggedRule({ moduleId, ruleIndex });
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleRuleDragOver(e, moduleId, ruleIndex) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggedRule && draggedRule.moduleId === moduleId) {
      setDragOverRule({ moduleId, ruleIndex });
    }
  }

  function handleRuleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverRule(null);
    }
  }

  function handleRuleDrop(e, moduleId, targetIndex) {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedRule || draggedRule.moduleId !== moduleId) {
      setDraggedRule(null);
      setDragOverRule(null);
      return;
    }

    // Don't do anything if dropping in the same position
    if (draggedRule.ruleIndex === targetIndex || draggedRule.ruleIndex === targetIndex - 1) {
      setDraggedRule(null);
      setDragOverRule(null);
      return;
    }

    const module = selectedProgram?.modules?.find(m => m.id === moduleId);
    if (!module) return;

    const rules = [...(module.rules || [])];
    const [removed] = rules.splice(draggedRule.ruleIndex, 1);
    const adjustedTarget = draggedRule.ruleIndex < targetIndex ? targetIndex - 1 : targetIndex;
    rules.splice(adjustedTarget, 0, removed);

    handleUpdateModule(moduleId, { rules });
    setDraggedRule(null);
    setDragOverRule(null);
  }

  async function handleRunProgram() {
    if (!selectedProgram) return;
    try {
      const result = await ipcRenderer.invoke('run-program', {
        programId: selectedProgram.id
      });
      if (result.success && result.tracks.length > 0) {
        if (onQueueTracks) {
          onQueueTracks(result.tracks, { id: selectedProgram.id, name: selectedProgram.name });
        }
      } else if (!result.success) {
        setDialog({
          type: 'alert',
          message: 'Cannot run program: ' + result.error,
          onConfirm: () => setDialog(null)
        });
      } else {
        setDialog({
          type: 'alert',
          message: 'Program generated no tracks. Add some rules!',
          onConfirm: () => setDialog(null)
        });
      }
    } catch (err) {
      console.error('Error running program:', err);
    }
  }

  function getSourceOptions(sourceType) {
    switch (sourceType) {
      case 'facet':
        return sources.facets.map(f => ({ value: f.value, label: `${f.label} (${f.count})` }));
      case 'artist':
        return sources.artists;
      case 'album':
        return sources.albums.map(a => ({ value: a.value, label: `${a.label} - ${a.artist}` }));
      case 'mixtape':
        return sources.mixtapes.map(m => ({ value: m.value, label: `${m.label} (${m.trackCount})` }));
      default:
        return [];
    }
  }

  // Module drag and drop
  const [draggedModule, setDraggedModule] = useState(null);
  const [dragOverModuleIndex, setDragOverModuleIndex] = useState(null);

  function handleModuleDragStart(e, moduleIndex) {
    setDraggedModule(moduleIndex);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleModuleDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedModule !== null) {
      setDragOverModuleIndex(index);
    }
  }

  function handleModuleDragLeave(e) {
    // Only clear if we're leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverModuleIndex(null);
    }
  }

  function handleModuleDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();

    if (draggedModule === null || !selectedProgram) {
      setDraggedModule(null);
      setDragOverModuleIndex(null);
      return;
    }

    // Don't do anything if dropping in the same position
    if (draggedModule === targetIndex || draggedModule === targetIndex - 1) {
      setDraggedModule(null);
      setDragOverModuleIndex(null);
      return;
    }

    const modules = [...selectedProgram.modules];
    const [removed] = modules.splice(draggedModule, 1);
    // Adjust target if we removed from before the target
    const adjustedTarget = draggedModule < targetIndex ? targetIndex - 1 : targetIndex;
    modules.splice(adjustedTarget, 0, removed);

    handleReorderModules(modules.map(m => m.id));
    setDraggedModule(null);
    setDragOverModuleIndex(null);
  }

  if (loading) {
    return (
      <div className="programs-view">
        <div className="programs-loading">Loading programs...</div>
      </div>
    );
  }

  return (
    <div className="programs-view programs-view-v2">
      {/* Sidebar Panel (1/4) */}
      <div className="programs-sidebar-panel">
        <div className="programs-list">
          {programs.map(program => (
            <div
              key={program.id}
              className={`program-sidebar-item ${selectedProgram?.id === program.id ? 'selected' : ''}`}
              onClick={() => setSelectedProgram(program)}
            >
              <span className="program-bullet">{selectedProgram?.id === program.id ? '\u25cf' : ''}</span>
              <span className="program-sidebar-name">{program.name}</span>
              <button
                className="program-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteProgram(program.id);
                }}
                title="Delete program"
              >
                x
              </button>
            </div>
          ))}

          <button
            className="new-program-btn"
            onClick={handleCreateProgram}
          >
            + New Program
          </button>
        </div>
      </div>

      {/* Editor Panel (3/4) */}
      <div className="programs-editor-panel">
        {!selectedProgram ? (
          <div className="programs-editor-empty">
            <div className="programs-icon">~</div>
            <p className="programs-tagline"><span className="accent">Modules</span> progress sequentially.</p>
            <p className="programs-tagline"><span className="accent">Rules</span> are interwoven within modules.</p>
            <p className="programs-tagline">Enjoy yourself.</p>
          </div>
        ) : (
          <>
            {/* Program Header */}
            <div className="program-editor-header">
              <input
                type="text"
                className="program-name-input program-name-large"
                value={selectedProgram.name}
                onChange={(e) => handleUpdateProgram({ name: e.target.value })}
                onFocus={() => setEditingName(true)}
                onBlur={() => setEditingName(false)}
                placeholder="Program Name"
                autoFocus={editingName}
              />
              <button
                className="program-play-btn"
                onClick={handleRunProgram}
                title="Start Program"
              >
                <span className="play-icon"></span>
              </button>
            </div>

            {/* Modules */}
            <div className="program-modules">
              {selectedProgram.modules?.map((module, moduleIndex) => (
                <React.Fragment key={module.id}>
                  {/* Drop zone before module */}
                  <div
                    className={`module-drop-zone ${dragOverModuleIndex === moduleIndex ? 'active' : ''}`}
                    onDragOver={(e) => handleModuleDragOver(e, moduleIndex)}
                    onDragLeave={handleModuleDragLeave}
                    onDrop={(e) => handleModuleDrop(e, moduleIndex)}
                  />

                  <div
                    className={`program-module-card ${draggedModule === moduleIndex ? 'dragging' : ''}`}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    {/* Module Header */}
                    <div className="module-card-header">
                      <span
                        className="module-grip"
                        draggable
                        onDragStart={(e) => handleModuleDragStart(e, moduleIndex)}
                        onDragEnd={() => { setDraggedModule(null); setDragOverModuleIndex(null); }}
                      ></span>
                      <span className="module-label">MODULE {moduleIndex + 1}</span>
                      <input
                        type="text"
                        className="module-name-edit"
                        value={module.name || ''}
                        onChange={(e) => handleUpdateModule(module.id, { name: e.target.value })}
                        placeholder="Module name"
                      />
                      <button
                        className="module-delete-x"
                        onClick={() => handleDeleteModule(module.id)}
                        title="Delete module"
                      >
                        x
                      </button>
                    </div>

                    {/* Rules */}
                    <div className="module-rules-list">
                      {(module.rules || []).map((rule, ruleIndex) => (
                        <React.Fragment key={rule.id || ruleIndex}>
                          {/* Drop zone before rule */}
                          <div
                            className={`rule-drop-zone ${dragOverRule?.moduleId === module.id && dragOverRule?.ruleIndex === ruleIndex ? 'active' : ''}`}
                            onDragOver={(e) => handleRuleDragOver(e, module.id, ruleIndex)}
                            onDragLeave={handleRuleDragLeave}
                            onDrop={(e) => handleRuleDrop(e, module.id, ruleIndex)}
                          />
                          <div
                            className={`rule-row ${draggedRule?.moduleId === module.id && draggedRule?.ruleIndex === ruleIndex ? 'dragging' : ''}`}
                            onDragOver={(e) => e.preventDefault()}
                          >
                            <span
                              className="rule-grip"
                              draggable
                              onDragStart={(e) => handleRuleDragStart(e, module.id, ruleIndex)}
                              onDragEnd={() => { setDraggedRule(null); setDragOverRule(null); }}
                            ></span>

                            <select
                              className="rule-source-type"
                              value={rule.sourceType}
                              onChange={(e) => handleUpdateRule(module.id, ruleIndex, {
                                sourceType: e.target.value,
                                sourceValue: e.target.value === 'any' ? null : ''
                              })}
                            >
                              {SOURCE_TYPES.map(st => (
                                <option key={st.value} value={st.value}>{st.label}</option>
                              ))}
                            </select>

                            {rule.sourceType !== 'any' && (
                              <select
                                className="rule-source-value"
                                value={rule.sourceValue || ''}
                                onChange={(e) => handleUpdateRule(module.id, ruleIndex, { sourceValue: e.target.value })}
                              >
                                <option value="">Select...</option>
                                {getSourceOptions(rule.sourceType).map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            )}

                            <RuleCountInput
                              value={rule.count}
                              onChange={(count) => handleUpdateRule(module.id, ruleIndex, { count })}
                            />

                            <button
                              className="rule-delete-btn"
                              onClick={() => handleDeleteRule(module.id, ruleIndex)}
                            >
                              x
                            </button>
                          </div>
                        </React.Fragment>
                      ))}

                      {/* Drop zone after last rule */}
                      {(module.rules || []).length > 0 && (
                        <div
                          className={`rule-drop-zone ${dragOverRule?.moduleId === module.id && dragOverRule?.ruleIndex === module.rules.length ? 'active' : ''}`}
                          onDragOver={(e) => handleRuleDragOver(e, module.id, module.rules.length)}
                          onDragLeave={handleRuleDragLeave}
                          onDrop={(e) => handleRuleDrop(e, module.id, module.rules.length)}
                        />
                      )}

                      {/* Add Rule */}
                      <button
                        className="add-rule-btn"
                        onClick={() => handleAddRule(module.id)}
                      >
                        + Rule
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              ))}

              {/* Drop zone after last module */}
              {selectedProgram.modules?.length > 0 && (
                <div
                  className={`module-drop-zone ${dragOverModuleIndex === selectedProgram.modules.length ? 'active' : ''}`}
                  onDragOver={(e) => handleModuleDragOver(e, selectedProgram.modules.length)}
                  onDragLeave={handleModuleDragLeave}
                  onDrop={(e) => handleModuleDrop(e, selectedProgram.modules.length)}
                />
              )}

              {/* Add Module */}
              <button className="add-module-btn" onClick={handleAddModule}>
                + Module
              </button>
            </div>
          </>
        )}
      </div>

      {/* Dialog */}
      {dialog && (
        <div className="modal-overlay" onClick={dialog.onCancel || dialog.onConfirm}>
          <div className="modal-content dialog-modal" onClick={e => e.stopPropagation()}>
            <div className="dialog-body">
              <p className="dialog-message">{dialog.message}</p>
            </div>
            <div className="dialog-footer">
              {dialog.type === 'confirm' && (
                <button className="modal-btn modal-btn-secondary" onClick={dialog.onCancel}>
                  Cancel
                </button>
              )}
              <button className="modal-btn modal-btn-primary" onClick={dialog.onConfirm} autoFocus>
                {dialog.type === 'confirm' ? 'Delete' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProgramsView;
