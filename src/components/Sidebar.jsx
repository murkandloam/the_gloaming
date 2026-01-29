import React from 'react';
import '../styles/Sidebar.css';

function Sidebar({ track, isLocked, onLockToggle }) {
  return (
    <div className="sidebar">
      {/* Lock Toggle */}
      <div className="sidebar-header">
        <button 
          className="lock-toggle" 
          onClick={onLockToggle}
          title={isLocked ? 'Unlock (follow clicks)' : 'Lock (pin to now playing)'}
        >
          {isLocked ? '🔒' : '🔓'}
        </button>
      </div>

      {track ? (
        <>
          {/* Album Art */}
          <div className="sidebar-album-art">
            <img src={track.albumArt} alt="Album Art" />
          </div>

          {/* Track Details */}
          <div className="sidebar-section">
            <div className="sidebar-title">{track.title}</div>
            <div className="sidebar-artist">{track.artist}</div>
            <div className="sidebar-album">{track.album}</div>
          </div>

          {/* Tags Section */}
          <div className="sidebar-section">
            <div className="section-header">─── Tags ───</div>
            <div className="tags-list">
              {track.tags?.map(tag => (
                <div key={tag} className="tag-item">
                  {tag} <span className="tag-remove">×</span>
                </div>
              ))}
              <button className="add-tag-btn">+ Add Tag</button>
            </div>
          </div>

          {/* Lyrics Section */}
          <div className="sidebar-section">
            <div className="section-header">─── Lyrics ───</div>
            <div className="lyrics-preview">(expandable)</div>
          </div>

          {/* Attachments Section */}
          <div className="sidebar-section">
            <div className="section-header">─ Attached ─</div>
            <div className="attachments-list">
              {track.attachments?.map(file => (
                <div key={file} className="attachment-item">
                  📄 {file}
                </div>
              ))}
              <button className="add-attachment-btn">+ Attach</button>
            </div>
          </div>

          {/* Add to Playlist */}
          <div className="sidebar-section">
            <button className="add-playlist-btn">+ Playlist</button>
          </div>
        </>
      ) : (
        <div className="sidebar-empty">
          <p>Select a track to view details</p>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
