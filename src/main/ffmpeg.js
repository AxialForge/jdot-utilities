// FFmpeg sidecar — video and audio conversion. A single self-contained binary
// bundled in resources/bin, so this needs no install and runs fully offline
// (ffmpeg makes no network calls for local files, and we only ever hand it local
// paths).
//
// Hardware acceleration: when enabled we pass `-hwaccel auto`, which accelerates
// *decoding* on capable machines and silently falls back to software if the GPU
// path is unavailable. Encoding stays on the software encoders (libx264, VP9,
// …) because hardware *encoders* (nvenc/qsv/amf) are the fragile, driver- and
// GPU-specific part; decode acceleration is the safe speedup. As an extra
// belt-and-braces, a run that fails with hwaccel on is retried in pure software.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? "ffmpeg.exe" : "ffmpeg";

function firstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}
function onPath() {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  return firstExisting(dirs.map((d) => d && path.join(d, EXE)));
}
// Bundled copy first (packaged: resources/bin; from source: project resources/bin
// — so npm test uses it), then PATH.
function locateFfmpeg(override) {
  if (override && fs.existsSync(override)) return override;
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "bin", EXE) : null;
  const dev = path.join(__dirname, "..", "..", "resources", "bin", EXE);
  return firstExisting([packaged, dev]) || onPath();
}
const hasFfmpeg = (override) => Boolean(locateFfmpeg(override));

// Curated format sets. Reading is generous (ffmpeg reads almost anything);
// writing is the tidy common set.
const VIDEO = new Set(["mp4", "mkv", "mov", "webm", "avi", "gif", "m4v", "mpg", "mpeg", "wmv", "flv"]);
const AUDIO = new Set(["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff"]);
const isVideoExt = (e) => VIDEO.has(String(e || "").toLowerCase());
const isAudioExt = (e) => AUDIO.has(String(e || "").toLowerCase());

// Quality knob -> per-codec settings. One label the user picks; applied as CRF
// for video and as a target bitrate for lossy audio (ignored for wav/flac).
const VIDEO_CRF = { High: 18, Balanced: 23, Small: 28 };
const AUDIO_KBPS = { High: 256, Balanced: 192, Small: 128 };
const crfOf = (q) => VIDEO_CRF[q] ?? VIDEO_CRF.Balanced;
const kbpsOf = (q) => AUDIO_KBPS[q] ?? AUDIO_KBPS.Balanced;

// Audio codec args for a given audio target (and for a video's audio track).
function audioArgs(to, q) {
  const b = `${kbpsOf(q)}k`;
  switch (to) {
    case "mp3": return ["-c:a", "libmp3lame", "-b:a", b];
    case "aac":
    case "m4a": return ["-c:a", "aac", "-b:a", b];
    case "ogg": return ["-c:a", "libvorbis", "-b:a", b];
    case "opus": return ["-c:a", "libopus", "-b:a", b];
    case "wav": return ["-c:a", "pcm_s16le"]; // lossless PCM
    case "flac": return ["-c:a", "flac"]; // lossless
    default: return ["-c:a", "aac", "-b:a", b];
  }
}

// Video codec args per container, plus the audio track for that container.
function videoArgs(to, q) {
  const crf = String(crfOf(q));
  switch (to) {
    case "webm":
      return ["-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0", "-c:a", "libopus", "-b:a", `${kbpsOf(q)}k`];
    case "avi":
      return ["-c:v", "libx264", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "libmp3lame", "-b:a", `${kbpsOf(q)}k`];
    case "mp4":
    case "mov":
    case "m4v":
      return ["-c:v", "libx264", "-crf", crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", `${kbpsOf(q)}k`];
    case "mkv":
    default:
      return ["-c:v", "libx264", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${kbpsOf(q)}k`];
  }
}

/** Build the ffmpeg argument list for one conversion. */
function buildArgs({ inputPath, outputPath, to, quality, hwaccel }) {
  const args = ["-hide_banner", "-loglevel", "error", "-stats", "-y"];
  if (hwaccel) args.push("-hwaccel", "auto"); // decode acceleration, auto-fallback
  args.push("-i", inputPath);

  const target = String(to || "").toLowerCase();
  if (isAudioExt(target)) {
    args.push("-vn", ...audioArgs(target, quality)); // audio-only (also = extract soundtrack)
  } else if (target === "gif") {
    // A palette pass would be nicer, but a single filtergraph keeps it one command
    // and is plenty for typical clips.
    args.push("-an", "-vf", "fps=12,scale=480:-1:flags=lanczos");
  } else {
    args.push(...videoArgs(target, quality));
  }
  args.push(outputPath);
  return args;
}

const HMS = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/;
const toSeconds = (m) => (m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);

// Run ffmpeg once, streaming stderr to report progress against the input's
// duration (which ffmpeg prints, and which we also probe up front).
function runOnce(ffmpegPath, args, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled"));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let dur = 0;
    let tail = "";
    const onAbort = () => child.kill();
    signal?.addEventListener?.("abort", onAbort, { once: true });

    child.stderr.on("data", (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (!dur) {
        const dm = /Duration:\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(s);
        if (dm) dur = toSeconds(HMS.exec(dm[1]));
      }
      const tm = /time=\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(s);
      if (tm && dur > 0 && onProgress) {
        onProgress(Math.max(0, Math.min(1, toSeconds(HMS.exec(tm[1])) / dur)));
      }
    });
    child.on("error", (err) => { signal?.removeEventListener?.("abort", onAbort); reject(err); });
    child.on("close", (code) => {
      signal?.removeEventListener?.("abort", onAbort);
      if (signal?.aborted) return reject(new Error("Cancelled"));
      if (code === 0) resolve();
      else reject(new Error(tail.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * Convert one media file. `from`/`to` are file extensions. When hwaccel is on
 * and the accelerated run fails, it retries once in pure software.
 */
async function convertWithFfmpeg({ ffmpegPath, inputPath, outputPath, to, quality, hwaccel = false, signal, onProgress }) {
  try {
    await runOnce(ffmpegPath, buildArgs({ inputPath, outputPath, to, quality, hwaccel }), { signal, onProgress });
  } catch (err) {
    if (hwaccel && !signal?.aborted) {
      // Fall back to software — hardware decode can trip on some inputs/drivers.
      await runOnce(ffmpegPath, buildArgs({ inputPath, outputPath, to, quality, hwaccel: false }), { signal, onProgress });
    } else {
      throw err;
    }
  }
  if (!fs.existsSync(outputPath)) throw new Error("ffmpeg produced no output.");
}

module.exports = {
  locateFfmpeg, hasFfmpeg, convertWithFfmpeg, buildArgs, runOnce,
  isVideoExt, isAudioExt, VIDEO, AUDIO,
};
