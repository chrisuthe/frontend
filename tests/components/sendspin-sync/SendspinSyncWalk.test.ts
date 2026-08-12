import SendspinSyncWalk from "@/components/sendspin-sync/SendspinSyncWalk.vue";
import type { Measurement } from "@/composables/sendspin-sync/useCalibrationRun";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false, adjustable: true },
  { player_id: "kitchen", name: "Kitchen", busy: false, adjustable: true },
];

function reading(overrides: Partial<Measurement> = {}): Measurement {
  return {
    visit: 0,
    playerId: "living",
    found: 10,
    expected: 10,
    medianSnr: 40,
    dropouts: 0,
    ...overrides,
  };
}

function mountWalk(
  props: Partial<InstanceType<typeof SendspinSyncWalk>["$props"]> = {},
) {
  return mount(SendspinSyncWalk, {
    props: {
      players: PLAYERS,
      selected: ["living", "kitchen"],
      visits: [],
      anchor: "living",
      needsBracket: false,
      disabled: false,
      measuring: null,
      ...props,
    },
    global: { mocks: { $t: (key: string) => key } },
  });
}

/** The one button styled as the primary action, if any. */
function primaryButton(wrapper: ReturnType<typeof mountWalk>) {
  return wrapper
    .findAll("button")
    .find((button) => !button.classes().join(" ").includes("border-input"));
}

describe("SendspinSyncWalk", () => {
  it("lists the speakers in the order they will be walked", () => {
    const rows = mountWalk().findAll("li");

    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Living room");
    expect(rows[1].text()).toContain("Kitchen");
  });

  it("asks for a measurement when a speaker's button is pressed", async () => {
    const wrapper = mountWalk();

    await wrapper.findAll("li")[1].find("button").trigger("click");

    expect(wrapper.emitted("measure")).toEqual([["kitchen"]]);
  });

  it("points at the first speaker still outstanding", () => {
    const wrapper = mountWalk({ visits: [reading()] });

    // Exactly one primary action, so there is never a question of what to do next.
    expect(primaryButton(wrapper)?.text()).toContain(
      "providers.sendspin_sync.calibration.walk.measure",
    );
    expect(wrapper.findAll("li")[1].text()).toContain("Kitchen");
  });

  it("points back at the first speaker once the rest are done", () => {
    const wrapper = mountWalk({
      visits: [reading(), reading({ visit: 1, playerId: "kitchen" })],
      needsBracket: true,
    });

    expect(wrapper.text()).toContain(
      "providers.sendspin_sync.calibration.walk.bracket.title",
    );
    // The prompt is what the user is waiting on, so it is announced.
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.findAll("li")[0].text()).toContain(
      "providers.sendspin_sync.calibration.walk.again",
    );
  });

  it("shows how many chirps each speaker gave up, and how good they were", () => {
    const wrapper = mountWalk({
      visits: [
        reading({ found: 10, expected: 10, medianSnr: 40 }),
        reading({ visit: 1, playerId: "kitchen", found: 4, expected: 10 }),
      ],
    });

    const rows = wrapper.findAll("li");
    expect(rows[0].text()).toContain(
      "providers.sendspin_sync.calibration.confidence.good",
    );
    expect(rows[1].text()).toContain(
      "providers.sendspin_sync.calibration.confidence.weak",
    );
    expect(rows[1].text()).toContain(
      "providers.sendspin_sync.calibration.walk.found",
    );
  });

  it("shows the most recent reading of a speaker measured twice", () => {
    const wrapper = mountWalk({
      visits: [
        reading({ found: 10, medianSnr: 40 }),
        reading({ visit: 2, found: 2, expected: 10, medianSnr: 40 }),
      ],
    });

    expect(wrapper.findAll("li")[0].text()).toContain(
      "providers.sendspin_sync.calibration.confidence.poor",
    );
  });

  it("locks the buttons while a recording is running", () => {
    const wrapper = mountWalk({ disabled: true, measuring: "living" });

    for (const button of wrapper.findAll("button"))
      expect(button.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(
      "providers.sendspin_sync.calibration.walk.listening",
    );
  });
});
