/**
 * The Gloaming - Thumbnail Generation
 *
 * Generates thumbnails for image attachments using Sharp.
 * - Large: 600x600 for grid views (thumbnail.jpg)
 * - Small: 80x80 for list views, queue, history, ledgers (thumbnail-small.jpg)
 * Thumbnails are always saved as JPEG for consistency and smaller file sizes.
 */

const sharp = require('sharp');

const THUMBNAIL_SIZE = 600;
const THUMBNAIL_SIZE_SMALL = 80;
const THUMBNAIL_QUALITY = 85;

/**
 * Generate a thumbnail from a file path
 * @param {string} inputPath - Path to source image
 * @param {string} outputPath - Path to save thumbnail (should end in .jpg)
 * @param {number} size - Thumbnail size (default 300)
 * @returns {Promise<{success: boolean, width: number, height: number}>}
 */
async function generateThumbnail(inputPath, outputPath, size = THUMBNAIL_SIZE) {
  try {
    const result = await sharp(inputPath)
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toFile(outputPath);

    return {
      success: true,
      width: result.width,
      height: result.height
    };
  } catch (err) {
    console.error('Error generating thumbnail from file:', err.message);
    throw err;
  }
}

/**
 * Generate a thumbnail from a buffer (for embedded album art)
 * @param {Buffer} buffer - Image data buffer
 * @param {string} outputPath - Path to save thumbnail (should end in .jpg)
 * @param {number} size - Thumbnail size (default 300)
 * @returns {Promise<{success: boolean, width: number, height: number}>}
 */
async function generateThumbnailFromBuffer(buffer, outputPath, size = THUMBNAIL_SIZE) {
  try {
    const result = await sharp(buffer)
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toFile(outputPath);

    return {
      success: true,
      width: result.width,
      height: result.height
    };
  } catch (err) {
    console.error('Error generating thumbnail from buffer:', err.message);
    throw err;
  }
}

/**
 * Generate both large and small thumbnails from a file path
 * @param {string} inputPath - Path to source image
 * @param {string} outputDir - Directory to save thumbnails
 * @returns {Promise<{success: boolean, large: boolean, small: boolean}>}
 */
async function generateThumbnails(inputPath, outputDir) {
  const path = require('path');
  let large = false;
  let small = false;

  try {
    await generateThumbnail(inputPath, path.join(outputDir, 'thumbnail.jpg'), THUMBNAIL_SIZE);
    large = true;
  } catch (err) {
    console.error('Error generating large thumbnail:', err.message);
  }

  try {
    await generateThumbnail(inputPath, path.join(outputDir, 'thumbnail-small.jpg'), THUMBNAIL_SIZE_SMALL);
    small = true;
  } catch (err) {
    console.error('Error generating small thumbnail:', err.message);
  }

  return { success: large || small, large, small };
}

/**
 * Generate both large and small thumbnails from a buffer
 * @param {Buffer} buffer - Image data buffer
 * @param {string} outputDir - Directory to save thumbnails
 * @returns {Promise<{success: boolean, large: boolean, small: boolean}>}
 */
async function generateThumbnailsFromBuffer(buffer, outputDir) {
  const path = require('path');
  let large = false;
  let small = false;

  try {
    await generateThumbnailFromBuffer(buffer, path.join(outputDir, 'thumbnail.jpg'), THUMBNAIL_SIZE);
    large = true;
  } catch (err) {
    console.error('Error generating large thumbnail from buffer:', err.message);
  }

  try {
    await generateThumbnailFromBuffer(buffer, path.join(outputDir, 'thumbnail-small.jpg'), THUMBNAIL_SIZE_SMALL);
    small = true;
  } catch (err) {
    console.error('Error generating small thumbnail from buffer:', err.message);
  }

  return { success: large || small, large, small };
}

module.exports = {
  generateThumbnail,
  generateThumbnailFromBuffer,
  generateThumbnails,
  generateThumbnailsFromBuffer,
  THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_SMALL
};
