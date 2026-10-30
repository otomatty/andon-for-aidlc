import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalPath } from "@andon/reader-core";
import { acquireLocalLock } from "./local-lock.ts";
import { CustomizationError } from "./model.ts";

const LOCAL = "aidlc/guide-customization/.local";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** The only Guide writer: confines every file and directory to clone-local storage. */
export class CustomizationStorage {
  constructor(readonly workspaceRoot: string) {}

  async path(relative: string, createParents = false): Promise<string> {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(relative) ||
      relative.split(/[\\/]/).some((p) => p === ".." || p === ".") ||
      path.isAbsolute(relative)
    )
      throw new Error("invalid-local-path");
    const root = await canonicalPath(this.workspaceRoot);
    const parts = [...LOCAL.split("/"), ...relative.split("/")];
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index] as string);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory()))
          throw new Error("linked-local-path");
      } catch (error) {
        if (codeOf(error) !== "ENOENT") throw error;
        if (createParents && index < parts.length - 1)
          await mkdir(current, { mode: 0o700 }).catch((cause) => {
            if (codeOf(cause) !== "EEXIST") throw cause;
          });
        if (createParents && index < parts.length - 1) {
          const info = await lstat(current);
          if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("linked-local-path");
        }
      }
    }
    return current;
  }

  async readJson<T>(relative: string): Promise<T | null> {
    const file = await this.path(relative);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.size > 160 * 1024 * 1024) throw new Error("invalid-local-file");
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
      if (codeOf(error) === "ENOENT") return null;
      throw error;
    }
  }

  async writeJson(relative: string, value: unknown): Promise<void> {
    const file = await this.path(relative, true);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(value)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.path(relative);
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, file);
          break;
        } catch (error) {
          if (attempt > 1 || !["EPERM", "EACCES", "EBUSY"].includes(codeOf(error) ?? ""))
            throw error;
          await delay(25);
        }
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async withLock<T>(
    name: string,
    action: () => Promise<T>,
    options: { wait?: boolean } = {},
  ): Promise<T> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error("invalid-lock-name");
    // Resolve aliases and validate local storage before choosing a process-owned mutex.
    const lock = await this.path(`locks/${name}.lock`, true);
    const release = await acquireLocalLock(lock, options.wait !== false).catch((cause: unknown) => {
      if (cause instanceof CustomizationError && cause.code === "operation-active") throw cause;
      throw new CustomizationError(
        "local-storage-unavailable",
        "設定保存のロックを利用できません。ローカル通信の権限と保存先を確認してください。",
        503,
        [
          {
            severity: "error",
            code: "lock-runtime-unavailable",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        ],
        { cause },
      );
    });
    try {
      return await action();
    } finally {
      await release();
    }
  }
}
