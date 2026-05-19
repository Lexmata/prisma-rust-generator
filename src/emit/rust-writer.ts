export class RustWriter {
  private buf: string[] = [];
  private indent = 0;

  private pad(): string {
    return "    ".repeat(this.indent);
  }

  line(s: string = ""): void {
    this.buf.push(`${this.pad()}${s}\n`);
  }

  blank(): void {
    this.buf.push("\n");
  }

  docComments(lines: readonly string[]): void {
    for (const l of lines) this.line(`/// ${l}`);
  }

  deriveLine(traits: readonly string[]): void {
    if (traits.length === 0) return;
    this.line(`#[derive(${traits.join(", ")})]`);
  }

  openStruct(vis: string, name: string): void {
    this.line(`${vis} struct ${name} {`);
    this.indent++;
  }

  openEnum(vis: string, name: string): void {
    this.line(`${vis} enum ${name} {`);
    this.indent++;
  }

  field(declaration: string, type: string): void {
    this.line(`${declaration}: ${type},`);
  }

  variant(name: string, payload?: string): void {
    this.line(payload ? `${name}(${payload}),` : `${name},`);
  }

  close(): void {
    this.indent = Math.max(0, this.indent - 1);
    this.line(`}`);
  }

  raw(text: string): void {
    // append raw text without re-indenting — caller handles formatting
    this.buf.push(text.endsWith("\n") ? text : `${text}\n`);
  }

  toString(): string {
    return this.buf.join("");
  }
}
