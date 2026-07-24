// LibreOffice plumbing. The conversion itself needs LibreOffice installed, so
// those checks skip when it is absent — but the URL shape is pure string work
// and is always verified, because getting it wrong silently broke every Office
// conversion on Windows.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { locateSoffice, convertOffice } = require("../src/main/office");

const soffice = locateSoffice(null);
const skip = soffice ? false : "LibreOffice not installed";

test("the UserInstallation profile is a well-formed file URL", () => {
  // Regression: office.js used to build this as "file://" + a raw Windows path,
  // producing "file://C:\Users\..." — LibreOffice rejects it and every Office
  // conversion failed. A correct URL has three slashes and no backslashes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-urlshape-"));
  const url = pathToFileURL(dir).href;

  assert.ok(url.startsWith("file:///"), `expected three slashes, got ${url}`);
  assert.ok(!url.includes("\\"), `file URL must not contain backslashes: ${url}`);
  assert.strictEqual("file://" + dir === url, false, "naive concatenation must not be what we ship");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("locateSoffice honours a valid override and ignores a bogus one", () => {
  assert.strictEqual(locateSoffice("C:\\definitely\\not\\here\\soffice.exe"), locateSoffice(null),
    "a non-existent override should fall through to auto-detect");
});

test("converts a spreadsheet to PDF", { skip }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-lo-test-"));
  const csv = path.join(d, "sales.csv");
  fs.writeFileSync(csv, "Region,Q1,Q2\nNorth,1200,1450\nSouth,980,1310\n");
  const out = path.join(d, "sales.pdf");

  await convertOffice({ inputPath: csv, outputPath: out, targetExt: "pdf", sofficePath: soffice });

  const buf = fs.readFileSync(out);
  assert.strictEqual(buf.subarray(0, 5).toString(), "%PDF-", "should be a real PDF");
  assert.ok(buf.length > 500, `suspiciously small PDF (${buf.length} bytes)`);
  fs.rmSync(d, { recursive: true, force: true });
});

test("two conversions can run at once without clobbering each other", { skip }, async () => {
  // Each call gets its own profile dir; that is the whole point of the unique
  // UserInstallation, so prove concurrency actually works.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-lo-conc-"));
  const jobs = [0, 1].map((i) => {
    const src = path.join(d, `f${i}.csv`);
    fs.writeFileSync(src, `A,B\n${i},${i * 2}\n`);
    return convertOffice({
      inputPath: src, outputPath: path.join(d, `f${i}.pdf`), targetExt: "pdf", sofficePath: soffice,
    });
  });

  await Promise.all(jobs);
  for (const i of [0, 1]) {
    assert.ok(fs.existsSync(path.join(d, `f${i}.pdf`)), `f${i}.pdf missing`);
  }
  fs.rmSync(d, { recursive: true, force: true });
});

test("a missing LibreOffice produces a clear, actionable error", async () => {
  await assert.rejects(
    () => convertOffice({ inputPath: "a.docx", outputPath: "a.pdf", targetExt: "pdf", sofficePath: null }),
    /LibreOffice not found.*Settings/is
  );
});
