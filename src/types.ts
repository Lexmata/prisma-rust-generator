export type Engine = null | "sqlx-postgres" | "sqlx-sqlite" | "sqlx-mysql";

export interface GeneratorConfig {
  output: string;
  outputLayout: "per-file" | "per-model" | "single";
  moduleName: string | null;
  moduleVisibility: "pub" | "pub(crate)";
  dateTimeCrate: "chrono" | "time";
  decimalCrate: "rust_decimal" | "bigdecimal";
  uuidFromDbUuid: boolean;
  bytesCrate: "std" | "bytes";
  jsonCrate: "serde_json" | "string";
  serde: boolean;
  extraDerives: readonly string[];
  edition: "2021" | "2024";
  runRustfmt: boolean;
  requireRustfmt: boolean;
  rustfmtBinary: string;
  clippyAllowList: readonly string[];
  concurrency: number;
  rustfmtShardSize: number;
  filePreamble: string;
  engine: Engine;
}
