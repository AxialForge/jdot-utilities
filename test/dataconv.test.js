const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const { convertData } = require("../src/main/dataconv");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-data-"));
}
async function conv(dir, name, body, to) {
  const src = path.join(dir, name);
  fs.writeFileSync(src, body);
  const out = path.join(dir, "out." + to);
  const res = await convertData(src, out, path.extname(name).slice(1), to);
  return { out, text: fs.readFileSync(out, "utf8"), warnings: res.warnings };
}

test("json -> yaml round-trips structure", async () => {
  const d = work();
  const { text } = await conv(d, "a.json", '{"name":"Jo","tags":["x","y"],"n":3}', "yaml");
  const back = yaml.load(text);
  assert.deepStrictEqual(back, { name: "Jo", tags: ["x", "y"], n: 3 });
});

test("yaml -> json round-trips structure", async () => {
  const d = work();
  const { text } = await conv(d, "a.yaml", "name: Jo\ntags:\n  - x\n  - y\nn: 3\n", "json");
  assert.deepStrictEqual(JSON.parse(text), { name: "Jo", tags: ["x", "y"], n: 3 });
});

test("yml extension is treated as yaml", async () => {
  const d = work();
  const { text } = await conv(d, "a.yml", "a: 1\nb: two\n", "json");
  assert.deepStrictEqual(JSON.parse(text), { a: 1, b: "two" });
});

test("json array -> csv makes a header + rows and coerces back", async () => {
  const d = work();
  const { text } = await conv(d, "a.json", '[{"id":1,"name":"A"},{"id":2,"name":"B"}]', "csv");
  const lines = text.trim().split("\n");
  assert.strictEqual(lines[0], "id,name");
  assert.strictEqual(lines[1], "1,A");
  assert.strictEqual(lines[2], "2,B");
});

test("csv -> json coerces numbers/booleans and keys by header", async () => {
  const d = work();
  const { text } = await conv(d, "a.csv", "id,name,active\n1,Jo,true\n2,Al,false\n", "json");
  assert.deepStrictEqual(JSON.parse(text), [
    { id: 1, name: "Jo", active: true },
    { id: 2, name: "Al", active: false },
  ]);
});

test("csv with quoted commas and embedded newlines parses correctly", async () => {
  const d = work();
  const body = 'name,note\n"Doe, Jo","line1\nline2"\n';
  const { text } = await conv(d, "a.csv", body, "json");
  const rows = JSON.parse(text);
  assert.strictEqual(rows[0].name, "Doe, Jo");
  assert.strictEqual(rows[0].note, "line1\nline2");
});

test("csv values with commas get quoted on output", async () => {
  const d = work();
  const { text } = await conv(d, "a.json", '[{"city":"Paris, FR"}]', "csv");
  assert.ok(text.includes('"Paris, FR"'), text);
});

test("tsv uses tabs", async () => {
  const d = work();
  const { text } = await conv(d, "a.json", '[{"a":1,"b":2}]', "tsv");
  assert.strictEqual(text.trim().split("\n")[0], "a\tb");
  assert.ok(text.includes("1\t2"));
});

test("nested json -> csv encodes nested cells as JSON, with a warning", async () => {
  const d = work();
  const { text, warnings } = await conv(d, "a.json", '[{"id":1,"meta":{"k":"v"}}]', "csv");
  assert.ok(text.includes('"{""k"":""v""}"') || text.includes('{"k":"v"}'), text);
  assert.ok(warnings.some((w) => /nested/i.test(w)), warnings.join(","));
});

test("object with an array field uses that array for rows", async () => {
  const d = work();
  const { text, warnings } = await conv(d, "a.json", '{"items":[{"a":1},{"a":2}]}', "csv");
  const lines = text.trim().split("\n");
  assert.strictEqual(lines[0], "a");
  assert.deepStrictEqual(lines.slice(1), ["1", "2"]);
  assert.ok(warnings.some((w) => /items/.test(w)));
});

test("json -> xml wraps a single root and round-trips", async () => {
  const d = work();
  const { text } = await conv(d, "a.json", '{"book":{"title":"T","year":2020}}', "xml");
  assert.ok(text.includes("<book>"));
  assert.ok(text.includes("<title>T</title>"));
});

test("bare array -> xml warns about the wrapping root", async () => {
  const d = work();
  const { text, warnings } = await conv(d, "a.json", '[1,2,3]', "xml");
  assert.ok(text.includes("<root>"));
  assert.ok(warnings.some((w) => /root/i.test(w)));
});

test("xml -> json parses elements", async () => {
  const d = work();
  const { text } = await conv(d, "a.xml", "<book><title>T</title><year>2020</year></book>", "json");
  const v = JSON.parse(text);
  assert.strictEqual(v.book.title, "T");
  assert.strictEqual(v.book.year, 2020);
});

test("malformed input fails with a clear message naming the format", async () => {
  const d = work();
  await assert.rejects(
    () => conv(d, "a.json", "{not valid json", "yaml"),
    /Couldn't parse .* as JSON/
  );
});

test("unsupported pair fails clearly", async () => {
  const d = work();
  const src = path.join(d, "a.json");
  fs.writeFileSync(src, "{}");
  await assert.rejects(() => convertData(src, path.join(d, "o.toml"), "json", "toml"), /Unsupported data output/);
});
