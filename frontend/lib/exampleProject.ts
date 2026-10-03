// The Intro tab links here. A deployer's custom intro Markdown can use the same href.
export const EXAMPLE_PROJECT_HREF = "#load-example";

export const EXAMPLE_PROJECT_NAME = "Example project";

// Keep in sync with the files in api/assets/example/.
const EXAMPLE_FILES = [
  "song.mp3",
  "lyrics.txt",
  "timings.json",
  "settings.yaml",
  "backing.mp3",
  "vocals.mp3",
];

/**
 * Download the example project, as the files a picked project folder would hold.
 */
export async function fetchExampleProject(): Promise<File[]> {
  return Promise.all(
    EXAMPLE_FILES.map(async (name) => {
      const response = await fetch(`/static/example/${name}`);
      if (!response.ok) {
        throw new Error(`couldn't download ${name} (${response.status})`);
      }
      const blob = await response.blob();
      return new File([blob], name, { type: blob.type });
    }),
  );
}
