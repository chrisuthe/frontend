import SendspinSyncWalk from "@/components/sendspin-sync/SendspinSyncWalk.vue";
import type { Measurement } from "@/composables/sendspin-sync/useCalibrationRun";
import { CHIRP_PERIOD_SECONDS } from "@/helpers/sendspin-sync/chirp";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

const KEYS = "providers.sendspin_sync.calibration";

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false, adjustable: true },
  { player_id: "kitchen", name: "Kitchen", busy: false, adjustable: true },
  { player_id: "study", name: "Study", busy: false, adjustable: true },
];

const SELECTED = ["living", "kitchen", "study"];

function reading(overrides: Partial<Measurement> = {}): Measurement {
  return {
    visit: 0,
    playerId: "living",
    found: 7,
    expected: 7,
    medianSnr: 40,
    dropouts: 0,
    lostFraction: 0,
    spacingSeconds: CHIRP_PERIOD_SECONDS,
    ...overrides,
  };
}

function mountWalk(
  props: Partial<InstanceType<typeof SendspinSyncWalk>["$props"]> = {},
) {
  return mount(SendspinSyncWalk, {
    props: {
      players: PLAYERS,
      selected: SELECTED,
      visits: [],
      anchor: null,
      needsBracket: false,
      needsCheck: false,
      disabled: false,
      measuring: null,
      ...props,
    },
    // Interpolations are appended so a test can assert which speaker a step names.
    global: {
      mocks: {
        $t: (key: string, values: unknown[] = []) =>
          values.length ? `${key} ${values.join(" ")}` : key,
      },
    },
  });
}

type Walk = ReturnType<typeof mountWalk>;

/** The buttons styled as the action being asked for, by speaker name. */
function askedFor(wrapper: Walk): string[] {
  return wrapper
    .findAll("button")
    .filter((button) => button.classes().includes("bg-primary"))
    .map((button) => button.text());
}

function buttonFor(wrapper: Walk, name: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate) => candidate.text().includes(name));
  if (!button) throw new Error(`no button for ${name}`);
  return button;
}

describe("SendspinSyncWalk", () => {
  it("asks only where to start before anything is measured", () => {
    const wrapper = mountWalk();

    expect(wrapper.find("[data-slot=card-header]").text()).toContain(
      `${KEYS}.walk.step.start.title`,
    );
    // No speaker is the right one to begin at, so none is singled out.
    expect(askedFor(wrapper)).toHaveLength(3);
  });

  it("offers every speaker at every step, in the order they were picked", () => {
    const buttons = mountWalk({
      visits: [reading()],
      anchor: "living",
    }).findAll("button");

    expect(buttons.map((button) => button.text().split("\n")[0])).toHaveLength(
      3,
    );
    expect(buttons[0].text()).toContain("Living room");
    expect(buttons[1].text()).toContain("Kitchen");
    expect(buttons[2].text()).toContain("Study");
  });

  it("asks for a measurement when a speaker is pressed", async () => {
    const wrapper = mountWalk();

    await buttonFor(wrapper, "Kitchen").trigger("click");

    expect(wrapper.emitted("measure")).toEqual([["kitchen"]]);
  });

  it("keeps asking for unmeasured speakers without naming one", () => {
    const wrapper = mountWalk({
      visits: [reading({ playerId: "kitchen" })],
      anchor: "kitchen",
    });

    const header = wrapper.find("[data-slot=card-header]").text();
    expect(header).toContain(`${KEYS}.walk.step.next.title`);
    // How far along the walk is, rather than which speaker comes next.
    expect(header).toContain(`${KEYS}.walk.step.next.description 1 3`);
    expect(askedFor(wrapper)).toHaveLength(2);
    expect(askedFor(wrapper).join(" ")).not.toContain("Kitchen");
  });

  /**
   * The case the old highlight got wrong: the walk follows where the user
   * actually went, not the order the speakers were ticked in.
   */
  it("follows an out-of-order walk", async () => {
    const wrapper = mountWalk({
      visits: [
        reading({ playerId: "study" }),
        reading({ visit: 1, playerId: "kitchen" }),
      ],
      anchor: "study",
    });

    expect(askedFor(wrapper)).toEqual([expect.stringContaining("Living room")]);

    await buttonFor(wrapper, "Living room").trigger("click");
    expect(wrapper.emitted("measure")).toEqual([["living"]]);

    // And the repeat is asked of the speaker actually measured first.
    await wrapper.setProps({
      visits: [
        reading({ playerId: "study" }),
        reading({ visit: 1, playerId: "kitchen" }),
        reading({ visit: 2, playerId: "living" }),
      ],
      needsBracket: true,
    });

    const header = wrapper.find("[data-slot=card-header]").text();
    expect(header).toContain(`${KEYS}.walk.step.repeat.title Study`);
    expect(askedFor(wrapper)).toEqual([expect.stringContaining("Study")]);
  });

  it("names a second speaker to repeat once one more would check the run", () => {
    const wrapper = mountWalk({
      visits: [
        reading(),
        reading({ visit: 1, playerId: "kitchen" }),
        reading({ visit: 2, playerId: "study" }),
        reading({ visit: 3, playerId: "living" }),
      ],
      anchor: "living",
      needsCheck: true,
    });

    // The earliest speaker still read once, so the repeat spans as much of the
    // walk as is left to span.
    const header = wrapper.find("[data-slot=card-header]").text();
    expect(header).toContain(`${KEYS}.walk.step.check.title Kitchen`);
    expect(askedFor(wrapper)).toEqual([expect.stringContaining("Kitchen")]);
  });

  it("stops asking for anything once the run needs nothing more", () => {
    const wrapper = mountWalk({
      visits: [
        reading(),
        reading({ visit: 1, playerId: "kitchen" }),
        reading({ visit: 2, playerId: "study" }),
        reading({ visit: 3, playerId: "living" }),
        reading({ visit: 4, playerId: "kitchen" }),
      ],
      anchor: "living",
    });

    expect(wrapper.find("[data-slot=card-header]").text()).toContain(
      `${KEYS}.walk.step.done.title`,
    );
    expect(askedFor(wrapper)).toHaveLength(0);
    // Still pressable, because re-measuring is always allowed.
    for (const button of wrapper.findAll("button"))
      expect(button.attributes("disabled")).toBeUndefined();
  });

  it("shows measured speakers as measured, and how good the reading was", () => {
    const wrapper = mountWalk({
      visits: [
        reading({ found: 7, expected: 7, medianSnr: 40 }),
        reading({ visit: 1, playerId: "kitchen", found: 3, expected: 7 }),
      ],
      anchor: "living",
    });

    expect(buttonFor(wrapper, "Living room").text()).toContain(
      `${KEYS}.confidence.good`,
    );
    expect(buttonFor(wrapper, "Kitchen").text()).toContain(
      `${KEYS}.confidence.weak`,
    );
    expect(buttonFor(wrapper, "Kitchen").text()).toContain(
      `${KEYS}.walk.found 3 7`,
    );
    expect(buttonFor(wrapper, "Study").text()).toContain(
      `${KEYS}.walk.not_measured`,
    );
  });

  it("shows the most recent reading of a speaker measured twice", () => {
    const wrapper = mountWalk({
      visits: [
        reading({ found: 7, medianSnr: 40 }),
        reading({ visit: 2, found: 1, expected: 7, medianSnr: 40 }),
      ],
      anchor: "living",
    });

    expect(buttonFor(wrapper, "Living room").text()).toContain(
      `${KEYS}.confidence.poor`,
    );
  });

  it("announces the step, so the ask is what a screen reader hears", () => {
    expect(mountWalk().find('[role="status"]').exists()).toBe(true);
  });

  it("locks the buttons while a recording is running", () => {
    const wrapper = mountWalk({ disabled: true, measuring: "living" });

    for (const button of wrapper.findAll("button"))
      expect(button.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(`${KEYS}.walk.listening`);
  });

  it("says how to hold the phone while nothing is recording", () => {
    expect(mountWalk().text()).toContain(`${KEYS}.walk.how`);
  });
});
