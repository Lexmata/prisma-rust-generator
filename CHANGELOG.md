# Changelog

Pre-1.0: the emission format may change between minor versions. Each
release section below lists user-visible changes to generated Rust
output along with a migration note. After 1.0, any change to generated
source will be a major-version bump.

## Unreleased

### Breaking — generated output

- **All relation fields in `*CreateInput` / `*UpdateInput` (top-level and
  nested `CreateWithout`/`UpdateWithout` bodies) are now wrapped in
  `Box<>`.** Densely connected schemas (the 80-model lexmata fixture, for
  example) push Rust's drop-check and serde-derive recursion past the
  default 256, and Box plus `#![recursion_limit = "1024"]` is the
  combination needed to compile.
  - Migration: wrap relation values in `Box::new(...)` when constructing
    these inputs. The plain `T` form no longer compiles.
- **`{Model}ScalarWhereInput` is now emitted once per target model
  instead of once per (source, relation) pair.** The previous form
  produced duplicate definitions when several source models had
  many-relations to the same target.
  - Migration: drop the `Without{Source}{Relation}` infix from references
    — `User3ScalarWhereInput` (or similar) becomes `UserScalarWhereInput`.
- **Generated `lib.rs` (or `mod.rs`) now carries
  `#![recursion_limit = "1024"]`.** Required to compile densely connected
  schemas; harmless on small ones.
  - No consumer action required; only tools that parse the generated
    crate need to expect this inner attribute.

### Internal

- `scalarFilterRefFor` exported from `src/emit/filters/model.ts` (shared
  between `WhereInput` and `ScalarWhereInput`).
- `CRATE_RECURSION_LIMIT_ATTR` exported from `src/layout/header.ts`.
- `computeEqEligibility` rewritten from O(M²) fix-point to O(V+E)
  reverse-graph BFS. Output unchanged.
