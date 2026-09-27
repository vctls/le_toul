// Messages shared by the importers,
// so a KBP file and a timings file report the same change the same way.
export const MARKUP_REMOVED =
  "A / or _ in the lyrics was removed, since the app uses both as markup";
export const BRACKETS_REMOVED =
  "Square brackets starting a line were removed, since they would read as a voice tag";
export const SPACER_PAGE_DROPPED = "A page holding only blank spacer lines was dropped";
export const SPACER_BOUNDS_DROPPED =
  "A blank spacer line's display times were dropped, since it shows nothing";
export const DISPLAY_PERIOD_WIDENED = "A line's display period was widened to contain its timings";

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
