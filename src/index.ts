#!/usr/bin/env node
import helper from "@prisma/generator-helper";
import { generate } from "./generate.js";

const { generatorHandler } = helper as {
  generatorHandler: typeof import("@prisma/generator-helper").generatorHandler;
};

export const GENERATOR_NAME = "prisma-rust-generator";

generatorHandler({
  onManifest() {
    return {
      defaultOutput: "../rust-out/src",
      prettyName: "Prisma Rust Generator",
      version: "0.0.1",
    };
  },
  onGenerate: generate,
});
