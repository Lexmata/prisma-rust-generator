import { describe, it, expect } from "vitest";
import { buildFileMap } from "../../src/ir/file-map.js";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("buildFileMap", () => {
  it("maps model and enum names to source stems", async () => {
    const dir = resolve(__dirname, "../fixtures/file-map");
    const map = await buildFileMap(dir);
    expect(map.get("User")).toBe("a");
    expect(map.get("Role")).toBe("a");
    expect(map.get("Firm")).toBe("b");
    expect(map.size).toBe(3);
  });

  it("works on a single file path", async () => {
    const file = resolve(__dirname, "../fixtures/file-map/a.prisma");
    const map = await buildFileMap(file);
    expect(map.get("User")).toBe("a");
  });

  it("prefixes digit-leading file stems so the result is a valid Rust ident", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-map-digit-"));
    try {
      await writeFile(join(dir, "01-foo.prisma"), "model M { id String @id }\n");
      const map = await buildFileMap(dir);
      expect(map.get("M")).toBe("m_01_foo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate names across files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-map-dup-"));
    try {
      await writeFile(join(dir, "x.prisma"), "model Dup { id String @id }\n");
      await writeFile(join(dir, "y.prisma"), "model Dup { id String @id }\n");
      await expect(buildFileMap(dir)).rejects.toThrow(/Duplicate Prisma declaration Dup/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
