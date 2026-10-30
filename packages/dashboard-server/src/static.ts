import { readFile } from "node:fs/promises";
import path from "node:path";
import { guardPath } from "@andon/reader-core";

/**
 * Serves the built SPA with an index.html fallback (P-DS-5).
 *
 * Uses `readFile` rather than `Bun.file` streaming: these are local,
 * build-sized assets where streaming buys nothing, and a plain read keeps this
 * module runnable under the repo's Node-hosted Vitest. See code-summary.md D-2.
 */

const INDEX = "index.html";

/** Vite-style content hash, e.g. `main-B7xK92aQ.js`. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface StaticServer {
  /** `false` when `dist/` has not been built — the server then runs API-only. */
  present: boolean;
  handle(pathname: string): Promise<Response | null>;
}

function headersFor(file: string): Record<string, string> {
  const ext = path.extname(file).toLowerCase();
  return {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    // Hashed filenames change whenever their bytes change, so they are safe to
    // pin forever. Everything else — index.html above all — must be revalidated
    // or a rebuilt SPA never reaches an open tab.
    "cache-control": HASHED.test(path.basename(file))
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
}

export function createStatic(distDir: string, present: boolean): StaticServer {
  const root = path.resolve(distDir);

  const send = async (absolute: string): Promise<Response | null> => {
    try {
      const body = await readFile(absolute);
      return new Response(body, { headers: headersFor(absolute) });
    } catch {
      return null;
    }
  };

  return {
    present,

    async handle(pathname) {
      if (!present) return null;

      let relative: string;
      try {
        relative = decodeURIComponent(pathname).replace(/^\/+/, "");
      } catch {
        return null; // malformed percent-encoding
      }
      if (relative === "") relative = INDEX;

      // The same containment check the record reads use — a browser can ask for
      // `../../etc/passwd` just as easily as an API caller can.
      const guarded = await guardPath(root, relative);
      if (!("ok" in guarded)) return null;

      // SPA fallback: a client-side route has no file behind it, so anything
      // that does not resolve is answered with the shell.
      return (await send(guarded.value)) ?? (await send(path.join(root, INDEX)));
    },
  };
}
