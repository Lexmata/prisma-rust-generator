const RUST_KEYWORDS = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "async",
  "await",
  "dyn",
  "abstract",
  "become",
  "box",
  "do",
  "final",
  "macro",
  "override",
  "priv",
  "typeof",
  "unsized",
  "virtual",
  "yield",
  "try",
  "union",
]);

export function isReservedRustKeyword(s: string): boolean {
  return RUST_KEYWORDS.has(s);
}

export function toSnakeCase(input: string): string {
  // Strip leading underscores. Then insert _ between:
  //   (a) lowercase|digit -> uppercase boundaries (fooBar -> foo_Bar)
  //   (b) consecutive-uppercase -> uppercase+lowercase boundaries (URLEntry -> URL_Entry)
  let s = input.replace(/^_+/, "");
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  return s.toLowerCase();
}

export function toPascalCase(input: string): string {
  // Normalize camel/Pascal boundaries into snake_case first so existing word
  // boundaries (e.g. "alreadyPascal") survive, then title-case each segment.
  return toSnakeCase(input)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

export function rustFieldIdent(prismaName: string): string {
  const snake = toSnakeCase(prismaName);
  return isReservedRustKeyword(snake) ? `r#${snake}` : snake;
}
