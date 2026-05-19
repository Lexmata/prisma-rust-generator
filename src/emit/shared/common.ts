export function emitCommonSharedTypes(opts: { serde: boolean; vis: string }): string {
  const lines: (string | null)[] = [];
  const pushType = (
    headerLines: (string | null)[],
    body: string[],
  ): void => {
    for (const h of headerLines) lines.push(h);
    for (const b of body) lines.push(b);
    lines.push("");
  };

  pushType(
    [
      opts.serde ? `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]` : `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]`,
      opts.serde ? `#[serde(rename_all = "camelCase")]` : null,
    ],
    [
      `${opts.vis} enum QueryMode {`,
      `    Default,`,
      `    Insensitive,`,
      `}`,
    ],
  );

  pushType(
    [
      opts.serde ? `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]` : `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]`,
      opts.serde ? `#[serde(rename_all = "camelCase")]` : null,
    ],
    [
      `${opts.vis} enum SortOrder {`,
      `    Asc,`,
      `    Desc,`,
      `    AscNullsFirst,`,
      `    AscNullsLast,`,
      `    DescNullsFirst,`,
      `    DescNullsLast,`,
      `}`,
    ],
  );

  pushType(
    [
      opts.serde ? `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]` : `#[derive(Debug, Clone, PartialEq)]`,
      opts.serde ? `#[serde(untagged)]` : null,
    ],
    [
      `${opts.vis} enum OneOrMany<T> {`,
      `    One(T),`,
      `    Many(Vec<T>),`,
      `}`,
    ],
  );

  return lines.filter((l): l is string => l !== null).join("\n") + "\n";
}
