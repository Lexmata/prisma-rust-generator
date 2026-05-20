import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import unicorn from "eslint-plugin-unicorn";

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.eslint.json", ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint, unicorn },
    rules: {
      ...unicorn.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": ["warn", { allow: ["error", "warn"] }],

      // Project-specific overrides for unicorn rules that conflict with the
      // codebase shape:
      //
      // - The emitters produce Rust source via string templates, so the
      //   abbreviation list (which renames `args`, `dir`, `env`, `ref`,
      //   `props`, etc.) fights the established naming.
      // - `no-null` is too aggressive: serde-tagged unions and DMMF types
      //   use `null` deliberately.
      // - `prevent-abbreviations` is opinionated to the point of being noise
      //   in a TS codebase that already has type-checked names.
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-array-for-each": "off",
      "unicorn/no-array-reduce": "off",

      // The layout files build output by pushing one emitter result per
      // line, which is intentionally readable as a sequence of steps.
      // Combining into a single Array.push(…) loses that structure.
      "unicorn/prefer-single-call": "off",
      // Named imports from node:* are idiomatic in TS ESM and tree-shake
      // cleanly; the default-import form is noisier.
      "unicorn/import-style": "off",
      // `(await x).foo` is fine for short one-liners; forcing a temp
      // variable adds noise without clarity.
      "unicorn/no-await-expression-member": "off",
      // Closures that capture local state (e.g. `moduleOf` in layout
      // emitters) cannot trivially hoist to outer scope.
      "unicorn/consistent-function-scoping": "off",
    },
  },
];
