import SendspinSyncPlayerPicker from "@/components/sendspin-sync/SendspinSyncPlayerPicker.vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

const KEYS = "providers.sendspin_sync.calibration.pick";

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false },
  { player_id: "kitchen", name: "Kitchen", busy: true },
];

function mountPicker(
  props: Partial<InstanceType<typeof SendspinSyncPlayerPicker>["$props"]> = {},
) {
  return mount(SendspinSyncPlayerPicker, {
    props: {
      players: PLAYERS,
      selected: [],
      disabled: false,
      ...props,
    },
    global: { mocks: { $t: (key: string) => key } },
  });
}

/** The Start button, which is the only one in the footer. */
function startButton(wrapper: ReturnType<typeof mountPicker>) {
  return wrapper.findAll("button").at(-1)!;
}

describe("SendspinSyncPlayerPicker", () => {
  it("lists every speaker a session can run against", () => {
    const wrapper = mountPicker();

    expect(wrapper.text()).toContain("Living room");
    expect(wrapper.text()).toContain("Kitchen");
    // The group is labelled for a screen reader without repeating on screen.
    expect(wrapper.find("legend").classes()).toContain("sr-only");
  });

  it("marks a speaker that is playing the user's own content", () => {
    expect(mountPicker().text()).toContain(`${KEYS}.busy`);
  });

  it("says there is nothing to calibrate rather than an empty list", () => {
    const wrapper = mountPicker({ players: [] });

    expect(wrapper.text()).toContain(`${KEYS}.none.title`);
    expect(wrapper.find("fieldset").exists()).toBe(false);
  });

  it("keeps the order the speakers were ticked in", async () => {
    const wrapper = mountPicker({ selected: ["kitchen"] });

    await wrapper.findAll('[data-slot="checkbox"]')[0].trigger("click");

    // That order is the order they will be walked, and the first one is what every
    // other reading ends up relative to.
    expect(wrapper.emitted("update:selected")).toEqual([
      [["kitchen", "living"]],
    ]);
  });

  it("removes a speaker that is ticked off again", async () => {
    const wrapper = mountPicker({ selected: ["living", "kitchen"] });

    await wrapper.findAll('[data-slot="checkbox"]')[0].trigger("click");

    expect(wrapper.emitted("update:selected")).toEqual([[["kitchen"]]]);
  });

  it("will not start against fewer than two speakers", () => {
    expect(startButton(mountPicker()).attributes("disabled")).toBeDefined();
    expect(
      startButton(mountPicker({ selected: ["living"] })).attributes("disabled"),
    ).toBeDefined();
    expect(
      startButton(mountPicker({ selected: ["living", "kitchen"] })).attributes(
        "disabled",
      ),
    ).toBeUndefined();
  });

  it("warns before taking a speaker off what it was playing", async () => {
    const wrapper = mountPicker({ selected: ["living", "kitchen"] });

    expect(wrapper.text()).toContain(`${KEYS}.takeover.title`);
    expect(wrapper.text()).toContain(`${KEYS}.start_takeover`);

    // The flag tells the run to force the takeover the user has now been shown.
    await startButton(wrapper).trigger("click");
    expect(wrapper.emitted("start")).toEqual([[true]]);
  });

  it("does not mention a takeover when nothing picked is playing", async () => {
    const wrapper = mountPicker({
      players: [PLAYERS[0], { ...PLAYERS[1], busy: false }],
      selected: ["living", "kitchen"],
    });

    expect(wrapper.text()).not.toContain(`${KEYS}.takeover.title`);

    await startButton(wrapper).trigger("click");
    expect(wrapper.emitted("start")).toEqual([[false]]);
  });
});
