// Hardware-acceleration / GPU safety decisions, kept pure so they can be tested
// without booting Electron.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// On some Windows machines — outdated or broken GPU drivers, virtual machines,
// and remote-desktop sessions — an accelerated Electron window opens but never
// becomes interactive: the app "launches, but nothing is clickable and nothing
// works". The Settings screen has a toggle to turn hardware acceleration off,
// but a first-run user whose whole UI is frozen can't reach it. So the app needs
// two things this module decides:
//   1. a no-UI escape hatch to launch without acceleration (a command-line flag
//      or an environment variable), and
//   2. a rule for when a launch-time override should be remembered, so the next
//      normal launch stays in the working (software-rendered) mode.
// main.js also auto-recovers at runtime: if the GPU process itself crashes or the
// window hangs during startup, it persists acceleration = "off" and relaunches.

// Command-line flags / env var that force software rendering with no UI needed.
// `--disable-gpu` is Electron's own flag; we honor it explicitly too so the
// decision (and any persistence) is in one place.
const SAFE_MODE_FLAGS = ["--safe-mode", "--disable-gpu"];
const SAFE_MODE_ENV = "JDOT_DISABLE_GPU";

/**
 * Should this launch run without hardware acceleration?
 * @param {{ setting?: string, argv?: string[], env?: object }} ctx
 *   setting: the persisted `hardwareAcceleration` value ("auto"|"on"|"off").
 */
function shouldDisableGpu({ setting, argv = [], env = {} } = {}) {
  if (setting === "off") return true;
  if (env[SAFE_MODE_ENV]) return true;
  return SAFE_MODE_FLAGS.some((f) => argv.includes(f));
}

/**
 * Was software rendering requested via an explicit user escape hatch (not just
 * the stored setting)? Such a request is worth persisting so the machine keeps
 * launching in the mode that actually works. `--disable-gpu` is treated as a
 * one-off (it's a generic Electron flag), while `--safe-mode` and the env var
 * are ours and intended to stick.
 */
function isPersistentSafeMode({ argv = [], env = {} } = {}) {
  return argv.includes("--safe-mode") || Boolean(env[SAFE_MODE_ENV]);
}

module.exports = { shouldDisableGpu, isPersistentSafeMode, SAFE_MODE_FLAGS, SAFE_MODE_ENV };
