// Video & Audio — the ffmpeg-backed converter. Its category is "Media", which
// puts it under the top-level "Video & Audio" tab (the same data-driven routing
// that sends PDF-category tools to PDF Tools).
//
// One convert tool covers everything: video -> video, audio -> audio,
// video -> audio (extract the soundtrack) and video -> GIF all fall out of the
// input/output matrix. What doesn't make sense — turning audio into video, or
// pulling audio out of a GIF — is hidden via excludePairs.
//
// ffmpeg is bundled (resources/bin), so this needs no install and is offline; no
// requiresEngine.

const path = require("node:path");
const { locateFfmpeg, convertWithFfmpeg } = require("../main/ffmpeg");

const VIDEO_IN = ["mp4", "mkv", "mov", "webm", "avi", "gif", "m4v", "mpg", "mpeg", "wmv", "flv"];
const AUDIO_IN = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma"];
const VIDEO_OUT = ["mp4", "mkv", "mov", "webm", "avi", "gif"];
const AUDIO_OUT = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus"];

// Build the invalid-pair map: audio can't become video/GIF; a GIF has no audio
// to extract; and same-format is a no-op.
function buildExclude() {
  const ex = {};
  const add = (k, vals) => { (ex[k] ||= []).push(...vals); };
  for (const a of AUDIO_IN) add(a, VIDEO_OUT); // audio -> video/gif: impossible
  add("gif", AUDIO_OUT); // gif -> audio: nothing to extract
  for (const f of [...VIDEO_OUT, ...AUDIO_OUT]) add(f, [f]); // hide identity no-ops
  // De-dupe.
  for (const k of Object.keys(ex)) ex[k] = [...new Set(ex[k])];
  return ex;
}

// Whether to let ffmpeg use GPU decode, from the app's hardware-acceleration
// setting. Best-effort: any failure (or running outside the app) means software.
function hwFromSettings() {
  try {
    const mode = require("../main/settings").readSync().hardwareAcceleration;
    return mode !== "off"; // "auto"/"on" -> yes, "off" -> no
  } catch {
    return false;
  }
}

module.exports = {
  id: "media-convert",
  name: "Video & Audio",
  category: "Media",
  description:
    "Convert video and audio — MP4, MKV, MOV, WebM, AVI, animated GIF, plus MP3, WAV, FLAC, AAC, M4A, OGG and Opus. Pull the audio out of a video, or turn a clip into a GIF. Bundled (ffmpeg) and fully offline.",
  inputFormats: [...VIDEO_IN, ...AUDIO_IN],
  outputFormats: [...VIDEO_OUT, ...AUDIO_OUT],
  excludePairs: buildExclude(),
  options: [
    {
      key: "quality",
      label: "Quality",
      type: "select",
      choices: ["High", "Balanced", "Small"],
      default: "Balanced",
      choiceHelp: {
        High: "Best quality, largest file. Video uses a low CRF; audio ~256 kbps.",
        Balanced: "The usual choice — good quality at a sensible size. Audio ~192 kbps.",
        Small: "Smallest file, some quality traded away. Audio ~128 kbps.",
      },
    },
  ],
  // No requiresEngine: ffmpeg is bundled.

  async convert({ inputPath, outputPath, outputFormat, options, signal, onProgress }) {
    const ffmpegPath = locateFfmpeg();
    if (!ffmpegPath) {
      throw new Error("The bundled media engine (ffmpeg) wasn't found. Reinstalling the app should restore it.");
    }
    onProgress?.(0);
    await convertWithFfmpeg({
      ffmpegPath,
      inputPath,
      outputPath,
      to: outputFormat,
      quality: options?.quality || "Balanced",
      hwaccel: hwFromSettings(),
      signal,
      onProgress,
    });
    onProgress?.(1);
    return undefined;
  },
};
