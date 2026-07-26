// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
import handler from "./dist/server/server.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, SITE_ROOT } from "./src/config";

const SAVED_IDEAS_PATH = resolve(DATA_DIR, "saved_ideas.json");

const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

function runPipeline(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("bash", [resolve(SITE_ROOT, "scripts/run-daily.sh")], {
      cwd: SITE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { output += data.toString(); });
    child.on("close", (code: number | null) => { resolve({ success: code === 0, output }); });
    child.on("error", (err: Error) => { resolve({ success: false, output: err.message }); });
  });
}

async function tryFreePort(port: number): Promise<void> {
  try {
    const proc = Bun.spawnSync(["lsof", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      stdout: "pipe", stderr: "ignore",
    });
    const pids = proc.stdout?.toString().trim();
    if (pids) {
      for (const pid of pids.split("\n")) {
        try { process.kill(Number(pid), "SIGTERM"); } catch { /* gone */ }
      }
      await Bun.sleep(200);
    }
  } catch { /* lsof not available */ }
}

// Bind. Free the port first (no sudo — works on dev machines where the
// same user owns the old process), then bind, retrying on EADDRINUSE.
for (let attempt = 1; ; attempt++) {
  await tryFreePort(PORT);
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      async fetch(req) {
        const { pathname } = new URL(req.url);

        if (pathname === "/api/run-pipeline" && req.method === "POST") {
          try {
            const { success, output } = await runPipeline();
            if (!success) {
              return new Response(JSON.stringify({ success: false, error: output }),
                { status: 500, headers: { "Content-Type": "application/json" } });
            }
            let report = null;
            try {
              const raw = await readFile(resolve(DATA_DIR, "daily_report.json"), "utf-8");
              report = JSON.parse(raw);
            } catch { /* no report yet */ }
            return new Response(JSON.stringify({ success: true, message: "Pipeline completed", report }),
              { status: 200, headers: { "Content-Type": "application/json" } });
          } catch (err) {
            return new Response(JSON.stringify({ success: false, error: String(err) }),
              { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }

        if (pathname === "/api/save-idea" && req.method === "POST") {
          try {
            const body = await req.json();
            let ideas: unknown[] = [];
            try {
              const raw = await readFile(SAVED_IDEAS_PATH, "utf-8");
              ideas = JSON.parse(raw);
            } catch { /* first save */ }
            ideas.push(body);
            await writeFile(SAVED_IDEAS_PATH, JSON.stringify(ideas, null, 2), "utf-8");
            return new Response(JSON.stringify({ success: true }),
              { status: 200, headers: { "Content-Type": "application/json" } });
          } catch (err) {
            return new Response(JSON.stringify({ success: false, error: String(err) }),
              { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }

        if (pathname !== "/") {
          const file = Bun.file(CLIENT_DIR + pathname);
          if (await file.exists()) return new Response(file);
        }
        return (handler as { fetch: (r: Request) => Response | Promise<Response> }).fetch(req);
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

console.log(`team-site serving on http://${HOST}:${String(PORT)}`);
