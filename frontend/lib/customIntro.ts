// Runs at build time in the Vite config, so this module must not touch the browser.

import MarkdownIt from "markdown-it";

// The HTML rendered from the Markdown, split around the built-in intro.
export interface CustomIntro {
  before: string;
  after: string;
  showBuiltIn: boolean;
}

// A line holding only this places the built-in intro.
const BUILT_IN_PLACEHOLDER = /^[ \t]*\{intro\}[ \t]*$/m;

/**
 * Render the Intro tab's custom Markdown, or return null when there is none.
 * Without the placeholder, the custom content replaces the built-in intro.
 */
export function renderCustomIntro(markdown: string): CustomIntro | null {
  if (!markdown.trim()) {
    return null;
  }
  const renderer = new MarkdownIt("commonmark");
  const match = BUILT_IN_PLACEHOLDER.exec(markdown);
  if (!match) {
    return { before: renderer.render(markdown), after: "", showBuiltIn: false };
  }
  return {
    before: renderer.render(markdown.slice(0, match.index)),
    after: renderer.render(markdown.slice(match.index + match[0].length)),
    showBuiltIn: true,
  };
}
