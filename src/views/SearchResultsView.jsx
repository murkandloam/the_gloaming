/**
 * SearchResultsView - Displays search results in the center panel
 *
 * Shows results in sections:
 * - Mini album grid (matching albums)
 * - Track list (matching tracks)
 * - Facet list (matching facets)
 * - Cassettes (cassette cards with covers)
 * - Programs (program names)
 */

import React from 'react';
import './SearchResultsView.css';
import { getCassetteImage } from '../assets/cassettes';

function SearchResultsView({
  query,
  albums = [],
  tracks = [],
  facets = [],
  mixtapes = [],
  programs = [],
  coverCacheBust = 0,
  onAlbumSelect,
  onTrackSelect,
  onFacetSelect,
  onMixtapeSelect,
  onProgramSelect,
  // Search scope filters
  searchScope = { albums: true, tracks: true, facets: true, mixtapes: true, programs: true }
}) {
  const hasResults = albums.length > 0 || tracks.length > 0 || facets.length > 0 || mixtapes.length > 0 || programs.length > 0;

  if (!query || query.length < 2) {
    return (
      <div className="search-results-view">
        <div className="search-prompt">
          <span className="search-prompt-icon">⌕</span>
          <p>Type at least 2 characters to search</p>
        </div>
      </div>
    );
  }

  if (!hasResults) {
    return (
      <div className="search-results-view">
        <div className="search-empty">
          <span className="search-empty-icon">🦗</span>
          <span className="search-empty-icon">🦗</span>
          <span className="search-empty-icon">🦗</span>
          <p className="search-empty-text">No results for "{query}"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="search-results-view">
      <div className="search-results-content">
        {/* Albums Section */}
        {searchScope.albums && albums.length > 0 && (
          <section className="search-section">
            <h2 className="search-section-header">Records</h2>
            <div className="search-album-grid">
              {albums.map(album => (
                <div
                  key={album.id}
                  className="search-album-card"
                  onClick={() => onAlbumSelect(album)}
                  title={`${album.title} - ${album.artist}`}
                >
                  <div className="search-album-cover">
                    {(album.thumbnailPath || album.coverPath) ? (
                      <img
                        src={`local://${album.thumbnailPath || album.coverPath}?v=${coverCacheBust}`}
                        alt={album.title}
                      />
                    ) : (
                      <div className="search-album-placeholder">♪</div>
                    )}
                  </div>
                  <div className="search-album-info">
                    <span className="search-album-title">{album.title}</span>
                    <span className="search-album-artist">{album.artist}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tracks Section */}
        {searchScope.tracks && tracks.length > 0 && (
          <section className="search-section">
            <h2 className="search-section-header">Tracks</h2>
            <div className="search-track-list">
              {tracks.map((track, index) => (
                <div
                  key={track.id || index}
                  className="search-track-item"
                  onClick={() => onTrackSelect(track)}
                >
                  <div className="search-track-info">
                    <span className="search-track-title">{track.title}</span>
                    <span className="search-track-artist">{track.artist}</span>
                  </div>
                  <span className="search-track-album">{track.album}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Facets Section */}
        {searchScope.facets && facets.length > 0 && (
          <section className="search-section">
            <h2 className="search-section-header">Facets</h2>
            <div className="search-facet-list">
              {facets.map(facet => (
                <div
                  key={facet.name}
                  className="search-facet-item"
                  onClick={() => onFacetSelect(facet.name)}
                >
                  <span className="search-facet-name">{facet.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Cassettes Section */}
        {searchScope.mixtapes && mixtapes.length > 0 && (
          <section className="search-section">
            <h2 className="search-section-header">Cassettes</h2>
            <div className="search-mixtape-grid">
              {mixtapes.map(mixtape => {
                // Use custom cover if available, otherwise fall back to cassette image
                const coverSrc = mixtape.coverPath
                  ? `local://${mixtape.coverPath}`
                  : getCassetteImage(mixtape.cassetteIndex ?? 0);
                return (
                  <div
                    key={mixtape.id}
                    className="search-mixtape-card"
                    onClick={() => onMixtapeSelect(mixtape)}
                    title={mixtape.name}
                  >
                    <div className="search-mixtape-cover">
                      <img
                        src={coverSrc}
                        alt={mixtape.name}
                        className="search-mixtape-cover-image"
                      />
                      <div className="search-mixtape-name-pill">
                        <span className="search-mixtape-name">{mixtape.name}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Programs Section */}
        {searchScope.programs && programs.length > 0 && (
          <section className="search-section">
            <h2 className="search-section-header">Programs</h2>
            <div className="search-program-list">
              {programs.map(program => (
                <div
                  key={program.id}
                  className="search-program-item"
                  onClick={() => onProgramSelect(program)}
                >
                  <span className="search-program-name">{program.name}</span>
                  <span className="search-program-modules">{program.modules?.length || 0} modules</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default SearchResultsView;
