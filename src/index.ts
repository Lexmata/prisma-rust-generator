#!/usr/bin/env node
import helper from "@prisma/generator-helper";
import { generate } from "./generate.js";
import { isSkipRequested } from "./options.js";

const { generatorHandler } = helper as {
  generatorHandler: typeof import("@prisma/generator-helper").generatorHandler;
};

export const GENERATOR_NAME = "prisma-rust-generator";

generatorHandler({
  onManifest() {
    return {
      defaultOutput: "../rust-out/src",
      prettyName: "Prisma Rust Generator",
      version: "0.2.0",
    };
  },
  async onGenerate(opts) {
    // schema.prisma can wire the skip switch through Prisma's env():
    //   generator rust {
    //     ...
    //     skip = env("PRISMA_RUST_GENERATOR_SKIP")
    //   }
    // Prisma resolves env() before calling us, so we just read the config.
    const skip = opts.generator?.config?.skip;
    if (isSkipRequested(skip)) {
      // Stderr keeps stdout clean for the JSON-RPC channel with prisma.
      console.error(
        `[${GENERATOR_NAME}] skip = ${JSON.stringify(skip)} — skipping Rust generation.`,
      );
      return;
    }
    await generate(opts);
  },
});
