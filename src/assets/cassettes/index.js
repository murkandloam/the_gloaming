// Cassette images for mixtapes
// Uses a placeholder until actual images are added

export const CASSETTE_COUNT = 14;

// 1x1 transparent PNG as placeholder
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Use Vite's glob import to load cassette images
const cassetteModules = import.meta.glob('./Cassette*.png', { eager: true, import: 'default' });

// Build cassettes array - map filenames to indices
const cassettes = new Array(CASSETTE_COUNT).fill(PLACEHOLDER);

// Parse loaded modules into the array
Object.entries(cassetteModules).forEach(([path, url]) => {
  // Extract number from filename like './Cassette01.png' -> 1
  const match = path.match(/Cassette(\d+)\.png$/);
  if (match) {
    const index = parseInt(match[1], 10) - 1; // Convert to 0-based index
    if (index >= 0 && index < CASSETTE_COUNT) {
      cassettes[index] = url;
    }
  }
});

export { cassettes };

// Get a random cassette index (0-15)
export function getRandomCassetteIndex() {
  return Math.floor(Math.random() * CASSETTE_COUNT);
}

// Get cassette image by index (always returns something valid)
export function getCassetteImage(index) {
  const safeIndex = ((index % CASSETTE_COUNT) + CASSETTE_COUNT) % CASSETTE_COUNT;
  return cassettes[safeIndex] || PLACEHOLDER;
}

// Check if we have any real cassette images loaded
export function hasCassetteImages() {
  return cassettes.some(c => c !== PLACEHOLDER);
}
