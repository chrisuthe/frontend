<template>
  <Card class="gap-4">
    <!-- One ask at a time, and it is what the user is waiting on, so it is what
         gets announced when it changes. -->
    <CardHeader role="status" aria-live="polite">
      <CardTitle>{{
        $t(`${KEYS}.walk.step.${step}.title`, promptValues)
      }}</CardTitle>
      <CardDescription>
        {{ $t(`${KEYS}.walk.step.${step}.description`, promptValues) }}
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <Button
          v-for="target in targets"
          :key="target.playerId"
          :variant="target.asked ? 'default' : 'outline'"
          class="h-auto min-h-16 w-full justify-start gap-3 px-4 py-3 text-left whitespace-normal has-[>svg]:px-4"
          :disabled="disabled"
          @click="emit('measure', target.playerId)"
        >
          <!-- Ahead of the name so the button announces as an action rather than
               as a speaker that happens to be pressable. -->
          <span class="sr-only">
            {{ $t(`${KEYS}.walk.${target.reading ? "again" : "measure"}`) }}
          </span>
          <Spinner
            v-if="measuring === target.playerId"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          <Check
            v-else-if="target.reading"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          <Mic v-else class="size-5 shrink-0" aria-hidden="true" />

          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-base leading-tight font-medium">
              {{ target.name }}
            </span>
            <span class="text-sm font-normal opacity-80">
              {{
                target.reading
                  ? $t(`${KEYS}.walk.found`, [
                      target.reading.found,
                      target.reading.expected,
                    ])
                  : $t(`${KEYS}.walk.not_measured`)
              }}
            </span>
          </span>

          <Badge
            v-if="target.confidence"
            :variant="CONFIDENCE_VARIANT[target.confidence]"
            class="shrink-0"
          >
            {{ $t(`${KEYS}.confidence.${target.confidence}`) }}
          </Badge>
        </Button>
      </div>

      <!-- Deliberately not a live region: the countdown would talk over the
           screen reader for the whole recording. -->
      <p class="text-sm text-muted-foreground">
        {{ measuring ? $t(`${KEYS}.walk.listening`) : $t(`${KEYS}.walk.how`) }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Badge, type BadgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { Measurement } from "@/composables/sendspin-sync/useCalibrationRun";
import {
  measurementConfidence,
  type Confidence,
} from "@/helpers/sendspin-sync/confidence";
import type { CalibrationPlayer } from "@/plugins/api/interfaces";
import { Check, Mic } from "@lucide/vue";
import { computed } from "vue";

const KEYS = "providers.sendspin_sync.calibration";

const CONFIDENCE_VARIANT: Record<Confidence, BadgeVariants["variant"]> = {
  good: "default",
  weak: "warning",
  poor: "destructive",
};

/** Where the walk has got to, which is the one thing the screen asks for. */
type Step = "start" | "next" | "repeat" | "check" | "done";

const {
  players,
  selected,
  visits,
  anchor,
  needsBracket,
  needsCheck,
  disabled,
  measuring,
} = defineProps<{
  players: CalibrationPlayer[];
  selected: string[];
  visits: Measurement[];
  /** The speaker measured first, which the repeat is asked of. */
  anchor: string | null;
  needsBracket: boolean;
  needsCheck: boolean;
  disabled: boolean;
  /** The speaker currently being recorded, if any. */
  measuring: string | null;
}>();

const emit = defineEmits<{ measure: [playerId: string] }>();

const names = computed(
  () => new Map(players.map((player) => [player.player_id, player.name])),
);

function nameOf(playerId: string): string {
  return names.value.get(playerId) ?? playerId;
}

/** The most recent reading of each speaker, by player id. */
const readings = computed(() => {
  const latest = new Map<string, Measurement>();
  for (const visit of visits) latest.set(visit.playerId, visit);
  return latest;
});

/**
 * The speaker to repeat once the clock rate is pinned but untested.
 *
 * The earliest measured of those still read only once, because the second
 * reading has to sit far enough from the first to say anything: the same reason
 * the walk asks for the anchor at the end rather than in the middle.
 */
const checkTarget = computed(() => {
  const counts = new Map<string, number>();
  for (const visit of visits)
    counts.set(visit.playerId, (counts.get(visit.playerId) ?? 0) + 1);
  return (
    visits.find((visit) => counts.get(visit.playerId) === 1)?.playerId ?? null
  );
});

const step = computed<Step>(() => {
  if (!visits.length) return "start";
  if (selected.some((playerId) => !readings.value.has(playerId))) return "next";
  if (needsBracket && anchor) return "repeat";
  if (needsCheck && checkTarget.value) return "check";
  return "done";
});

/** The speaker the current step names, if it names one. */
const asked = computed(() => {
  switch (step.value) {
    case "repeat":
      return anchor;
    case "check":
      return checkTarget.value;
    default:
      return null;
  }
});

/** What the current step's wording has to fill in. */
const promptValues = computed(() =>
  step.value === "next"
    ? [readings.value.size, selected.length]
    : [asked.value ? nameOf(asked.value) : ""],
);

/**
 * One button per speaker, in the order they were picked.
 *
 * `asked` marks the speakers this step is asking for, which is the only thing
 * the emphasis means — every speaker stays pressable at every step, because
 * going out of order measures perfectly well and re-measuring is what the
 * closing steps ask for outright.
 */
const targets = computed(() =>
  selected.map((playerId) => {
    const reading = readings.value.get(playerId) ?? null;
    return {
      playerId,
      name: nameOf(playerId),
      reading,
      confidence: reading ? measurementConfidence(reading) : null,
      asked:
        asked.value === null
          ? step.value !== "done" && !reading
          : asked.value === playerId,
    };
  }),
);
</script>
