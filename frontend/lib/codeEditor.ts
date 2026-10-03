// What the CodeMirror editors of the Lyrics and Edit tabs share. Their look is in codeEditor.scss.

import { Annotation, EditorState, Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";

// Marks the changes that don't come from the user, so the update listener doesn't record them.
export const programmatic = Annotation.define<boolean>();

export type MarkupRange = { from: number; to: number; kind: string };

export type LineMarkup = {
  // The markup ranges in the line, in order, each styled by its `cm-markup-<kind>` class.
  ranges: MarkupRange[];
  // A `cm-markup-<kind>` class for the whole line.
  line?: string;
};

const SEARCH_PHRASES = {
  next: "Next",
  previous: "Previous",
  "match case": "Match case",
  regexp: "Regexp",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
};

/**
 * The find and replace panel, opened with Ctrl+F.
 */
export function findAndReplace(): Extension {
  return [search({ top: true }), EditorState.phrases.of(SEARCH_PHRASES), keymap.of(searchKeymap)];
}

/**
 * The smallest change that turns `from` into `to`, so the selection and scroll outside it hold.
 */
export function minimalChange(from: string, to: string) {
  const shorter = Math.min(from.length, to.length);
  let start = 0;
  while (start < shorter && from[start] === to[start]) start++;
  let end = 0;
  while (end < shorter - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/**
 * Highlights the markup that `markup` finds in each visible line.
 */
export function markupHighlighter(markup: (line: string) => LineMarkup): Extension {
  const marks = new Map<string, Decoration>();
  const lines = new Map<string, Decoration>();
  const cached = (
    cache: Map<string, Decoration>,
    kind: string,
    make: (spec: { class: string }) => Decoration,
  ) => {
    let decoration = cache.get(kind);
    if (!decoration) {
      decoration = make({ class: `cm-markup-${kind}` });
      cache.set(kind, decoration);
    }
    return decoration;
  };

  function decorate(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const { doc } = view.state;
    // Two visible ranges can share a line, which must only be decorated once.
    let pos = 0;
    for (const { from, to } of view.visibleRanges) {
      pos = Math.max(pos, from);
      while (pos <= to) {
        const line = doc.lineAt(pos);
        const found = markup(line.text);
        if (found.line) {
          builder.add(line.from, line.from, cached(lines, found.line, Decoration.line));
        }
        for (const range of found.ranges) {
          const mark = cached(marks, range.kind, Decoration.mark);
          builder.add(line.from + range.from, line.from + range.to, mark);
        }
        pos = line.to + 1;
      }
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorate(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Whether the editor is on screen. A hidden tab's editor has no offset parent.
 */
export function isShown(view: EditorView): boolean {
  return view.dom.offsetParent !== null;
}

/**
 * Puts the scroll position back when the editor's tab is shown again, since hiding it zeroes it.
 * `onShown` can scroll somewhere else instead, and returns whether it did.
 * Returns the function that stops it.
 */
export function restoreScrollWhenShown(view: EditorView, onShown = () => false): () => void {
  let scrollTop = 0;
  const remember = () => {
    if (view.scrollDOM.clientHeight > 0) {
      scrollTop = view.scrollDOM.scrollTop;
    }
  };
  view.scrollDOM.addEventListener("scroll", remember);
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting && !onShown()) {
            view.scrollDOM.scrollTop = scrollTop;
          }
        });
  observer?.observe(view.dom);
  return () => {
    observer?.disconnect();
    view.scrollDOM.removeEventListener("scroll", remember);
  };
}
