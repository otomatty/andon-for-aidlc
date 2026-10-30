#!/usr/bin/env bun
import { DEFAULT_PORT, DIST_MISSING_HINT, serve } from "./server.ts";

const HELP = `aidlc-dashboard — local AI-DLC workflow dashboard

Usage: aidlc-dashboard [--port <n>]

  --port <n>  Port to listen on (default ${DEFAULT_PORT}; 0 picks a free port).
              The dashboard binds 127.0.0.1 only.
  --help      Show this message.
`;

export interface CliOptions {
  port: number;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { port: DEFAULT_PORT, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--port") {
      const raw = argv[i + 1];
      const port = Number(raw);
      if (raw === undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port expects an integer 0-65535, got ${raw ?? "nothing"}`);
      }
      options.port = port;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg ?? ""}`);
    }
  }
  return options;
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const server = await serve({ port: options.port });
  if (server.apiOnly) process.stdout.write(`${DIST_MISSING_HINT}\n`);
  process.stdout.write(`Andon dashboard: http://${server.hostname}:${server.port}\n`);
  return 0;
}

// A bind failure must be fatal. Retrying on another port would leave the
// operator with a URL that is not the one they were told about (BR-DS-2).
try {
  const code = await main(process.argv.slice(2));
  if (code !== 0) process.exit(code);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`aidlc-dashboard: ${message}\n`);
  // Bun does not surface the errno here — it throws "Failed to start server.
  // Is port <n> in use?" — so matching only EADDRINUSE silently swallowed the
  // one piece of advice this branch exists to give (found by the R-MM-1 test).
  if (/EADDRINUSE|address already in use|port \d+ in use/i.test(message)) {
    process.stderr.write(
      "aidlc-dashboard: そのポートは使用中です。--port で別のポートを指定してください。\n",
    );
  }
  process.exit(1);
}
