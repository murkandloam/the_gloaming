/**
 * FacetsView - Sidebar layout with drag-drop organization
 *
 * Left sidebar shows groups (reorderable). Drop facets onto groups to move them.
 * Main area shows all facets in a flow layout.
 */

import React, { useState, useEffect } from 'react';
import './FacetsView.css';

const { ipcRenderer } = window.require('electron');

// Preset colors for groups
const GROUP_COLORS = [
  '#d4843a', // amber (default)
  '#c4a35a', // gold
  '#7a9a5a', // sage
  '#5a8a7a', // teal
  '#5a7a9a', // steel blue
  '#6a5a9a', // purple
  '#9a5a7a', // mauve
  '#9a6a5a', // rust
];

function FacetsView({ refreshKey = 0, onFacetSelect, onFacetContextMenu, onFacetsChanged }) {
  const [facets, setFacets] = useState([]);
  const [facetsConfig, setFacetsConfig] = useState({ groups: [], starred: [], recent: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState('all'); // 'all', 'uncategorized', or group id

  // Drag state
  const [draggedFacet, setDraggedFacet] = useState(null);
  const [draggedGroup, setDraggedGroup] = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);

  // Modals
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showCreateFacet, setShowCreateFacet] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [newFacetName, setNewFacetName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [renamingGroup, setRenamingGroup] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    loadFacets();
  }, [refreshKey]);

  // Global ESC handler for modals - closes them before App can deselect
  useEffect(() => {
    const anyModalOpen = showCreateGroup || showCreateFacet || showDeleteConfirm || showDeleteGroupConfirm || showColorPicker;
    if (!anyModalOpen) return;

    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (showColorPicker) setShowColorPicker(null);
        else if (showDeleteConfirm) setShowDeleteConfirm(null);
        else if (showDeleteGroupConfirm) setShowDeleteGroupConfirm(null);
        else if (showCreateFacet) setShowCreateFacet(false);
        else if (showCreateGroup) setShowCreateGroup(false);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [showCreateGroup, showCreateFacet, showDeleteConfirm, showDeleteGroupConfirm, showColorPicker]);

  async function loadFacets() {
    try {
      const [allFacets, config] = await Promise.all([
        ipcRenderer.invoke('get-all-facets'),
        ipcRenderer.invoke('get-facets')
      ]);

      // Merge in empty facets from the recent list that aren't already in allFacets
      const existingNames = new Set(allFacets.map(f => f.name));
      const emptyFacets = (config.recent || [])
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, count: 0 }));

      setFacets([...allFacets, ...emptyFacets]);
      setFacetsConfig(config);
    } catch (err) {
      console.error('Error loading facets:', err);
    }
  }

  // Build facet count map for quick lookup
  const facetCountMap = {};
  facets.forEach(f => { facetCountMap[f.name] = f.count; });

  // Get color for a facet based on its group
  function getFacetColor(facetName) {
    for (const group of facetsConfig.groups || []) {
      if ((group.facets || []).includes(facetName)) {
        return group.color || GROUP_COLORS[0];
      }
    }
    return null;
  }

  // Get group for a facet
  function getFacetGroup(facetName) {
    for (const group of facetsConfig.groups || []) {
      if ((group.facets || []).includes(facetName)) {
        return group.id;
      }
    }
    return null;
  }

  // Filter facets by search and selected group
  function filterFacets(facetList) {
    let filtered = facetList;

    // Filter by selected group
    if (selectedGroup === 'uncategorized') {
      // Only show facets not in any group
      const groupedFacets = new Set();
      (facetsConfig.groups || []).forEach(g => {
        (g.facets || []).forEach(f => groupedFacets.add(f));
      });
      filtered = filtered.filter(f => !groupedFacets.has(f.name));
    } else if (selectedGroup !== 'all') {
      // Show facets in the selected group
      const group = (facetsConfig.groups || []).find(g => g.id === selectedGroup);
      if (group) {
        const groupFacetSet = new Set(group.facets || []);
        filtered = filtered.filter(f => groupFacetSet.has(f.name));
      }
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(query));
    }

    if (showStarredOnly) {
      const starredSet = new Set(facetsConfig.starred || []);
      filtered = filtered.filter(f => starredSet.has(f.name));
    }

    return filtered;
  }

  const isStarred = (name) => (facetsConfig.starred || []).includes(name);

  // === Event Handlers ===

  function handleFacetClick(facetName) {
    if (onFacetSelect) {
      onFacetSelect(facetName);
    }
  }

  async function handleToggleStar(facetName, e) {
    e.stopPropagation();

    const starred = [...(facetsConfig.starred || [])];
    const index = starred.indexOf(facetName);

    if (index >= 0) {
      starred.splice(index, 1);
    } else {
      starred.push(facetName);
    }

    const newConfig = { ...facetsConfig, starred };
    setFacetsConfig(newConfig);
    await ipcRenderer.invoke('save-facets', newConfig);
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;

    try {
      const result = await ipcRenderer.invoke('create-facet-group', {
        name: newGroupName.trim(),
        color: newGroupColor
      });

      if (result.success) {
        setShowCreateGroup(false);
        setNewGroupName('');
        setNewGroupColor(GROUP_COLORS[0]);
        loadFacets();
      }
    } catch (err) {
      console.error('Error creating group:', err);
    }
  }

  async function handleCreateFacet() {
    if (!newFacetName.trim()) return;

    try {
      const config = { ...facetsConfig };
      config.recent = config.recent || [];
      if (!config.recent.includes(newFacetName.trim())) {
        config.recent.unshift(newFacetName.trim());
        config.recent = config.recent.slice(0, 12);
      }
      await ipcRenderer.invoke('save-facets', config);
      setFacetsConfig(config);
      setShowCreateFacet(false);
      setNewFacetName('');
      loadFacets();
      onFacetsChanged?.();
    } catch (err) {
      console.error('Error creating facet:', err);
    }
  }

  async function handleDeleteFacet(facetName) {
    try {
      const result = await ipcRenderer.invoke('delete-facet', facetName);
      if (result.success) {
        setShowDeleteConfirm(null);
        loadFacets();
        onFacetsChanged?.();
      }
    } catch (err) {
      console.error('Error deleting facet:', err);
    }
  }

  async function handleDeleteGroup(groupId) {
    try {
      const result = await ipcRenderer.invoke('delete-facet-group', groupId);
      if (result.success) {
        setShowDeleteGroupConfirm(null);
        loadFacets();
      }
    } catch (err) {
      console.error('Error deleting group:', err);
    }
  }

  async function handleRenameGroup(groupId, newName) {
    if (!newName.trim()) return;

    try {
      const result = await ipcRenderer.invoke('rename-facet-group', {
        groupId,
        newName: newName.trim()
      });
      if (result.success) {
        setRenamingGroup(null);
        setRenameValue('');
        loadFacets();
      }
    } catch (err) {
      console.error('Error renaming group:', err);
    }
  }

  async function handleUpdateGroupColor(groupId, color) {
    try {
      const result = await ipcRenderer.invoke('update-facet-group-color', { groupId, color });
      if (result.success) {
        setShowColorPicker(null);
        loadFacets();
      }
    } catch (err) {
      console.error('Error updating group color:', err);
    }
  }

  // === Drag and Drop for Facets ===

  function handleFacetDragStart(e, facetName, sourceGroupId) {
    setDraggedFacet({ name: facetName, sourceGroupId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', facetName);
  }

  function handleFacetDragEnd() {
    setDraggedFacet(null);
    setDragOverGroup(null);
  }

  function handleSidebarGroupDragOver(e, groupId) {
    e.preventDefault();
    if (draggedFacet) {
      setDragOverGroup(groupId);
    }
  }

  function handleSidebarGroupDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverGroup(null);
    }
  }

  async function handleSidebarGroupDrop(e, targetGroupId) {
    e.preventDefault();
    e.stopPropagation();

    if (draggedFacet) {
      const { name: facetName, sourceGroupId } = draggedFacet;

      if (sourceGroupId !== targetGroupId) {
        try {
          await ipcRenderer.invoke('move-facet-to-group', {
            facetName,
            groupId: targetGroupId
          });
          loadFacets();
        } catch (err) {
          console.error('Error moving facet:', err);
        }
      }
    }

    setDraggedFacet(null);
    setDragOverGroup(null);
  }

  // === Drag and Drop for Group Reordering ===

  function handleGroupDragStart(e, groupId) {
    setDraggedGroup(groupId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', groupId);
  }

  function handleGroupDragEnd() {
    setDraggedGroup(null);
  }

  function handleGroupDragOver(e, targetGroupId) {
    e.preventDefault();
    if (draggedGroup && draggedGroup !== targetGroupId) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  async function handleGroupDrop(e, targetGroupId) {
    e.preventDefault();
    e.stopPropagation();

    if (draggedGroup && draggedGroup !== targetGroupId) {
      const groups = facetsConfig.groups || [];
      const dragIndex = groups.findIndex(g => g.id === draggedGroup);
      const dropIndex = groups.findIndex(g => g.id === targetGroupId);

      if (dragIndex !== -1 && dropIndex !== -1) {
        const newOrder = groups.map(g => g.id);
        newOrder.splice(dragIndex, 1);
        newOrder.splice(dropIndex, 0, draggedGroup);

        try {
          await ipcRenderer.invoke('reorder-facet-groups', { groupIds: newOrder });
          loadFacets();
        } catch (err) {
          console.error('Error reordering groups:', err);
        }
      }
    }

    setDraggedGroup(null);
  }

  // === Render ===

  const groups = facetsConfig.groups || [];
  const filteredFacets = filterFacets(facets);
  const totalFacets = facets.length;

  return (
    <div className="facets-view-sidebar">
      {/* Left Sidebar - Groups */}
      <div className="facets-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">Groups</span>
          <button
            className="sidebar-add-btn"
            onClick={() => setShowCreateGroup(true)}
            title="Add group"
          >
            +
          </button>
        </div>

        <div className="sidebar-groups">
          {/* All facets option */}
          <div
            className={`sidebar-group all-facets ${selectedGroup === 'all' ? 'selected' : ''}`}
            onClick={() => setSelectedGroup('all')}
          >
            <span className="group-color-dot all-dot">✦</span>
            <span className="group-name">All</span>
            <span className="group-count">{totalFacets}</span>
          </div>

          {groups.map(group => {
            const groupFacetCount = (group.facets || []).length;
            const isDragOver = dragOverGroup === group.id;
            const isBeingDragged = draggedGroup === group.id;
            const isSelected = selectedGroup === group.id;

            return (
              <div
                key={group.id}
                className={`sidebar-group ${isDragOver ? 'drag-over' : ''} ${isBeingDragged ? 'dragging' : ''} ${isSelected ? 'selected' : ''}`}
                draggable={!renamingGroup}
                onClick={() => setSelectedGroup(group.id)}
                onDragStart={(e) => handleGroupDragStart(e, group.id)}
                onDragEnd={handleGroupDragEnd}
                onDragOver={(e) => {
                  handleGroupDragOver(e, group.id);
                  handleSidebarGroupDragOver(e, group.id);
                }}
                onDragLeave={handleSidebarGroupDragLeave}
                onDrop={(e) => {
                  if (draggedGroup) {
                    handleGroupDrop(e, group.id);
                  } else {
                    handleSidebarGroupDrop(e, group.id);
                  }
                }}
              >
                <span
                  className="group-color-dot"
                  style={{ background: group.color || GROUP_COLORS[0] }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowColorPicker(showColorPicker === group.id ? null : group.id);
                  }}
                  title="Change color"
                />

                {renamingGroup === group.id ? (
                  <input
                    type="text"
                    className="group-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      if (renameValue.trim()) {
                        handleRenameGroup(group.id, renameValue);
                      } else {
                        setRenamingGroup(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleRenameGroup(group.id, renameValue);
                      } else if (e.key === 'Escape') {
                        setRenamingGroup(null);
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="group-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingGroup(group.id);
                      setRenameValue(group.name);
                    }}
                  >
                    {group.name}
                  </span>
                )}

                <span className="group-count">{groupFacetCount}</span>

                <button
                  className="group-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteGroupConfirm(group.id);
                  }}
                  title="Delete group"
                >
                  ×
                </button>

                {/* Inline color picker */}
                {showColorPicker === group.id && (
                  <div className="color-picker-dropdown" onClick={(e) => e.stopPropagation()}>
                    {GROUP_COLORS.map(color => (
                      <button
                        key={color}
                        className={`color-option ${group.color === color ? 'active' : ''}`}
                        style={{ background: color }}
                        onClick={() => handleUpdateGroupColor(group.id, color)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Uncategorized drop zone */}
          <div
            className={`sidebar-group uncategorized ${dragOverGroup === null && draggedFacet ? 'drag-over' : ''} ${selectedGroup === 'uncategorized' ? 'selected' : ''}`}
            onClick={() => setSelectedGroup('uncategorized')}
            onDragOver={(e) => handleSidebarGroupDragOver(e, null)}
            onDragLeave={handleSidebarGroupDragLeave}
            onDrop={(e) => handleSidebarGroupDrop(e, null)}
          >
            <span className="group-color-dot uncategorized-dot">◇</span>
            <span className="group-name">Uncategorized</span>
            <span className="group-count">
              {facets.filter(f => !getFacetGroup(f.name)).length}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="facets-main">
        {/* Top bar with search and actions */}
        <div className="facets-topbar">
          <div className="facets-search">
            <span className="search-icon">⌕</span>
            <input
              type="text"
              placeholder="Filter facets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>

          <button
            className={`starred-toggle ${showStarredOnly ? 'active' : ''}`}
            onClick={() => setShowStarredOnly(!showStarredOnly)}
            title="Show starred only"
          >
            {showStarredOnly ? '★' : '☆'}
          </button>

          <span className="facets-count">{totalFacets} facets</span>

          <button
            className="add-facet-btn-topbar"
            onClick={() => setShowCreateFacet(true)}
          >
            + Facet
          </button>
        </div>

        {/* Facet cards grid */}
        <div className="facets-grid">
          {filteredFacets.map(facet => {
            const color = getFacetColor(facet.name);
            const groupId = getFacetGroup(facet.name);

            return (
              <div
                key={facet.name}
                className={`facet-card ${isStarred(facet.name) ? 'starred' : ''} ${color ? 'has-color' : ''}`}
                draggable
                onDragStart={(e) => handleFacetDragStart(e, facet.name, groupId)}
                onDragEnd={handleFacetDragEnd}
                onClick={() => handleFacetClick(facet.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onFacetContextMenu) {
                    onFacetContextMenu(e, {
                      name: facet.name,
                      count: facet.count,
                      starred: isStarred(facet.name),
                      color
                    }, loadFacets);
                  }
                }}
              >
                {color && <span className="facet-color-bar" style={{ background: color }} />}
                <span className="facet-star" onClick={(e) => handleToggleStar(facet.name, e)}>
                  {isStarred(facet.name) ? '★' : '☆'}
                </span>
                <span className="facet-name">{facet.name}</span>
                <span className="facet-count">{facet.count}</span>
                <span
                  className="facet-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(facet.name);
                  }}
                >
                  ×
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="facet-modal-overlay" onClick={() => setShowCreateGroup(false)}>
          <div className="facet-modal" onClick={e => e.stopPropagation()}>
            <h3>Create Group</h3>
            <input
              type="text"
              placeholder="Group name..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              autoFocus
            />
            <div className="color-picker-row">
              <span className="color-label">Color:</span>
              {GROUP_COLORS.map(color => (
                <button
                  key={color}
                  className={`color-option ${newGroupColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setNewGroupColor(color)}
                />
              ))}
            </div>
            <div className="facet-modal-buttons">
              <button className="modal-btn cancel" onClick={() => setShowCreateGroup(false)}>
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Facet Modal */}
      {showCreateFacet && (
        <div className="facet-modal-overlay" onClick={() => setShowCreateFacet(false)}>
          <div className="facet-modal" onClick={e => e.stopPropagation()}>
            <h3>Create Facet</h3>
            <input
              type="text"
              placeholder="Facet name..."
              value={newFacetName}
              onChange={(e) => setNewFacetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFacet()}
              autoFocus
            />
            <p className="modal-hint">
              New facets will appear in the facet picker. Apply them to tracks to make them permanent.
            </p>
            <div className="facet-modal-buttons">
              <button className="modal-btn cancel" onClick={() => setShowCreateFacet(false)}>
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleCreateFacet}
                disabled={!newFacetName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Facet Modal */}
      {showDeleteConfirm && (
        <div className="facet-modal-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="facet-modal delete-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Facet</h3>
            <p>Delete "<strong>{showDeleteConfirm}</strong>" from all tracks?</p>
            <p className="delete-warning">This cannot be undone.</p>
            <div className="facet-modal-buttons">
              <button className="modal-btn cancel" onClick={() => setShowDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="modal-btn delete"
                onClick={() => handleDeleteFacet(showDeleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Modal */}
      {showDeleteGroupConfirm && (
        <div className="facet-modal-overlay" onClick={() => setShowDeleteGroupConfirm(null)}>
          <div className="facet-modal delete-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Group</h3>
            <p>Delete "<strong>{groups.find(g => g.id === showDeleteGroupConfirm)?.name}</strong>"?</p>
            <p className="delete-warning">Facets will become uncategorized.</p>
            <div className="facet-modal-buttons">
              <button className="modal-btn cancel" onClick={() => setShowDeleteGroupConfirm(null)}>
                Cancel
              </button>
              <button
                className="modal-btn delete"
                onClick={() => handleDeleteGroup(showDeleteGroupConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FacetsView;
