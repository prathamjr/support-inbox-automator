#!/usr/bin/env node
/**
 * Turns the daily support run on or off on this computer.
 *   node scripts/scheduler.mjs install          run run.mjs at config.runTime on config.runDays
 *   node scripts/scheduler.mjs status           is it scheduled? last runs?
 *   node scripts/scheduler.mjs remove           stop the daily run
 *   node scripts/scheduler.mjs pause [today|permanent]   skip runs (today only, or until resumed)
 *   node scripts/scheduler.mjs resume           undo a pause
 * macOS: a LaunchAgent. Windows: a Task Scheduler task. Linux: a crontab line.
 * The computer must be on and logged in at run time. A Mac that is asleep runs it when it wakes up.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ENGINE_DIR, LOG_DIR, FILES, loadConfig, dayKey } from "../lib/config.mjs";

const cmd = process.argv[2] ?? "status";
const config = loadConfig();
const [hour, minute] = config.runTime.split(":").map(Number);
const DAYNUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const node = process.execPath;
const script = path.join(ENGINE_DIR, "run.mjs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const daily = path.join(LOG_DIR, "scheduler.log");
const run = (bin, args) => { try { return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const LABEL = "com.support-inbox-automator.daily";
const TASK = "SupportInboxAutomator";
const claudeDir = config.claudePath && path.isAbsolute(config.claudePath) ? path.dirname(config.claudePath) : null;

function lastRuns() {
  if (!fs.existsSync(FILES.runIndex)) return "no runs yet";
  return fs.readFileSync(FILES.runIndex, "utf8").trim().split("\n").slice(-5).join("\n");
}

if (cmd === "pause") {
  const what = (process.argv[3] ?? "today").toLowerCase();
  fs.writeFileSync(FILES.pause, what === "permanent" ? "PERMANENT\n" : `${dayKey(Date.now(), config.timezone)}\n`);
  console.log(what === "permanent" ? "✓ Paused until you resume it" : "✓ Paused for today only");
  process.exit(0);
}
if (cmd === "resume") {
  fs.rmSync(FILES.pause, { force: true });
  console.log("✓ Resumed");
  process.exit(0);
}

if (!claudeDir && cmd === "install") console.log("⚠ claudePath is not an absolute path yet: run `node check.mjs claude` first so the scheduled run can find Claude Code.");

if (process.platform === "darwin") {
  const plist = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
  const uid = process.getuid();
  if (cmd === "install") {
    const intervals = config.runDays.map((d) => `    <dict><key>Weekday</key><integer>${DAYNUM[d.slice(0, 3)]}</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`).join("\n");
    const PATH = [path.dirname(node), claudeDir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string></array>
  <key>WorkingDirectory</key><string>${ENGINE_DIR}</string>
  <key>StartCalendarInterval</key><array>
${intervals}
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string><key>HOME</key><string>${os.homedir()}</string></dict>
  <key>StandardOutPath</key><string>${daily}</string>
  <key>StandardErrorPath</key><string>${daily}</string>
</dict></plist>
`);
    run("launchctl", ["bootout", `gui/${uid}`, plist]);
    const r = run("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    console.log(r.trim() ? `launchctl said: ${r.trim()}` : `✓ Scheduled: ${config.runDays.join(", ")} at ${config.runTime} (macOS LaunchAgent ${LABEL})`);
  } else if (cmd === "remove") {
    run("launchctl", ["bootout", `gui/${uid}`, plist]);
    fs.rmSync(plist, { force: true });
    console.log("✓ Daily run removed");
  } else {
    const loaded = run("launchctl", ["print", `gui/${uid}/${LABEL}`]);
    console.log(fs.existsSync(plist) && !/Could not find/.test(loaded) ? `✓ Scheduled (${config.runDays.join(", ")} at ${config.runTime})` : "✗ Not scheduled");
  }
} else if (process.platform === "win32") {
  const days = config.runDays.map((d) => d.slice(0, 3).toUpperCase()).join(",");
  if (cmd === "install") {
    const action = `cmd /c ""${node}" "${script}" >> "${daily}" 2>&1"`;
    const r = run("schtasks", ["/Create", "/TN", TASK, "/SC", "WEEKLY", "/D", days, "/ST", config.runTime, "/TR", action, "/F"]);
    console.log(/SUCCESS/i.test(r) ? `✓ Scheduled: ${days} at ${config.runTime} (Task Scheduler "${TASK}")` : r);
  } else if (cmd === "remove") {
    console.log(run("schtasks", ["/Delete", "/TN", TASK, "/F"]));
  } else {
    const q = run("schtasks", ["/Query", "/TN", TASK, "/FO", "LIST"]);
    console.log(/TaskName/i.test(q) ? `✓ Scheduled (${days} at ${config.runTime})` : "✗ Not scheduled");
  }
} else {
  const PATH = [path.dirname(node), claudeDir, "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":");
  const line = `${minute} ${hour} * * ${config.runDays.map((d) => DAYNUM[d.slice(0, 3)]).join(",")} cd "${ENGINE_DIR}" && PATH="${PATH}" "${node}" run.mjs >> "${daily}" 2>&1 # support-inbox-automator`;
  const current = run("crontab", ["-l"]).split("\n").filter((l) => l && !l.includes("# support-inbox-automator") && !/no crontab/i.test(l));
  if (cmd === "install" || cmd === "remove") {
    const tmp = path.join(os.tmpdir(), "sia-cron");
    fs.writeFileSync(tmp, [...current, ...(cmd === "install" ? [line] : [])].join("\n") + "\n");
    run("crontab", [tmp]);
    console.log(cmd === "install" ? `✓ Scheduled: ${line}` : "✓ Daily run removed");
  } else {
    console.log(run("crontab", ["-l"]).includes("# support-inbox-automator") ? "✓ Scheduled" : "✗ Not scheduled");
  }
}
if (cmd === "status") {
  const p = fs.existsSync(FILES.pause) ? fs.readFileSync(FILES.pause, "utf8").trim() : "";
  if (p) console.log(`⏸ Paused: ${p === "PERMANENT" ? "until resumed" : p}`);
  console.log(`Last runs:\n${lastRuns()}`);
}
