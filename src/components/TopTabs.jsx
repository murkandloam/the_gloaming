import React from 'react';
import '../styles/TopTabs.css';

function TopTabs({ currentView, onViewChange }) {
  const tabs = ['GRID', 'TAGS', 'PLAYLISTS', 'CHARTS', 'CONFIGURATION'];

  return (
    <div className="top-tabs">
      {tabs.map((tab, index) => (
        <React.Fragment key={tab}>
          <button 
            className={`tab ${currentView === tab ? 'active' : ''}`}
            onClick={() => onViewChange(tab)}
          >
            {tab}
          </button>
          {index < tabs.length - 1 && <span className="tab-separator">·</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export default TopTabs;
