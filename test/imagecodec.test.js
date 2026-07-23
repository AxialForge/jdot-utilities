const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { encodeBmp, decodeBmp, isBmp } = require("../src/main/bmp");
const { encodeIco, decodeIco, listIcoFrames, isIco } = require("../src/main/ico");
const tool = require("../src/tools/image-convert");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-img-"));
}

// A small RGB image with distinct corners, so orientation errors are obvious.
function swatch(width = 5, height = 3) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      data[i] = (x * 40) % 256;
      data[i + 1] = (y * 80) % 256;
      data[i + 2] = 200;
    }
  }
  return { data, width, height, channels: 3 };
}

// ── BMP ────────────────────────────────────────────────────────

test("BMP round-trips pixel-exactly, including orientation", () => {
  const src = swatch(5, 3);
  const out = decodeBmp(encodeBmp(src));
  assert.strictEqual(out.width, 5);
  assert.strictEqual(out.height, 3);
  for (let p = 0; p < 15; p += 1) {
    assert.strictEqual(out.data[p * 4], src.data[p * 3], `red mismatch at px ${p}`);
    assert.strictEqual(out.data[p * 4 + 1], src.data[p * 3 + 1], `green mismatch at px ${p}`);
    assert.strictEqual(out.data[p * 4 + 2], src.data[p * 3 + 2], `blue mismatch at px ${p}`);
    assert.strictEqual(out.data[p * 4 + 3], 255, "should be opaque");
  }
});

test("BMP encodes a valid header at the right size", () => {
  const buf = encodeBmp(swatch(5, 3));
  assert.ok(isBmp(buf));
  assert.strictEqual(buf.toString("latin1", 0, 2), "BM");
  assert.strictEqual(buf.readUInt32LE(2), buf.length, "file size field must match");
  assert.strictEqual(buf.readUInt16LE(28), 24, "24 bpp");
  assert.strictEqual(buf.readUInt32LE(30), 0, "BI_RGB, uncompressed");
  // 5 px * 3 bytes = 15, padded to 16 per row.
  assert.strictEqual(buf.length, 54 + 16 * 3);
});

test("BMP flattens alpha onto white rather than writing unreliable 32-bit alpha", () => {
  // One fully transparent red pixel.
  const src = { data: Buffer.from([255, 0, 0, 0]), width: 1, height: 1, channels: 4 };
  const out = decodeBmp(encodeBmp(src));
  assert.deepStrictEqual([out.data[0], out.data[1], out.data[2]], [255, 255, 255], "transparent -> white");
});

test("BMP decodes a top-down (negative height) file", () => {
  const buf = encodeBmp(swatch(4, 2));
  const bottomUp = decodeBmp(buf);
  // Flip to top-down in place: negate height and reverse the row order.
  const rowSize = ((4 * 3 + 3) >> 2) << 2;
  const flipped = Buffer.from(buf);
  flipped.writeInt32LE(-2, 22);
  for (let y = 0; y < 2; y += 1) buf.copy(flipped, 54 + y * rowSize, 54 + (1 - y) * rowSize, 54 + (2 - y) * rowSize);
  assert.deepStrictEqual(decodeBmp(flipped).data, bottomUp.data, "top-down must decode identically");
});

test("BMP decoder rejects junk and RLE with clear messages", () => {
  assert.throws(() => decodeBmp(Buffer.from("not a bitmap at all")), /Not a BMP/i);
  const rle = encodeBmp(swatch(2, 2));
  rle.writeUInt32LE(1, 30); // BI_RLE8
  assert.throws(() => decodeBmp(rle), /RLE/i);
});

test("BMP decodes an 8-bit palette image", () => {
  // 2x1, palette of 2 colours, indices [1, 0].
  const dib = 40, palette = 2 * 4, rowSize = 4;
  const buf = Buffer.alloc(14 + dib + palette + rowSize);
  buf.write("BM", 0, "latin1");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(14 + dib + palette, 10);
  buf.writeUInt32LE(dib, 14);
  buf.writeInt32LE(2, 18);
  buf.writeInt32LE(1, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(8, 28);
  buf.writeUInt32LE(2, 46); // clrUsed
  const pal = 14 + dib;
  buf[pal] = 10; buf[pal + 1] = 20; buf[pal + 2] = 30; // BGR -> rgb(30,20,10)
  buf[pal + 4] = 40; buf[pal + 5] = 50; buf[pal + 6] = 60; // rgb(60,50,40)
  const px = pal + palette;
  buf[px] = 1; buf[px + 1] = 0;

  const out = decodeBmp(buf);
  assert.deepStrictEqual([...out.data.subarray(0, 3)], [60, 50, 40]);
  assert.deepStrictEqual([...out.data.subarray(4, 7)], [30, 20, 10]);
});

// ── ICO ────────────────────────────────────────────────────────

async function png(size) {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
    .png()
    .toBuffer();
}

test("ICO writes a directory that reads back with every frame", async () => {
  const sizes = [16, 32, 256];
  const frames = [];
  for (const s of sizes) frames.push({ size: s, png: await png(s) });
  const ico = encodeIco(frames);

  assert.ok(isIco(ico));
  const listed = listIcoFrames(ico);
  assert.deepStrictEqual(listed.map((f) => f.width), sizes);

  // Every frame's declared slice must sit inside the file and start with a PNG.
  for (const f of listed) {
    assert.ok(f.offset + f.bytes <= ico.length, "frame runs past end of file");
    assert.strictEqual(ico.readUInt32LE(f.offset), 0x474e5089, "frame is not a PNG");
  }
});

test("ICO stores 256 as 0 in the single-byte size field", async () => {
  const ico = encodeIco([{ size: 256, png: await png(256) }]);
  assert.strictEqual(ico[6], 0, "256 must be encoded as 0");
  assert.strictEqual(listIcoFrames(ico)[0].width, 256, "and read back as 256");
});

test("ICO decode returns the largest frame", async () => {
  const ico = encodeIco([
    { size: 16, png: await png(16) },
    { size: 64, png: await png(64) },
  ]);
  const got = decodeIco(ico);
  assert.ok(got.png, "PNG frames should come back as PNG");
  assert.strictEqual((await sharp(got.png).metadata()).width, 64);
});

test("ICO rejects empty and non-icon input", () => {
  assert.throws(() => encodeIco([]), /no frames/i);
  assert.throws(() => decodeIco(Buffer.alloc(32)), /Not an ICO/i);
});

// ── through the actual tool ────────────────────────────────────

const run = (inputPath, outputPath, outputFormat, options = {}) =>
  tool.convert({ inputPath, outputPath, outputFormat, options: { quality: 90, ...options } });

test("tool declares bmp and ico in both directions", () => {
  for (const f of ["bmp", "ico"]) {
    assert.ok(tool.inputFormats.includes(f), `${f} missing from inputs`);
    assert.ok(tool.outputFormats.includes(f), `${f} missing from outputs`);
  }
});

test("tool converts png -> bmp -> png with colour intact", async () => {
  const d = work();
  const srcPng = path.join(d, "a.png");
  await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 220, g: 30, b: 90 } } })
    .png()
    .toFile(srcPng);

  const bmp = path.join(d, "a.bmp");
  await run(srcPng, bmp, "bmp");
  assert.ok(isBmp(fs.readFileSync(bmp)));

  const back = path.join(d, "b.png");
  await run(bmp, back, "png");
  const { data, info } = await sharp(back).raw().toBuffer({ resolveWithObject: true });
  assert.strictEqual(info.width, 8);
  assert.deepStrictEqual([data[0], data[1], data[2]], [220, 30, 90], "colour must survive the round trip");
});

test("tool converts png -> ico with the requested frame sizes", async () => {
  const d = work();
  const srcPng = path.join(d, "a.png");
  await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 10, g: 120, b: 250, alpha: 1 } } })
    .png()
    .toFile(srcPng);

  const ico = path.join(d, "a.ico");
  await run(srcPng, ico, "ico", { icoSizes: "Standard (16, 32, 48, 256)" });
  assert.deepStrictEqual(listIcoFrames(fs.readFileSync(ico)).map((f) => f.width), [16, 32, 48, 256]);
});

test("tool reads an ico back into a normal image", async () => {
  const d = work();
  const srcPng = path.join(d, "a.png");
  await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 5, g: 5, b: 200, alpha: 1 } } })
    .png()
    .toFile(srcPng);
  const ico = path.join(d, "a.ico");
  await run(srcPng, ico, "ico", { icoSizes: "256 only" });

  const out = path.join(d, "back.png");
  await run(ico, out, "png");
  assert.strictEqual((await sharp(out).metadata()).width, 256);
});

test("resize preset downscales and never upscales", async () => {
  const d = work();
  const src = path.join(d, "big.png");
  await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toFile(src);

  const small = path.join(d, "small.png");
  await run(src, small, "png", { resize: "400 px (thumbnail)" });
  assert.strictEqual((await sharp(small).metadata()).width, 400);

  // withoutEnlargement: a preset larger than the source must leave it alone.
  const big = path.join(d, "nope.png");
  await run(src, big, "png", { resize: "3840 px (4K)" });
  assert.strictEqual((await sharp(big).metadata()).width, 1000);
});

test("custom max width overrides the preset", async () => {
  const d = work();
  const src = path.join(d, "big.png");
  await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toFile(src);
  const out = path.join(d, "out.png");
  await run(src, out, "png", { resize: "400 px (thumbnail)", maxWidth: 250 });
  assert.strictEqual((await sharp(out).metadata()).width, 250);
});
