import type { GeneratorConfig } from "../types.js";
import type { RustScalarKind } from "./types.js";

const scalar = (rust: string, eq: boolean, copy: boolean): RustScalarKind => ({
  kind: "scalar", rust, eq, copy,
});

export function mapPrismaScalar(
  prismaType: string,
  nativeType: string | null,
  cfg: GeneratorConfig,
): RustScalarKind {
  switch (prismaType) {
    case "String": {
      if (nativeType === "Uuid" && cfg.uuidFromDbUuid) return scalar("uuid::Uuid", true, true);
      return scalar("String", true, false);
    }
    case "Int": {
      if (nativeType === "SmallInt") return scalar("i16", true, true);
      if (nativeType === "Oid") return scalar("u32", true, true);
      return scalar("i32", true, true);
    }
    case "BigInt": {
      return scalar("i64", true, true);
    }
    case "Float": {
      if (nativeType === "Real") return scalar("f32", false, true);
      return scalar("f64", false, true);
    }
    case "Decimal": {
      return cfg.decimalCrate === "bigdecimal"
        ? scalar("bigdecimal::BigDecimal", true, false)
        : scalar("rust_decimal::Decimal", true, true);
    }
    case "Boolean": {
      return scalar("bool", true, true);
    }
    case "DateTime": {
      const ch = cfg.dateTimeCrate === "chrono";
      switch (nativeType) {
        case "Date": {
          return scalar(ch ? "chrono::NaiveDate" : "time::Date", true, ch);
        }
        case "Time":
        case "Timetz": {
          return scalar(ch ? "chrono::NaiveTime" : "time::Time", true, ch);
        }
        case "Timestamp": {
          return scalar(ch ? "chrono::NaiveDateTime" : "time::PrimitiveDateTime", true, ch);
        }
        // Catches "Timestamptz" and the no-native-type case (null).
        default: {
          return scalar(ch ? "chrono::DateTime<chrono::Utc>" : "time::OffsetDateTime", true, ch);
        }
      }
    }
    case "Json": {
      return cfg.jsonCrate === "string"
        ? scalar("String", true, false)
        : scalar("serde_json::Value", false, false);
    }
    case "Bytes": {
      return cfg.bytesCrate === "bytes"
        ? scalar("bytes::Bytes", true, false)
        : scalar("Vec<u8>", true, false);
    }
    default: {
      throw new Error(`Unknown Prisma scalar: ${prismaType}`);
    }
  }
}
