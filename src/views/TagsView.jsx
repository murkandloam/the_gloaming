import React from 'react';
import '../styles/TagsView.css';

function TagsView({ onTrackSelect }) {
  return (
    <div className="tags-view">
      <div className="tags-content">
        <h2>FACETS VIEW</h2>
        <p>Facet taxonomy management coming soon...</p>
      </div>
      
      {/* Universal bottom bar */}
      <div className="bottom-bar">
        <div className="bottom-bar-placeholder">
          {/* Future: global controls can go here */}
        </div>
      </div>
    </div>
  );
}

export default TagsView;
