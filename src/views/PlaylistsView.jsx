import React from 'react';
import '../styles/TagsView.css'; // Shared placeholder styles

function PlaylistsView({ onTrackSelect }) {
  return (
    <div className="playlists-view">
      <div className="playlists-content">
        <h2>MIXTAPES VIEW</h2>
        <p>Static and Smart Mixtapes coming soon...</p>
      </div>
      
      {/* Universal bottom bar */}
      <div className="bottom-bar">
        <div className="bottom-bar-placeholder"></div>
      </div>
    </div>
  );
}

export default PlaylistsView;
