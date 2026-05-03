const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { fileTypeFromBuffer } = require('file-type');
const env = require('./load-env');

const LOGO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LOGO_UPLOAD_LIMIT_BYTES,
    files: 1
  }
});

const ensureLogoUploadDir = async () => {
  await fs.mkdir(env.logoUploadDir, { recursive: true });
};

const getLogoExtension = (mimeType) => {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
};

const saveLogoFile = async (file, storeId = 'store') => {
  if (!file || !file.buffer?.length) {
    return null;
  }

  const detected = await fileTypeFromBuffer(file.buffer);
  const mimeType = detected?.mime || '';
  if (!ALLOWED_LOGO_MIME_TYPES.has(mimeType)) {
    const error = new Error('Only PNG, JPEG, and WebP logo uploads are supported.');
    error.status = 422;
    throw error;
  }

  // Security: Sanitize storeId to prevent path traversal attacks
  const sanitizedStoreId = String(storeId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedStoreId) {
    const error = new Error('Invalid store identifier.');
    error.status = 400;
    throw error;
  }

  await ensureLogoUploadDir();
  const filename = `store-${sanitizedStoreId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${getLogoExtension(mimeType)}`;
  const targetPath = path.join(env.logoUploadDir, filename);

  // Security: Verify the resolved path is within the upload directory
  const resolvedPath = path.resolve(targetPath);
  const resolvedUploadDir = path.resolve(env.logoUploadDir);
  const resolvedUploadPrefix = `${resolvedUploadDir}${path.sep}`;
  if (resolvedPath !== resolvedUploadDir && !resolvedPath.startsWith(resolvedUploadPrefix)) {
    const error = new Error('Invalid file path.');
    error.status = 400;
    throw error;
  }

  await fs.writeFile(targetPath, file.buffer, {
    mode: 0o600,
    flag: 'wx'
  });
  return `/logos/${filename}`;
};

module.exports = {
  LOGO_UPLOAD_LIMIT_BYTES,
  ALLOWED_LOGO_MIME_TYPES,
  logoUpload,
  ensureLogoUploadDir,
  saveLogoFile
};
