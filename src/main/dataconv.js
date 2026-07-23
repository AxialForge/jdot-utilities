// Structured-data conversion: JSON, YAML, CSV, TSV, XML. Pure JS, fully offline.
//
// Everything is normalized to a plain JS value in the middle, then serialized to
// the target. Two honest limitations, surfaced as warnings rather than hidden:
//  - CSV/TSV are flat tables. A nested object/array can't round-trip through them,
//    so we only emit CSV cleanly from an array of flat records (and warn otherwise).
//  - XML has no native arrays/types; numbers come back as strings on the way in.

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

const norm = (ext) => ({ yml: "yaml", yaml: "yaml", json: "json", csv: "csv", tsv: "tsv", xml: "xml" }[ext] || ext);

// ── parse: text -> value ───────────────────────────────────────
function parseJson(text) {
  return JSON.parse(text);
}
function parseYaml(text) {
  return yaml.load(text);
}
function parseDelimited(text, delim) {
  const rows = parseCsvRows(text, delim).filter((r) => r.length && !(r.length === 1 && r[0] === ""));
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = coerce(cells[i] ?? ""); });
    return obj;
  });
}
function parseXml(text) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: true, trimValues: true });
  return parser.parse(text);
}

// A correct-enough CSV row reader: handles quoted fields, escaped quotes (""),
// embedded commas and newlines. Delimiter is , or \t.
function parseCsvRows(text, delim) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}

// Turn a CSV cell into a number/boolean/null when it clearly is one.
function coerce(v) {
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) { const n = Number(v); if (Number.isFinite(n)) return n; }
  return v;
}

// ── serialize: value -> text (+ warnings) ──────────────────────
function toJson(value) {
  return { text: JSON.stringify(value, null, 2) + "\n", warnings: [] };
}
function toYaml(value) {
  return { text: yaml.dump(value, { lineWidth: 100, noRefs: true }), warnings: [] };
}
function toXml(value) {
  const warnings = [];
  // fast-xml-parser needs a single root. Wrap bare arrays/scalars.
  let root = value;
  if (Array.isArray(value) || typeof value !== "object" || value === null) {
    root = { root: value };
    warnings.push("XML needs a single root element — output was wrapped in <root>.");
  }
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@", format: true, indentBy: "  " });
  return { text: builder.build(root).trimEnd() + "\n", warnings };
}
function toDelimited(value, delim, label) {
  const warnings = [];
  const rows = asRecords(value, warnings);
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc = (v) => {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.includes(delim) || s.includes('"') || s.includes("\n")) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.map(esc).join(delim)];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(delim));
  return { text: lines.join("\n") + "\n", warnings };
}

// Coerce an arbitrary value into an array of flat records for CSV/TSV.
function asRecords(value, warnings) {
  if (Array.isArray(value)) {
    if (value.some((x) => x && typeof x === "object" && !Array.isArray(x))) return value.map((x) => flatish(x, warnings));
    return value.map((x, i) => ({ index: i, value: x }));
  }
  if (value && typeof value === "object") {
    // A single object with an obvious array field (e.g. { items: [...] }) -> that array.
    const arrKey = Object.keys(value).find((k) => Array.isArray(value[k]));
    if (arrKey) { warnings.push(`Used the "${arrKey}" array for rows.`); return asRecords(value[arrKey], warnings); }
    return [flatish(value, warnings)];
  }
  warnings.push("Value isn't tabular — wrote a single value column.");
  return [{ value }];
}
function flatish(obj, warnings) {
  if (!obj || typeof obj !== "object") return { value: obj };
  const out = {};
  let nested = false;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") { out[k] = JSON.stringify(v); nested = true; }
    else out[k] = v;
  }
  if (nested && !flatish._warned) { warnings.push("Nested values were JSON-encoded into their cells."); flatish._warned = true; }
  return out;
}

const PARSERS = { json: parseJson, yaml: parseYaml, xml: parseXml, csv: (t) => parseDelimited(t, ","), tsv: (t) => parseDelimited(t, "\t") };
const SERIALIZERS = {
  json: toJson, yaml: toYaml, xml: toXml,
  csv: (v) => toDelimited(v, ",", "csv"), tsv: (v) => toDelimited(v, "\t", "tsv"),
};

async function convertData(inputPath, outputPath, fromExt, toExt) {
  const from = norm(fromExt), to = norm(toExt);
  const parse = PARSERS[from];
  const serialize = SERIALIZERS[to];
  if (!parse) throw new Error(`Unsupported data input: .${from}`);
  if (!serialize) throw new Error(`Unsupported data output: .${to}`);

  const text = await fs.promises.readFile(inputPath, "utf8");
  let value;
  try {
    value = parse(text);
  } catch (err) {
    throw new Error(`Couldn't parse ${path.basename(inputPath)} as ${from.toUpperCase()}: ${err.message}`);
  }
  flatish._warned = false; // reset the once-per-run nested-cell warning
  const { text: out, warnings } = serialize(value);
  await fs.promises.writeFile(outputPath, out, "utf8");
  return { outputPath, warnings: warnings || [] };
}

module.exports = { convertData, PARSERS, SERIALIZERS, coerce };
