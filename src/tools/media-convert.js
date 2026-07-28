// Video & Audio — the ffmpeg-backed converter(s). Category "Media" puts these
// under the top-level "Video & Audio" tab (the same data-driven routing that
// sends PDF-category tools to PDF Tools).
//
// This file exports TWO descriptors — a "Video" side tab and an "Audio" side tab
// — so the visual and the sound conversions are separated. The split is by
// OUTPUT: Video produces visual output (video or animated GIF); Audio produces
// sound output, which also makes it the natural home for "extract the audio from
// a video" (a video in, an audio file out). The conversion itself is identical
// (ffmpeg figures out audio vs video from the output extension), so both share
// one convert().
//
// ffmpeg is bundled (resources/bin), so this needs no install and is offline; no
// requiresEngine.

const { locateFfmpeg, convertWithFfmpeg } = require("../main/ffmpeg");

const VIDEO_IN = ["mp4", "mkv", "mov", "webm", "avi", "gif", "m4v", "mpg", "mpeg", "wmv", "flv"];
const AUDIO_IN = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma"];
const VIDEO_OUT = ["mp4", "mkv", "mov", "webm", "avi", "gif"];
const AUDIO_OUT = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus"];
// A GIF carries no soundtrack, so it isn't a valid source for the Audio tool.
const VIDEO_WITH_AUDIO = VIDEO_IN.filter((f) => f !== "gif");

// Same-format no-ops to hide (only matters when a format is both an input and an
// output of that tool).
function identity(formats, inputs) {
  const ex = {};
  for (const f of formats) if (inputs.includes(f)) ex[f] = [f];
  return ex;
}

const QUALITY = {
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
};

// Whether to let ffmpeg use GPU decode, from the app's hardware-acceleration
// setting. Best-effort: any failure (or running outside the app) means software.
function hwFromSettings() {
  try {
    return require("../main/settings").readSync().hardwareAcceleration !== "off";
  } catch {
    return false;
  }
}

async function convert({ inputPath, outputPath, outputFormat, options, signal, onProgress }) {
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
}

module.exports = [
  {
    id: "video-convert",
    name: "Video",
    category: "Media",
    description:
      "Convert video — MP4, MKV, MOV, WebM, AVI — or turn a clip into an animated GIF. Bundled (ffmpeg) and fully offline. (To pull the sound out of a video, use the Audio tab.)",
    inputFormats: VIDEO_IN,
    outputFormats: VIDEO_OUT,
    excludePairs: identity(VIDEO_OUT, VIDEO_IN),
    options: [QUALITY],
    convert,
  },
  {
    id: "audio-convert",
    name: "Audio",
    category: "Media",
    description:
      "Convert audio — MP3, WAV, FLAC, AAC, M4A, OGG, Opus — or extract the soundtrack from a video. Bundled (ffmpeg) and fully offline.",
    // Video sources are accepted here so you can extract their audio; a GIF has
    // no soundtrack, so it's left out.
    inputFormats: [...VIDEO_WITH_AUDIO, ...AUDIO_IN],
    outputFormats: AUDIO_OUT,
    excludePairs: identity(AUDIO_OUT, AUDIO_IN),
    options: [QUALITY],
    convert,
  },
];
