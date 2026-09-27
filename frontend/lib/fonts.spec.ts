import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { BUNDLED_FONTS, SYMBOL_CHAR } from "./fonts";
import { parseCoverage } from "./fontFile";

function toRanges(codePoints: Set<number>): [number, number][] {
  const ranges: [number, number][] = [];
  for (const c of [...codePoints].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === c - 1) {
      last[1] = c;
    } else {
      ranges.push([c, c]);
    }
  }
  return ranges;
}

test("bundledSymbols.json lists the symbols in each bundled font file", async () => {
  const symbol = new RegExp(SYMBOL_CHAR, "u");
  const table = Object.fromEntries(
    Object.entries(BUNDLED_FONTS).map(([family, url]) => {
      const file = readFileSync(
        path.resolve(__dirname, "../../api/assets/fonts", path.basename(url)),
      );
      const data = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer;
      return [family, toRanges(parseCoverage(data, symbol))];
    }),
  );

  await expect(JSON.stringify(table) + "\n").toMatchFileSnapshot("./bundledSymbols.json");
});
