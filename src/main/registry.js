// Auto-discovers utilities. Any *.js in ../tools (except names starting with "_")
// that exports a valid descriptor becomes an available utility. This is what makes
// "add a utility later" a one-file operation.
//
// THE THREE KINDS
// ---------------
// A utility declares how its files flow, which is all the UI and the runner need
// to drive it. Everything else about a utility is its own business.
//
//   kind: "convert"  N files in -> N files out, one output per input.
//                    Implements: async convert({ inputPath, outputPath,
//                    outputFormat, options, signal, onProgress })
//
//   kind: "collect"  N files in -> 1 file out. Merge, images->PDF, zip.
//                    Implements: async run({ inputPaths, outputPath, options,
//                    signal, onProgress }) -> { warnings?, ...info }
//                    Set `ordered: true` when input order is meaningful, and the
//                    UI offers reordering.
//
//   kind: "explode"  1 file in -> N files out. Split, PDF->images, unzip.
//                    Implements: async run({ inputPath, outputDir, options,
//                    signal, onProgress }) -> { outputs: [path, ...], warnings? }
//
// "convert" is the default so existing converters need no changes.

const fs = require("node:fs");
const path = require("node:path");
const { isEngine } = require("./engines");

const TOOLS_DIR = path.join(__dirname, "..", "tools");
const KINDS = ["convert", "collect", "explode"];

function kindOf(tool) {
  return typeof tool?.kind === "string" ? tool.kind.toLowerCase() : "convert";
}

// Returns null when valid, or a string explaining what is wrong. Callers log it,
// so a malformed tool tells you why it was skipped instead of vanishing.
function validate(tool) {
  if (!tool || typeof tool !== "object") return "not an object";
  if (typeof tool.id !== "string" || !tool.id) return "missing id";
  if (typeof tool.name !== "string" || !tool.name) return "missing name";

  const kind = kindOf(tool);
  if (!KINDS.includes(kind)) return `unknown kind "${tool.kind}" (expected ${KINDS.join("/")})`;

  if (!Array.isArray(tool.inputFormats) || tool.inputFormats.length === 0) {
    return "inputFormats must be a non-empty array";
  }
  if (!Array.isArray(tool.outputFormats) || tool.outputFormats.length === 0) {
    return "outputFormats must be a non-empty array";
  }

  if (kind === "convert") {
    if (typeof tool.convert !== "function") return 'kind "convert" needs a convert() function';
  } else if (typeof tool.run !== "function") {
    return `kind "${kind}" needs a run() function`;
  }
  return null;
}

function loadTools() {
  const tools = new Map();
  let files = [];
  try {
    files = fs.readdirSync(TOOLS_DIR);
  } catch (err) {
    console.error("Could not read tools directory:", err.message);
    return tools;
  }

  for (const file of files) {
    if (!file.endsWith(".js") || file.startsWith("_")) continue;
    const full = path.join(TOOLS_DIR, file);
    try {
      const mod = require(full);
      const descriptors = Array.isArray(mod) ? mod : [mod];
      for (const tool of descriptors) {
        const problem = validate(tool);
        if (problem) {
          console.warn(`Skipping a descriptor in ${file}: ${problem}.`);
          continue;
        }
        if (tools.has(tool.id)) {
          console.warn(`Skipping ${file}: duplicate tool id "${tool.id}".`);
          continue;
        }
        tools.set(tool.id, tool);
      }
    } catch (err) {
      console.error(`Failed to load tool ${file}:`, err.message);
    }
  }
  return tools;
}

// A JSON-safe view for the renderer (strips convert()/run()).
function describe(tool) {
  const kind = kindOf(tool);
  return {
    id: tool.id,
    name: tool.name,
    kind,
    category: tool.category || "Other",
    description: tool.description || "",
    inputFormats: tool.inputFormats.map((f) => String(f).toLowerCase()),
    outputFormats: tool.outputFormats.map((f) => String(f).toLowerCase()),
    // Optional { inputFormat: [outputFormat, ...] } map of pairs the UI must not
    // offer, for tools whose input x output cross-product contains nonsense pairs
    // (same-format "conversions", lossy round-trips). Normalized to lowercase.
    excludePairs: normalizeExcludes(tool.excludePairs),
    // collect only: input order is meaningful, so the UI offers reordering.
    ordered: kind === "collect" ? Boolean(tool.ordered) : false,
    // collect/explode: minimum inputs before the action is allowed.
    minInputs: Number.isInteger(tool.minInputs) ? tool.minInputs : kind === "collect" ? 2 : 1,
    // Default filename stem the save dialog offers (collect only).
    defaultName: typeof tool.defaultName === "string" ? tool.defaultName : null,
    // Optional id of an external engine this tool shells out to ("libreoffice",
    // "ghostscript"). The UI warns before the user picks files rather than
    // letting the conversion fail at the end. Unknown ids are dropped so a typo
    // can't produce a warning that never resolves.
    requiresEngine: isEngine(tool.requiresEngine) ? tool.requiresEngine : null,
    options: tool.options || [],
  };
}

function normalizeExcludes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [from, tos] of Object.entries(raw)) {
    if (!Array.isArray(tos)) continue;
    out[String(from).toLowerCase()] = tos.map((t) => String(t).toLowerCase());
  }
  return out;
}

module.exports = { loadTools, describe, validate, kindOf, KINDS };
