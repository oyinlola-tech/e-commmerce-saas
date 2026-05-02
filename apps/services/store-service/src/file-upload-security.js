const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { fileTypeFromBuffer } = require('file-type');
const { createHttpError } = require('../../../../packages/shared');

/**
 * Secure File Upload Handler
 * Features:
 * - MIME type detection and validation
 * - File content scanning (re-encoding)
 * - Size limits
 * - Path traversal prevention
 * - Sanitized filename generation
 */

const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const LOGO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_IMAGE_WIDTH = 4000;
const MAX_IMAGE_HEIGHT = 4000;

/**
 * Validate uploaded file
 * @param {Buffer} buffer - File buffer
 * @param {string} declaredMimeType - MIME type from form
 * @returns {Promise<Buffer>} Sanitized file buffer
 */
const validateUploadedFile = async (buffer, declaredMimeType) => {
  // 1. Check file size
  if (buffer.length > LOGO_UPLOAD_LIMIT_BYTES) {
    throw createHttpError(
      413,
      `File too large. Maximum size is ${LOGO_UPLOAD_LIMIT_BYTES / 1024 / 1024}MB.`
    );
  }

  // 2. Detect actual MIME type
  const detectedType = await fileTypeFromBuffer(buffer);

  if (!detectedType) {
    throw createHttpError(400, 'Could not determine file type. Ensure you\'re uploading a valid image.');
  }

  // 3. Verify MIME type is allowed
  if (!ALLOWED_LOGO_MIME_TYPES.has(detectedType.mime)) {
    throw createHttpError(
      415,
      `File type ${detectedType.mime} is not allowed. Supported types: PNG, JPEG, WebP.`
    );
  }

  // 4. Warn if declared MIME differs from detected
  // (Could be user error or potential attack)
  if (declaredMimeType !== detectedType.mime) {
    console.warn('MIME type mismatch in file upload', {
      declared: declaredMimeType,
      detected: detectedType.mime,
      timestamp: new Date().toISOString()
    });
  }

  // 5. Scan by re-encoding
  // This removes any embedded data, malware, or corrupted sections
  let sanitized;
  try {
    const sharp = require('sharp');

    const metadata = await sharp(buffer).metadata();

    // Validate dimensions
    if (!metadata.width || !metadata.height) {
      throw createHttpError(400, 'Invalid image. Could not read dimensions.');
    }

    if (metadata.width > MAX_IMAGE_WIDTH || metadata.height > MAX_IMAGE_HEIGHT) {
      throw createHttpError(
        400,
        `Image dimensions (${metadata.width}x${metadata.height}) exceed maximum (${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}).`
      );
    }

    // Re-encode to strip embedded data
    const outputFormat = detectedType.ext === 'jpg' ? 'jpeg' : detectedType.ext;
    sanitized = await sharp(buffer)
      .resize(
        Math.min(metadata.width, 2000),
        Math.min(metadata.height, 2000),
        {
          fit: 'inside',
          withoutEnlargement: true
        }
      )
      .toFormat(outputFormat, { quality: 80, progressive: true })
      .toBuffer();
  } catch (error) {
    if (error.status) throw error; // Re-throw HTTP errors

    throw createHttpError(400, 'Failed to process image. File may be corrupted.');
  }

  return sanitized;
};

/**
 * Generate safe filename
 * @param {string} storeId - Store identifier
 * @param {string} mimeType - File MIME type
 * @returns {string} Safe filename
 */
const generateSafeFilename = (storeId, mimeType) => {
  const extensionMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };

  const extension = extensionMap[mimeType] || 'bin';
  const timestamp = Date.now();
  const random = crypto.randomUUID().slice(0, 8);

  return `store-${storeId}-${timestamp}-${random}.${extension}`;
};

/**
 * Resolve safe upload path (prevent directory traversal)
 * @param {string} uploadDir - Base upload directory
 * @param {string} filename - Filename to resolve
 * @returns {string} Absolute path (validated)
 */
const resolveSafeUploadPath = (uploadDir, filename) => {
  const safeFilename = path.basename(String(filename || ''));

  if (!safeFilename) {
    throw createHttpError(400, 'Invalid filename.');
  }

  const absolutePath = path.resolve(uploadDir, safeFilename);
  const directoryPrefix = uploadDir.endsWith(path.sep)
    ? uploadDir
    : `${uploadDir}${path.sep}`;

  // Ensure resolved path is within upload directory
  // (prevents directory traversal attacks)
  if (!absolutePath.startsWith(directoryPrefix)) {
    throw createHttpError(400, 'Invalid file path. Access denied.');
  }

  return absolutePath;
};

/**
 * Ensure upload directory exists and is writable
 * @param {string} uploadDir - Directory path
 */
const ensureUploadDirectory = async (uploadDir) => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    throw createHttpError(500, 'Failed to create upload directory.');
  }
};

/**
 * Save validated file to disk
 * @param {Buffer} buffer - File buffer
 * @param {string} uploadDir - Base upload directory
 * @param {string} filename - Safe filename
 * @returns {Promise<string>} Relative URL path
 */
const saveFile = async (buffer, uploadDir, filename) => {
  await ensureUploadDirectory(uploadDir);

  const filepath = resolveSafeUploadPath(uploadDir, filename);

  try {
    await fs.writeFile(filepath, buffer, { mode: 0o644 });
  } catch (error) {
    throw createHttpError(500, 'Failed to save file.');
  }

  return `/logos/${filename}`;
};

/**
 * Delete file safely
 * @param {string} uploadDir - Base upload directory
 * @param {string} filename - Filename to delete
 */
const deleteFile = async (uploadDir, filename) => {
  const filepath = resolveSafeUploadPath(uploadDir, filename);

  try {
    await fs.unlink(filepath);
  } catch (error) {
    // Silently fail if file doesn't exist
    if (error.code !== 'ENOENT') {
      throw createHttpError(500, 'Failed to delete file.');
    }
  }
};

module.exports = {
  validateUploadedFile,
  generateSafeFilename,
  resolveSafeUploadPath,
  ensureUploadDirectory,
  saveFile,
  deleteFile,
  ALLOWED_LOGO_MIME_TYPES,
  LOGO_UPLOAD_LIMIT_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT
};
