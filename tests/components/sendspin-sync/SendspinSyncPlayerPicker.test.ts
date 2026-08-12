import SendspinSyncPlayerPicker from "@/components/sendspin-sync/SendspinSyncPlayerPicker.vue";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

const KEYS = "providers.sendspin_sync.calibration.pick";
const MANUAL = "providers.sendspin_sync.calibration.manual";

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false, adjustable: true },
  { player_id: "kitchen", name: "Kitchen", busy: true, adjustable: true },
];

/**
 * Mount the picker.
 *
 * Attach to the document for a test that clicks a row: a label only forwards a
 * click to the control its `for` names once the tree is in the document.
 */
function mountPicker(
  props: Partial<InstanceType<typeof SendspinSyncPlayerPicker>["$props"]> = {},
  attachToDocument = false,
) {
  return mount(SendspinSyncPlayerPicker, {
    props: {
      players: PLAYERS,
      selected: [],
      disabled: false,
      ...props,
    },
    ...(attachToDocument ? { attachTo: document.body } : {}),
    global: { mocks: { $t: (key: string) => key } },
  });
}

/** The Start button, which is the only one in the footer. */
function startButton(wrapper: ReturnType<typeof mountPicker>) {
  return wrapper.findAll("button").at(-1)!;
}

describe("SendspinSyncPlayerPicker", () => {
  // An attached row left behind would shadow the next one: the checkbox finds
  // its label with a document-wide query, and the first match wins.
  enableAutoUnmount(afterEach);

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

  it("offers a speaker nothing can set a delay on, and says so", async () => {
    const wrapper = mountPicker({
      players: [PLAYERS[0], { ...PLAYERS[1], adjustable: false }],
    });

    expect(wrapper.text()).toContain(`${MANUAL}.badge`);
    // Leaving it out is the failure this marking exists to prevent: it is
    // measurable, and the number is the whole deliverable for it.
    expect(wrapper.text()).toContain(`${KEYS}.manual`);
    await wrapper.findAll('[data-slot="checkbox"]')[1].trigger("click");
    expect(wrapper.emitted("update:selected")).toEqual([[["kitchen"]]]);
  });

  it("says nothing about manual delays when every speaker takes one", () => {
    const wrapper = mountPicker();

    expect(wrapper.text()).not.toContain(`${MANUAL}.badge`);
    expect(wrapper.text()).not.toContain(`${KEYS}.manual`);
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

  it("ticks a speaker from anywhere on its row, not just the box", async () => {
    const wrapper = mountPicker({}, true);

    // The row is the label, so clicking the name forwards to its checkbox.
    await wrapper.find("label span").trigger("click");

    expect(wrapper.emitted("update:selected")).toEqual([[["living"]]]);
  });

  it("ignores the row while a run is already in flight", async () => {
    const wrapper = mountPicker({ disabled: true }, true);

    // Nothing on the row guards this — the disabled checkbox is what swallows
    // the click the label forwards to it.
    await wrapper.find("label span").trigger("click");

    expect(wrapper.emitted("update:selected")).toBeUndefined();
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
