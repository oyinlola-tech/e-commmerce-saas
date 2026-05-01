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
  const mimeType = detected?.mime || file.mimetype;
  if (!ALLOWED_LOGO_MIME_TYPES.has(mimeType)) {
    const error = new Error('Only PNG, JPEG, and WebP logo uploads are supported.');
    error.status = 422;
    throw error;
  }

  await ensureLogoUploadDir();
  const filename = `store-${storeId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${getLogoExtension(mimeType)}`;
  await fs.writeFile(path.join(env.logoUploadDir, filename), file.buffer);
  return `/logos/${filename}`;
};

module.exports = {
  LOGO_UPLOAD_LIMIT_BYTES,
  ALLOWED_LOGO_MIME_TYPES,
  logoUpload,
  ensureLogoUploadDir,
  saveLogoFile
};
