import { describe, expect, it } from "vitest";
import { timingsRowMarkup } from "./timingsMarkup";

const kinds = (row: string) =>
  timingsRowMarkup(row).ranges.map(({ from, to, kind }) => [row.slice(from, to), kind]);

describe("timingsRowMarkup", () => {
  it("marks a syllable and its times", () => {
    expect(kinds('"ka "    00:01.50  00:02.00')).toEqual([
      ['"ka "', "syllable"],
      ["00:01.50", "time"],
      ["00:02.00", "time"],
    ]);
  });

  it("marks a placeholder and a keyword", () => {
    expect(kinds("-")).toEqual([["-", "placeholder"]]);
    expect(kinds("page")).toEqual([["page", "keyword"]]);
    expect(kinds('voice "Ann"')).toEqual([
      ["voice", "keyword"],
      ['"Ann"', "syllable"],
    ]);
  });

  it("keeps escaped quotes and a # inside the syllable", () => {
    expect(kinds('"a \\"b\\" #c"  00:01.00')).toEqual([
      ['"a \\"b\\" #c"', "syllable"],
      ["00:01.00", "time"],
    ]);
  });

  it("marks a comment after the row", () => {
    expect(kinds('"den"  00:01.00  # too early')).toEqual([
      ['"den"', "syllable"],
      ["00:01.00", "time"],
      ["# too early", "comment"],
    ]);
  });

  it("leaves a malformed time and an unknown word alone", () => {
    expect(kinds("00:61.00 pages")).toEqual([]);
  });

  it("marks an unclosed quote to the end of the row", () => {
    expect(kinds('"lu  00:01.00')).toEqual([['"lu  00:01.00', "syllable"]]);
  });
});
