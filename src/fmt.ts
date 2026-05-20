import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class RustfmtUnavailableError extends Error {
  constructor(public readonly binary: string, cause?: unknown) {
    super(`rustfmt unavailable: ${binary}`);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface RunRustfmtOpts {
  files: readonly string[];
  binary: string;
  edition: "2021" | "2024";
  shardSize: number;
}

export async function runRustfmt(opts: RunRustfmtOpts): Promise<void> {
  if (opts.files.length === 0) return;
  const shards = chunk([...opts.files], opts.shardSize);
  const errors: { stderr: string; files: string[] }[] = [];
  await Promise.all(
    shards.map(async (shard) => {
      try {
        await exec(opts.binary, [
          "--edition",
          opts.edition,
          "--emit",
          "files",
          ...shard,
        ]);
      } catch (error) {
        const err = error as { code?: string; stderr?: string };
        if (err.code === "ENOENT") {
          throw new RustfmtUnavailableError(opts.binary, error);
        }
        errors.push({ stderr: err.stderr ?? String(error), files: shard });
      }
    }),
  );
  if (errors.length > 0) {
    const summary = errors
      .map((e) => `Files: ${e.files.join(", ")}\n${e.stderr}`)
      .join("\n---\n");
    throw new Error(`rustfmt failed:\n${summary}`);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
