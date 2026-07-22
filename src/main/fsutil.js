// Lists files in a folder — top-level only, or recursing into subfolders.
// Kept free of Electron so it can be unit-tested directly. Symlinks are skipped
// to avoid traversal loops.

const fs = require("node:fs");
const path = require("node:path");

function listFiles(dir, { recurse = false } = {}) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (recurse) walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

module.exports = { listFiles };
