// Parse a human page range like "1-3, 5, 8-" into concrete page numbers.
// Shared by split / delete / extract so they all accept the same syntax and
// report the same errors.
//
// Rules:
//  - 1-based and inclusive, the way people count pages in a reader.
//  - Comma- or space-separated terms. "1-3", "5", "8-" (8 to end), "-4" (start
//    to 4), "3-1" (reversed, normalized to 3..1 -> {1,2,3}).
//  - "N-" and "-N" need `total` to resolve; a bare parse can defer that.
//  - Out-of-range numbers are an error, not silently clamped — a user who typed
//    "50" for a 10-page file made a mistake worth surfacing.

function parsePageSpec(spec, total) {
  if (spec == null || String(spec).trim() === "") {
    if (!Number.isInteger(total) || total < 1) throw new Error("No pages.");
    // Empty spec means "all pages".
    return range(1, total);
  }

  const set = new Set();
  const terms = String(spec).split(/[,\s]+/).filter(Boolean);

  for (const term of terms) {
    const m = /^(\d+)?(-)?(\d+)?$/.exec(term);
    if (!m || (!m[1] && !m[3])) throw new Error(`Can't read page term "${term}".`);

    const isRange = Boolean(m[2]);
    let a = m[1] ? Number(m[1]) : null;
    let b = m[3] ? Number(m[3]) : null;

    if (!isRange) {
      // A single number.
      addOne(set, a, total);
      continue;
    }

    // A range. Fill in open ends from `total`.
    if (a == null) a = 1;
    if (b == null) {
      if (!Number.isInteger(total)) throw new Error(`"${term}" needs the page count to resolve.`);
      b = total;
    }
    if (a < 1 || b < 1) throw new Error(`Page numbers start at 1 (got "${term}").`);
    checkMax(a, total, term);
    checkMax(b, total, term);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let p = lo; p <= hi; p += 1) set.add(p);
  }

  return [...set].sort((x, y) => x - y);
}

function addOne(set, n, total) {
  if (n < 1) throw new Error(`Page numbers start at 1 (got "${n}").`);
  checkMax(n, total, String(n));
  set.add(n);
}

function checkMax(n, total, term) {
  if (Number.isInteger(total) && n > total) {
    throw new Error(`Page ${term} is past the end (only ${total} page${total === 1 ? "" : "s"}).`);
  }
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

/**
 * Zero-based page indices (for pdf-lib), given a 1-based spec.
 */
function pageIndices(spec, total) {
  return parsePageSpec(spec, total).map((p) => p - 1);
}

/**
 * The complement: every page in 1..total that the spec does NOT name. Used by
 * "delete pages" (keep everything else).
 */
function complementIndices(spec, total) {
  const drop = new Set(parsePageSpec(spec, total));
  const keep = [];
  for (let p = 1; p <= total; p += 1) if (!drop.has(p)) keep.push(p - 1);
  return keep;
}

module.exports = { parsePageSpec, pageIndices, complementIndices };
