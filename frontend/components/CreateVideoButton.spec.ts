import { shallowMount } from "@vue/test-utils";
import CreateVideoButton from "./CreateVideoButton.vue";
import { CreationPhase } from "@/types";

function mountButton(props: Record<string, unknown>) {
  return shallowMount(CreateVideoButton, {
    props: { submitting: true, phase: CreationPhase.SeparatingVocals, ...props },
  });
}

describe("CreateVideoButton", () => {
  it("reads Create Video until a submission starts", async () => {
    const wrapper = mountButton({ submitting: false, phase: CreationPhase.NotStarted });

    expect(wrapper.find("button").text()).toBe("Create Video");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("shows the separation progress the backend reports", () => {
    const wrapper = mountButton({
      separationProgress: 0.42,
      separationStage: "separating the vocals",
    });

    expect(wrapper.find(".progress-label").text()).toBe("Separating the vocals: 42%");
    expect(wrapper.find("button").attributes("style")).toContain("--progress: 42%");
  });

  it("shows no message while the video renders, only its progress", () => {
    const wrapper = mountButton({ phase: CreationPhase.CreatingVideo, progress: 0.5 });

    expect(wrapper.find("b-message").exists()).toBe(false);
    expect(wrapper.find(".progress-label").text()).toBe("Creating video: 50%");
  });

  it("says the video is waiting on a separation that was already running", () => {
    const wrapper = mountButton({ waitingForSeparation: true });

    expect(wrapper.text()).toContain("Waiting for the track separation");
  });

  it("estimates from the elapsed time when the job reports no figure", () => {
    const wrapper = mountButton({
      songDuration: 100,
      elapsedTime: 25000,
    });

    expect(wrapper.find(".progress-label").text()).toContain("25%");
  });

  it("leaves the bar indeterminate with nothing to report or estimate from", () => {
    const wrapper = mountButton({});

    expect(wrapper.find("button").classes()).toContain("is-indeterminate");
    expect(wrapper.find(".progress-label").text()).toBe("Separating the vocals...");
  });

  it("does not estimate while the song is waiting in line", () => {
    const wrapper = mountButton({
      songDuration: 100,
      elapsedTime: 25000,
      separationStage: "waiting in line, 2 songs ahead",
      separationSongsAhead: 2,
    });

    expect(wrapper.find("button").classes()).toContain("is-indeterminate");
    expect(wrapper.find(".progress-label").text()).toBe("Waiting in line, 2 songs ahead...");
  });

  it("reports the render step once the video starts", () => {
    const wrapper = mountButton({
      phase: CreationPhase.CreatingVideo,
      progress: 0.5,
      step: "rendering the video",
    });

    expect(wrapper.find(".progress-label").text()).toBe("Rendering the video: 50%");
  });

  it("ignores a click that lands right after the one that started the video", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountButton({});

      await wrapper.find("button").trigger("click");
      expect(wrapper.emitted("cancel")).toBeUndefined();

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();
      expect(wrapper.find("button").classes()).toContain("is-cancellable");
      await wrapper.find("button").trigger("click");
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
