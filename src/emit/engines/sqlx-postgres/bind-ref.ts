import type { FieldIR } from "../../../ir/types.js";

// sqlx's `push_bind` takes an owned value. We have two call shapes in the
// engine emitter and they need different syntax:
//
// - `bindFromBorrow(f, "value")` — `value` is bound via `if let Some(value) =
//   &x.field`, so it's a `&T`. For Copy `T` we deref-copy (`*value`); for
//   non-Copy we clone (`value.clone()`).
//
// - `bindFromStruct(f, "input.field")` — accessed through `input: &T` or
//   `input: T`. Auto-deref copies Copy fields, so we can pass `input.field`
//   directly. For non-Copy fields we clone. For `Option<T>`: Option<T> is
//   Copy iff T is Copy, so Copy fields work the same whether optional or
//   not. Non-Copy fields (incl. `Option<NonCopy>`) need `.clone()`.
//
// Either way: `clippy::clone_on_copy` rejects `.clone()` on Copy types, and
// `clippy::needless_borrow` etc. catches incorrect `&` usage — the rules
// below pick the lint-clean form.
//
// Enum types (`enumRef`) and scalars with `RustScalarKind.copy === true`
// are treated as Copy. Generated enums derive Copy. Relation types must
// never reach these helpers.

function isCopy(f: FieldIR): boolean {
  if (f.type.kind === "scalar") return f.type.copy;
  if (f.type.kind === "enumRef") return true;
  return false;
}

export function bindFromBorrow(f: FieldIR, expr: string): string {
  return isCopy(f) ? `*${expr}` : `${expr}.clone()`;
}

export function bindFromStruct(f: FieldIR, expr: string): string {
  return isCopy(f) ? expr : `${expr}.clone()`;
}
