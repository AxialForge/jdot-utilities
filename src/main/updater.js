// Manual, user-initiated update check — the ONLY code path in the whole app that
// ever touches the network.
//
// jdot-utilities' promise is that it is fully offline: no telemetry, no accounts,
// works with the cable unplugged. An automatic updater would quietly break that,
// and to a privacy-minded user a background "version check" is indistinguishable
// from telemetry. So there is deliberately NO check on launch, NO interval, and
// NOTHING downloads without a click:
//   - the network is touched only when the user presses "Check for updates",
//   - a new version downloads only after the user presses "Download",
//   - it installs only after the user presses "Restart & install".
//
// Under the hood this drives electron-updater against the GitHub release (see the
// `publish` block in electron-builder.yml). The security chain is: HTTPS to
// GitHub (transport), the SHA-512 in latest.yml checked against the downloaded
// installer (integrity), and — once the app is code-signed — an Authenticode
// publisher match before anything runs (authenticity). Unsigned, that last check
// is skipped, so an unsigned build trusts "nobody has compromised the GitHub
// release". That is why this ships manual-only and never auto-installs.

// electron-updater reads app.getVersion() at import, so it can only be required
// inside Electron. Loaded lazily in configure() — never at module scope — so the
// pure comparator below stays usable (and testable) in plain node, and `npm test`
// doesn't need an Electron runtime.
let autoUpdater = null;

// ── version comparison ─────────────────────────────────────────
// electron-updater compares versions itself, but a tiny, tested comparator lets
// the UI state a clear "you're up to date / vX is newer", and lets us refuse an
// "update-available" whose offered version isn't actually higher — a cheap guard
// against a misconfigured or rolled-back feed handing us an older build.

/** Parse "1.2.3", "v1.2.3", "1.2.3-beta.4" into { nums:[1,2,3], pre:"beta.4" }. */
function parseVersion(v) {
  const cleaned = String(v == null ? "" : v).trim().replace(/^v/i, "");
  const [core, ...preParts] = cleaned.split("-");
  const nums = core.split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
  while (nums.length < 3) nums.push(0);
  return { nums: nums.slice(0, 3), pre: preParts.join("-") };
}

/**
 * Compare two semantic versions. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * A pre-release (1.0.0-beta) is LOWER than its release (1.0.0), per semver.
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] > pb.nums[i]) return 1;
    if (pa.nums[i] < pb.nums[i]) return -1;
  }
  // Cores equal. No pre-release outranks having one.
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre > pb.pre ? 1 : -1; // lexical is good enough for our tags
}

/** Is `candidate` strictly newer than `current`? */
const isNewer = (candidate, current) => compareVersions(candidate, current) > 0;

// ── the updater ────────────────────────────────────────────────

let wired = false;
let emit = () => {};

function configure() {
  if (wired) return;
  ({ autoUpdater } = require("electron-updater")); // Electron-only; see note at top
  wired = true;

  autoUpdater.autoDownload = false; // never fetch a build without an explicit click
  autoUpdater.autoInstallOnAppQuit = false; // and never install one silently
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.fullChangelog = false;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) => emit({ state: "available", version: info?.version || null }));
  autoUpdater.on("update-not-available", (info) => emit({ state: "current", version: info?.version || null }));
  autoUpdater.on("download-progress", (p) =>
    emit({ state: "downloading", percent: Math.round(p?.percent || 0) })
  );
  autoUpdater.on("update-downloaded", (info) => emit({ state: "downloaded", version: info?.version || null }));
  autoUpdater.on("error", (err) =>
    emit({ state: "error", message: friendlyError(err) })
  );
}

// electron-updater's raw errors are developer-facing; translate the common ones.
function friendlyError(err) {
  const msg = (err && err.message ? err.message : String(err)) || "Update check failed.";
  if (/not packed|dev update config/i.test(msg)) {
    return "Updates only work in the installed app, not when running from source.";
  }
  if (/net::|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return "Couldn't reach GitHub — check your internet connection and try again.";
  }
  if (/404|no published versions|latest\.yml/i.test(msg)) {
    return "No update information was found for this release.";
  }
  return msg.split("\n")[0].slice(0, 200);
}

/** Set the callback that forwards updater events to the renderer. */
function onStatus(cb) {
  emit = typeof cb === "function" ? cb : () => {};
}

/** User pressed "Check for updates". The one network call the app makes. */
async function check() {
  configure();
  // When running unpacked (from source), electron-updater silently no-ops:
  // checkForUpdates() resolves but emits NO event, so the UI would hang on
  // "Checking…" forever. Say so plainly instead of leaving it spinning.
  if (!autoUpdater.isUpdaterActive()) {
    emit({ state: "error", message: "Updates only work in the installed app, not when running from source." });
    return { ok: false, error: "not-packaged" };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    // checkForUpdates resolves with the info even when no event has fired yet;
    // fall through to events for state, but surface a hard failure here.
    return { ok: true, version: res?.updateInfo?.version || null };
  } catch (err) {
    emit({ state: "error", message: friendlyError(err) });
    return { ok: false, error: friendlyError(err) };
  }
}

/** User pressed "Download" after an update was found. */
async function download() {
  configure();
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    emit({ state: "error", message: friendlyError(err) });
    return { ok: false, error: friendlyError(err) };
  }
}

/** User pressed "Restart & install". Quits and runs the downloaded installer. */
function install() {
  configure();
  // isSilent:false shows the installer UI; isForceRunAfter relaunches the app.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
}

module.exports = { configure, onStatus, check, download, install, compareVersions, isNewer, parseVersion };
