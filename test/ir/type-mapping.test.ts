import { describe, it, expect } from "vitest";
import { mapPrismaScalar } from "../../src/ir/type-mapping.js";
import type { GeneratorConfig } from "../../src/types.js";

const defaultCfg: GeneratorConfig = {
  output: "out", outputLayout: "per-file", moduleName: null, moduleVisibility: "pub",
  dateTimeCrate: "chrono", decimalCrate: "rust_decimal", uuidFromDbUuid: true,
  bytesCrate: "std", jsonCrate: "serde_json", serde: true, extraDerives: [],
  edition: "2021", runRustfmt: true, requireRustfmt: true, rustfmtBinary: "rustfmt",
  clippyAllowList: [], concurrency: 1, rustfmtShardSize: 16, filePreamble: "",
};

describe("mapPrismaScalar", () => {
  it("maps String → String by default", () => {
    expect(mapPrismaScalar("String", null, defaultCfg)).toEqual({
      kind: "scalar", rust: "String", eq: true, copy: false,
    });
  });
  it("maps String @db.Uuid → uuid::Uuid", () => {
    expect(mapPrismaScalar("String", "Uuid", defaultCfg).rust).toBe("uuid::Uuid");
  });
  it("opts out of Uuid when uuidFromDbUuid=false", () => {
    expect(mapPrismaScalar("String", "Uuid", { ...defaultCfg, uuidFromDbUuid: false }).rust).toBe("String");
  });
  it("maps Int → i32, BigInt → i64", () => {
    expect(mapPrismaScalar("Int", null, defaultCfg).rust).toBe("i32");
    expect(mapPrismaScalar("BigInt", null, defaultCfg).rust).toBe("i64");
  });
  it("maps Int @db.SmallInt → i16, @db.Oid → u32", () => {
    expect(mapPrismaScalar("Int", "SmallInt", defaultCfg).rust).toBe("i16");
    expect(mapPrismaScalar("Int", "Oid", defaultCfg).rust).toBe("u32");
  });
  it("maps Float → f64, @db.Real → f32, both not Eq", () => {
    expect(mapPrismaScalar("Float", null, defaultCfg).eq).toBe(false);
    expect(mapPrismaScalar("Float", "Real", defaultCfg).rust).toBe("f32");
  });
  it("maps Decimal per decimalCrate", () => {
    expect(mapPrismaScalar("Decimal", null, defaultCfg).rust).toBe("rust_decimal::Decimal");
    expect(mapPrismaScalar("Decimal", null, { ...defaultCfg, decimalCrate: "bigdecimal" }).rust)
      .toBe("bigdecimal::BigDecimal");
  });
  it("maps DateTime variants per dateTimeCrate", () => {
    expect(mapPrismaScalar("DateTime", null, defaultCfg).rust).toBe("chrono::DateTime<chrono::Utc>");
    expect(mapPrismaScalar("DateTime", "Timestamp", defaultCfg).rust).toBe("chrono::NaiveDateTime");
    expect(mapPrismaScalar("DateTime", "Date", defaultCfg).rust).toBe("chrono::NaiveDate");
    expect(mapPrismaScalar("DateTime", "Time", defaultCfg).rust).toBe("chrono::NaiveTime");
    const timeCfg = { ...defaultCfg, dateTimeCrate: "time" as const };
    expect(mapPrismaScalar("DateTime", null, timeCfg).rust).toBe("time::OffsetDateTime");
    expect(mapPrismaScalar("DateTime", "Timestamp", timeCfg).rust).toBe("time::PrimitiveDateTime");
    expect(mapPrismaScalar("DateTime", "Date", timeCfg).rust).toBe("time::Date");
  });
  it("maps Json → serde_json::Value, not Eq", () => {
    const r = mapPrismaScalar("Json", null, defaultCfg);
    expect(r.rust).toBe("serde_json::Value");
    expect(r.eq).toBe(false);
  });
  it("maps Json → String (Eq) when jsonCrate=string", () => {
    const r = mapPrismaScalar("Json", null, { ...defaultCfg, jsonCrate: "string" });
    expect(r.rust).toBe("String");
    expect(r.eq).toBe(true);
  });
  it("maps Bytes → Vec<u8> by default, bytes::Bytes when configured", () => {
    expect(mapPrismaScalar("Bytes", null, defaultCfg).rust).toBe("Vec<u8>");
    expect(mapPrismaScalar("Bytes", null, { ...defaultCfg, bytesCrate: "bytes" }).rust).toBe("bytes::Bytes");
  });
});
