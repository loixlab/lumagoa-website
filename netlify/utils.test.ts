import { describe, expect, it } from "@jest/globals";
import { parseCsv } from "./utils";

describe("parseCsv", () => {
  it("splits plain rows and cells", () => {
    expect(parseCsv("a,b,c\nd,e,f")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("keeps a quoted comma inside a cell (the '75,650' bug)", () => {
    expect(parseCsv('ref,amount,paid\nABC123,"75,650",no')).toEqual([
      ["ref", "amount", "paid"],
      ["ABC123", "75,650", "no"],
    ]);
  });

  it("keeps a quoted comma in a name without shifting later columns", () => {
    const rows = parseCsv('ABC123,"Doe, Jane",jane@x.com,,,,,,,yes');
    expect(rows[0]).toEqual([
      "ABC123",
      "Doe, Jane",
      "jane@x.com",
      "",
      "",
      "",
      "",
      "",
      "",
      "yes",
    ]);
  });

  it("unescapes doubled quotes inside a quoted cell", () => {
    expect(parseCsv('a,"said ""hi""",b')).toEqual([["a", 'said "hi"', "b"]]);
  });

  it("keeps a newline inside a quoted cell in the same row", () => {
    expect(parseCsv('a,"line1\nline2",b\nc,d,e')).toEqual([
      ["a", "line1\nline2", "b"],
      ["c", "d", "e"],
    ]);
  });

  it("handles CRLF row endings without leaking \\r into cells", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("preserves empty cells, including a trailing one", () => {
    expect(parseCsv("a,,c\nd,e,")).toEqual([
      ["a", "", "c"],
      ["d", "e", ""],
    ]);
  });

  it("does not emit a phantom row after a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("treats a quoted empty cell as empty", () => {
    expect(parseCsv('a,"",c')).toEqual([["a", "", "c"]]);
  });
});
