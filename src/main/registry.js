// Auto-discovers tools. Any *.js in ../tools (except names starting with "_")
// that exports a valid descriptor becomes an available tool. This is what makes
// "add a tool later" a one-file operation.

const fs = require("node:fs");
const path = require("node:path");

const TOOLS_DIR = path.join(__dirname, "..", "tools");

function isValid(tool) {
  return (
    tool &&
    typeof tool.id === "string" &&
    typeof tool.name === "string" &&
    Array.isArray(tool.inputFormats) &&
    Array.isArray(tool.outputFormats) &&
    typeof tool.convert === "function"
  );
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
        if (!isValid(tool)) {
          console.warn(`Skipping a descriptor in ${file}: not valid.`);
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

// A JSON-safe view of a tool for the renderer (strips the convert function).
function describe(tool) {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category || "Other",
    description: tool.description || "",
    inputFormats: tool.inputFormats.map((f) => f.toLowerCase()),
    outputFormats: tool.outputFormats.map((f) => f.toLowerCase()),
    // Optional { inputFormat: [outputFormat, ...] } map of pairs the UI must not
    // offer, for tools whose input x output cross-product contains nonsense pairs
    // (same-format "conversions", lossy round-trips). Normalized to lowercase.
    excludePairs: normalizeExcludes(tool.excludePairs),
    options: tool.options || [],
  };
}

function normalizeExcludes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [from, tos] of Object.entries(raw)) {
    if (!Array.isArray(tos)) continue;
    out[from.toLowerCase()] = tos.map((t) => String(t).toLowerCase());
  }
  return out;
}

module.exports = { loadTools, describe };
