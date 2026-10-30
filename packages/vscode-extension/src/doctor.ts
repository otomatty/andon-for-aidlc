import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function onPath(command: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
