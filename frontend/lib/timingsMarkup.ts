import { LineMarkup, MarkupRange, markupHighlighter } from "@/lib/codeEditor";

const TIME = /^\d{1,3}:[0-5]\d\.\d{2}$/;
const KEYWORDS = new Set(["page", "voice"]);

/**
 * The kind of a bare word in a row, if it has one.
 */
function wordKind(word: string): string | null {
  if (TIME.test(word)) return "time";
  if (word === "-") return "placeholder";
  if (KEYWORDS.has(word)) return "keyword";
  return null;
}

/**
 * The parts of one `timings.txt` row: quoted syllables, times, `-` placeholders, keywords, and a
 * comment from a `#` outside quotes to the end of the row.
 */
export function timingsRowMarkup(row: string): LineMarkup {
  const ranges: MarkupRange[] = [];
  let i = 0;
  while (i < row.length) {
    const char = row[i];
    if (/\s/.test(char)) {
      i++;
    } else if (char === "#") {
      ranges.push({ from: i, to: row.length, kind: "comment" });
      break;
    } else if (char === '"') {
      let end = i + 1;
      while (end < row.length && row[end] !== '"') {
        end += row[end] === "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, row.length);
      ranges.push({ from: i, to: end, kind: "syllable" });
      i = end;
    } else {
      let end = i;
      while (end < row.length && !/[\s"#]/.test(row[end])) end++;
      const kind = wordKind(row.slice(i, end));
      if (kind) {
        ranges.push({ from: i, to: end, kind });
      }
      i = end;
    }
  }
  return { ranges };
}

/**
 * Highlights the syllables, times, placeholders, keywords and comments of `timings.txt` rows.
 */
export const timingsMarkup = markupHighlighter(timingsRowMarkup);
