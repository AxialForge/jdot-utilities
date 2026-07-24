// The updater's integrity check compares the downloaded installer against the
// SHA-512 in latest.yml. After signing changes the .exe bytes, latest.yml must
// be regenerated to match — get this wrong and EVERY update is rejected. This
// builds a fake dist/, mutates the "installer" (as signing would), regenerates,
// and confirms the manifest now matches the mutated file.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "regen-latest-yml.js");
const sha512 = (buf) => crypto.createHash("sha512").update(buf).digest("base64");

function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-regen-"));
  const exe = path.join(dir, "jdot-utilities-9.9.9-setup.exe");
  const bytes = Buffer.from("PRETEND INSTALLER (unsigned)");
  fs.writeFileSync(exe, bytes);
  // A latest.yml shaped exactly like electron-builder's output.
  fs.writeFileSync(
    path.join(dir, "latest.yml"),
    [
      "version: 9.9.9",
      "files:",
      "  - url: jdot-utilities-9.9.9-setup.exe",
      `    sha512: ${sha512(bytes)}`,
      `    size: ${bytes.length}`,
      "path: jdot-utilities-9.9.9-setup.exe",
      `sha512: ${sha512(bytes)}`,
      "releaseDate: '2026-07-24T00:00:00.000Z'",
      "",
    ].join("\n"),
    "utf8"
  );
  // A blockmap that regeneration should remove.
  fs.writeFileSync(path.join(dir, "jdot-utilities-9.9.9-setup.exe.blockmap"), "stale");
  return { dir, exe };
}

const readYml = (dir) => fs.readFileSync(path.join(dir, "latest.yml"), "utf8");

test("regenerated latest.yml matches the signed installer", () => {
  const { dir, exe } = fakeDist();

  // Simulate signing: append a signature blob, changing the bytes and size.
  const signed = Buffer.concat([fs.readFileSync(exe), Buffer.from("<<AUTHENTICODE SIGNATURE>>")]);
  fs.writeFileSync(exe, signed);

  execFileSync(process.execPath, [SCRIPT, dir]);

  const yml = readYml(dir);
  const expected = sha512(signed);
  // Both the files[] entry and the top-level sha512 must be the signed hash.
  const hashes = [...yml.matchAll(/sha512:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(hashes.length >= 2, "expected two sha512 fields");
  for (const h of hashes) assert.strictEqual(h, expected, "sha512 not updated to the signed file");
  assert.ok(yml.includes(`size: ${signed.length}`), "size not updated to the signed file");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the stale blockmap is removed", () => {
  const { dir } = fakeDist();
  assert.ok(fs.existsSync(path.join(dir, "jdot-utilities-9.9.9-setup.exe.blockmap")));
  execFileSync(process.execPath, [SCRIPT, dir]);
  const left = fs.readdirSync(dir).filter((f) => f.endsWith(".blockmap"));
  assert.deepStrictEqual(left, [], "blockmap should be deleted");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fails loudly if the installer is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-regen-bad-"));
  fs.writeFileSync(
    path.join(dir, "latest.yml"),
    "version: 1.0.0\npath: nope-setup.exe\nsha512: AAAA\n",
    "utf8"
  );
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, dir], { stdio: "pipe" }),
    /not found|failed/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
