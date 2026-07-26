/**
 * GapRadar Daily Scheduler
 *
 * Long-lived Bun process that:
 *  - On startup, checks if {generated_at} in daily_report.json is from today.
 *    If not, runs the daily pipeline immediately.
 *  - Schedules the pipeline daily at a configurable time (default 06:00 SAST = 04:00 UTC).
 *  - Logs each run to <DATA_DIR>/pipeline.log.
 *
 * Usage: bun run scripts/scheduler.ts
 */

import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, SITE_ROOT } from "../src/config";

// ── Config ────────────────────────────────────────────────────────────────────

const RUN_HOUR_UTC = 4; // 06:00 SAST
const RUN_MINUTE_UTC = 0;
const REPORT_PATH = resolve(DATA_DIR, "daily_report.json");
const LOG_PATH = resolve(DATA_DIR, "pipeline.log");
const RUNNER = resolve(SITE_ROOT, "scripts/run-daily.sh");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function log(msg: string): Promise<void> {
  const line = `[scheduler] [${new Date().toISOString()}] ${msg}\n`;
  await appendFile(LOG_PATH, line, "utf-8");
  console.log(line.trim());
}

function isToday(isoString: string): boolean {
  const date = new Date(isoString);
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

async function reportExistsForToday(): Promise<boolean> {
  try {
    const raw = await readFile(REPORT_PATH, "utf-8");
    const report = JSON.parse(raw);
    if (report.generated_at && isToday(report.generated_at)) {
      return true;
    }
  } catch {
    // File doesn't exist or is unparseable — no report yet
  }
  return false;
}

function runPipeline(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("bash", [RUNNER], {
      cwd: SITE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", (code: number | null) => {
      resolve({ success: code === 0, output });
    });

    child.on("error", (err: Error) => {
      resolve({ success: false, output: err.message });
    });
  });
}

function msUntilNextRun(hourUtc: number, minuteUtc: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      minuteUtc,
      0,
      0
    )
  );

  // If that time already passed today, schedule for tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  await log("Scheduler starting up...");

  // Check if we need an immediate run
  const alreadyDone = await reportExistsForToday();
  if (!alreadyDone) {
    await log("No report for today — running pipeline immediately...");
    const result = await runPipeline();
    await log(
      `Immediate pipeline run ${result.success ? "completed" : "FAILED"}`
    );
  } else {
    await log("Today's report already exists — skipping immediate run.");
  }

  // Schedule recurring runs
  const scheduleNext = async () => {
    const delay = msUntilNextRun(RUN_HOUR_UTC, RUN_MINUTE_UTC);
    const nextRun = new Date(Date.now() + delay);
    await log(
      `Next pipeline run scheduled at ${nextRun.toISOString()} (${(delay / 1000 / 60 / 60).toFixed(1)} hours from now)`
    );

    setTimeout(async () => {
      await log("Scheduled run triggered.");
      const result = await runPipeline();
      await log(
        `Scheduled pipeline run ${result.success ? "completed" : "FAILED"}`
      );
      // Re-schedule for the next day
      scheduleNext();
    }, delay);
  };

  await scheduleNext();
  await log("Scheduler is running. Press Ctrl+C to stop.");
}

main().catch(async (err) => {
  await log(`Scheduler fatal error: ${err}`);
  process.exit(1);
});
