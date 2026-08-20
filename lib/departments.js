'use strict';

// A fixed palette departments cycle through automatically as they're
// created — colorIndex is stored on the department (not recomputed), so
// colours stay stable even if other departments are added or removed
// later. Matching CSS classes (.dept-badge-N / .dept-row-N / .dept-accent-N)
// live in style.css.
const PALETTE_SIZE = 8;

function nextColorIndex(departments) {
  return (departments || []).length % PALETTE_SIZE;
}

module.exports = { PALETTE_SIZE, nextColorIndex };
