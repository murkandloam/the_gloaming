import React from 'react';
import '../styles/TagsView.css'; // Shared placeholder styles

function ChartsView({ onTrackSelect }) {
  return (
    <div className="charts-view">
      <div className="charts-content">
        <h2>LEDGERS VIEW</h2>
        <p>Listening history ledgers coming soon...</p>
      </div>
      
      {/* Universal bottom bar */}
      <div className="bottom-bar">
        <div className="bottom-bar-placeholder"></div>
      </div>
    </div>
  );
}

export default ChartsView;
