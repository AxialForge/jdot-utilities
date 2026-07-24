// Rebuild the hashes in latest.yml after the installer has been signed.
//
// Why this is needed: electron-builder writes latest.yml (the manifest the
// in-app updater reads) with a SHA-512 computed over the UNSIGNED installer.
// Code signing appends a signature to the .exe, changing its bytes — so the
// hash in latest.yml no longer matches the file users download, and the
// updater's integrity check would reject every update. SignPath signs the
// artifact after the build completes (each request is approved by a human), so
// it can't run inside electron-builder's synchronous sign hook; instead we sign,
// then run this to make latest.yml describe the signed file.
//
// It also drops the stale *.blockmap: the blockmap maps chunks of the unsigned
// file for differential downloads, and signing invalidates it. Removing it (and
// its reference) makes the updater do a plain full download, which is always
// correct. Usage: node scripts/regen-latest-yml.js [distDir]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const distDir = process.argv[2] || "dist";
const ymlPath = path.join(distDir, "latest.yml");

function sha512Base64(file) {
  const hash = crypto.createHash("sha512");
  hash.update(fs.readFileSync(file));
  return hash.digest("base64");
}

// Minimal, targeted rewrite of the specific fields — deliberately NOT a full
// YAML parse/serialize, so the file's shape and every other field are preserved
// exactly as electron-builder wrote them.
function main() {
  if (!fs.existsSync(ymlPath)) {
    console.error(`regen-latest-yml: ${ymlPath} not found`);
    process.exit(1);
  }
  let text = fs.readFileSync(ymlPath, "utf8");

  // The installer filename appears as `path:` and as a `- url:` entry.
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  if (!pathMatch) {
    console.error("regen-latest-yml: no `path:` in latest.yml");
    process.exit(1);
  }
  const fileName = pathMatch[1].trim();
  const filePath = path.join(distDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`regen-latest-yml: signed artifact ${filePath} not found`);
    process.exit(1);
  }

  const sha = sha512Base64(filePath);
  const size = fs.statSync(filePath).size;

  // Replace every sha512 line (the files[] entry and the top-level one).
  text = text.replace(/sha512:\s*.+/g, `sha512: ${sha}`);
  // Replace the size line inside the files[] entry.
  text = text.replace(/size:\s*\d+/g, `size: ${size}`);
  // Drop the blockmap reference if present (we omit the stale blockmap).
  text = text.replace(/^\s*blockMapSize:\s*\d+\s*$/m, "").replace(/\n{3,}/g, "\n\n");

  fs.writeFileSync(ymlPath, text, "utf8");

  // Remove any now-stale blockmap files so they aren't uploaded.
  for (const f of fs.readdirSync(distDir)) {
    if (f.endsWith(".blockmap")) fs.rmSync(path.join(distDir, f), { force: true });
  }

  console.log(`regen-latest-yml: ${fileName} -> sha512 ${sha.slice(0, 16)}… size ${size}`);
}

main();
