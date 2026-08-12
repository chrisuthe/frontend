import SendspinSyncResults from "@/components/sendspin-sync/SendspinSyncResults.vue";
import type { LatencyFit } from "@/helpers/sendspin-sync/latencyFit";
import { runVerdict } from "@/helpers/sendspin-sync/verdict";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

const PLAYERS = [
  { player_id: "living", name: "Living room", busy: false },
  { player_id: "kitchen", name: "Kitchen", busy: false },
];

const BASE = "providers.sendspin_sync.calibration.results";

function fitFixture(overrides: Partial<LatencyFit> = {}): LatencyFit {
  return {
    offsetsMs: { living: 0, kitchen: 12.345 },
    rateRatio: 1.00004,
    rateErrorPpm: 40,
    residualMs: 0.03,
    bracketSpanSeconds: 90,
    bracketResidualMs: null,
    runSpanSeconds: 100,
    visits: [],
    used: 30,
    rejected: 1,
    ...overrides,
  };
}

function mountResults(
  props: Partial<InstanceType<typeof SendspinSyncResults>["$props"]> = {},
) {
  return mount(SendspinSyncResults, {
    props: {
      players: PLAYERS,
      selected: ["living", "kitchen"],
      fit: fitFixture(),
      // Derived rather than hand-set, so a test cannot describe a run the verdict
      // helper would never actually produce.
      verdict: runVerdict(
        (props.fit as LatencyFit | undefined) ?? fitFixture(),
        ["living", "kitchen"],
      ),
      applied: null,
      trustworthy: true,
      anchor: "living",
      disabled: false,
      ...props,
    },
    global: { mocks: { $t: (key: string) => key } },
  });
}

/** The Apply button, which is always the first in the footer. */
function applyButton(wrapper: ReturnType<typeof mountResults>) {
  return wrapper.findAll("button")[0];
}

describe("SendspinSyncResults", () => {
  it("shows one offset per speaker, by name", () => {
    const rows = mountResults().findAll("li");

    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Living room");
    expect(rows[1].text()).toContain("Kitchen");
  });

  it("says the rate was pinned, not checked, when one repeat set it", () => {
    const wrapper = mountResults();

    // The usual case, and the one most easily misread: a single repeat determines
    // the clock rate and so cannot also test it.
    expect(wrapper.text()).toContain(`${BASE}.check.pinned.title`);
    expect(applyButton(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("asks for a second reading when nothing was measured twice", () => {
    const wrapper = mountResults({
      fit: fitFixture({ bracketSpanSeconds: null }),
      trustworthy: false,
    });

    expect(wrapper.text()).toContain(`${BASE}.check.unbracketed.title`);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("blames the scatter when the arrivals do not sit on the line", () => {
    const wrapper = mountResults({
      fit: fitFixture({ residualMs: 4.2 }),
      trustworthy: false,
    });

    expect(wrapper.text()).toContain(`${BASE}.check.scattered.title`);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("says the bracket was too quick when the two readings were close", () => {
    const wrapper = mountResults({
      fit: fitFixture({ bracketSpanSeconds: 8, runSpanSeconds: 200 }),
      trustworthy: false,
    });

    expect(wrapper.text()).toContain(`${BASE}.check.short_bracket.title`);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("names a speaker it never heard, and refuses to apply without it", () => {
    const wrapper = mountResults({
      fit: fitFixture({ offsetsMs: { living: 0 } }),
      trustworthy: false,
    });

    // Leaving it out of the payload would make the mismatch worse, not better:
    // the server moves the speakers it is given and leaves this one where it was.
    expect(wrapper.text()).toContain(`${BASE}.check.unmeasured.title`);
    expect(wrapper.text()).toContain(`${BASE}.unheard`);
    expect(wrapper.findAll("li")).toHaveLength(2);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("blames a single spoiled reading even when the run-wide scatter is fine", () => {
    const wrapper = mountResults({
      fit: fitFixture({
        residualMs: 0.03,
        visits: [
          {
            visit: 0,
            playerId: "living",
            samples: 10,
            used: 10,
            meanResidualMs: 0,
            spreadMs: 0.05,
          },
          {
            visit: 1,
            playerId: "kitchen",
            samples: 10,
            used: 10,
            meanResidualMs: 0,
            spreadMs: 6,
          },
        ],
      }),
      trustworthy: false,
    });

    // The run-wide figure is a median, so one bad speaker out of several leaves it
    // untouched; the per-reading spread is what catches it.
    expect(wrapper.text()).toContain(`${BASE}.check.scattered.title`);
  });

  it("reports a real cross-check once there were repeats enough for one", () => {
    const wrapper = mountResults({
      fit: fitFixture({ bracketResidualMs: 0.4 }),
    });

    expect(wrapper.text()).toContain(`${BASE}.check.checked.title`);
  });

  it("refuses a run whose repeated readings disagree", () => {
    const wrapper = mountResults({
      fit: fitFixture({ bracketResidualMs: 3.1 }),
      trustworthy: false,
    });

    expect(wrapper.text()).toContain(`${BASE}.check.disagrees.title`);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("announces its verdict, since it is what the walk was for", () => {
    expect(mountResults().find('[role="status"]').exists()).toBe(true);
  });

  it("hands the offsets over when asked", async () => {
    const wrapper = mountResults();

    await applyButton(wrapper).trigger("click");

    expect(wrapper.emitted("apply")).toHaveLength(1);
  });

  it("shows the delay the server actually set, and will not apply twice", () => {
    const wrapper = mountResults({ applied: { living: 12, kitchen: 0 } });

    expect(wrapper.findAll("li")[0].text()).toContain(`${BASE}.applied_delay`);
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("can be finished without applying anything", async () => {
    const wrapper = mountResults({ trustworthy: false });

    await wrapper.findAll("button")[1].trigger("click");

    expect(wrapper.emitted("finish")).toHaveLength(1);
  });
});
