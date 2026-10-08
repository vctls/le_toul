import { ChildProcess, execSync, spawn } from "child_process";
import http from "http";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export const GATEWAY_PORT = 8010;
const APP_PORT = 8011;

/**
 * Build the production bundle and its service worker. `env` changes the bundle,
 * as a new deployment would.
 */
export function buildApp(env: Record<string, string> = {}): void {
  execSync("npm run build", { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
}

/**
 * Run FastAPI as in production, serving the built bundle and the real worker.
 */
export class AppServer {
  private process: ChildProcess | null = null;

  async start(): Promise<void> {
    this.process = spawn("poetry", ["run", "uvicorn", "api.main:app", "--port", String(APP_PORT)], {
      cwd: ROOT,
      env: { ...process.env, DEBUG: "False", SEPARATION_BACKEND: "passthrough" },
      // Its own process group, so that stop() reaches uvicorn behind poetry.
      detached: true,
      stdio: "ignore",
    });
    await waitFor(async () => (await fetch(`http://localhost:${APP_PORT}/health`)).ok);
  }

  async stop(): Promise<void> {
    if (!this.process?.pid) return;
    const exited = new Promise((resolve) => this.process!.once("exit", resolve));
    process.kill(-this.process.pid, "SIGTERM");
    await exited;
    this.process = null;
  }
}

/**
 * Stand in for the host's proxy: it forwards to the app, answers 502 while the app is down
 * and 503 while `unavailable` is set, and refuses connections once closed.
 */
export class Gateway {
  unavailable = false;
  pageRequests = 0;
  private server: http.Server | null = null;

  async open(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((request, response) => {
      if (new URL(request.url ?? "", "http://gateway").pathname === "/") {
        this.pageRequests++;
      }
      if (this.unavailable) {
        response.writeHead(503).end("Service Unavailable");
        return;
      }
      const upstream = http.request(
        { port: APP_PORT, path: request.url, method: request.method, headers: request.headers },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      upstream.on("error", () => response.writeHead(502).end("Bad Gateway"));
      request.pipe(upstream);
    });
    await new Promise<void>((resolve) => this.server!.listen(GATEWAY_PORT, resolve));
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    this.server = null;
  }
}

/**
 * Poll `check` until it holds, or throw once `timeoutMs` has passed.
 */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The app server didn't start");
}
