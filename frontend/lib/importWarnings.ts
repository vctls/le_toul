// Messages shared by the importers,
// so a KBP file and a timings file report the same change the same way.
export const MARKUP_REMOVED =
  "A / or _ in the lyrics was removed, since the app uses both as markup";
export const BRACKETS_REMOVED =
  "Square brackets starting a line were removed, since they would read as a voice tag";
export const SPACER_DROPPED = "A blank spacer line was dropped";

/**
 * Counts each kind of dropped item once, so a long song yields a short list.
 */
export class Warnings {
  private counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.counts].map(([message, count]) =>
      count > 1 ? `${message} (×${count})` : message,
    );
  }
}
