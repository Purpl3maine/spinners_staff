'use strict';

// Storage for uploaded HR documents (contracts etc). Files live on disk next
// to data.json — on Railway that's the persistent volume — and only their
// metadata (id, original filename, path) is kept in data.json.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const { uuid } = require('./util');

const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads', 'contracts');

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);

function extOf(filename) {
  return path.extname(filename || '').toLowerCase();
}

function isAllowed(filename) {
  return ALLOWED_EXT.has(extOf(filename));
}

// Saves an uploaded file (from parseMultipartBody) for a given user.
// Returns metadata to store on the user record, or throws if the file type
// isn't allowed.
function saveContractFile(userId, file) {
  if (!isAllowed(file.filename)) {
    throw new Error('That file type isn’t supported. Please upload a PDF, Word doc, or image (jpg/png).');
  }
  const id = uuid();
  const ext = extOf(file.filename);
  const dir = path.join(UPLOADS_ROOT, userId);
  fs.mkdirSync(dir, { recursive: true });
  const storedRelPath = path.join('uploads', 'contracts', userId, `${id}${ext}`);
  fs.writeFileSync(path.join(DATA_DIR, storedRelPath), file.data);
  return {
    id,
    filename: file.filename,
    storedPath: storedRelPath,
    contentType: file.contentType || 'application/octet-stream',
    size: file.data.length,
  };
}

function absolutePath(storedRelPath) {
  return path.join(DATA_DIR, storedRelPath);
}

function deleteContractFile(storedRelPath) {
  try {
    fs.unlinkSync(absolutePath(storedRelPath));
  } catch (err) {
    // Already gone / never existed — fine, nothing left to clean up.
  }
}

// Removes all uploaded documents for a user (e.g. when their account is
// permanently removed via "Reset for go-live").
function deleteAllForUser(userId) {
  try {
    fs.rmSync(path.join(UPLOADS_ROOT, userId), { recursive: true, force: true });
  } catch (err) {
    // ignore
  }
}

module.exports = { isAllowed, saveContractFile, absolutePath, deleteContractFile, deleteAllForUser };
