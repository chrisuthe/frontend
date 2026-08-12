<template>
  <Card class="gap-4">
    <CardHeader>
      <CardTitle>{{ $t(`${KEYS}.results.title`) }}</CardTitle>
      <CardDescription>{{ $t(`${KEYS}.results.description`) }}</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      <ul class="divide-y border-t">
        <li
          v-for="row in rows"
          :key="row.playerId"
          class="flex items-center justify-between gap-3 py-3"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate">{{ row.name }}</span>
            <Badge v-if="row.byHand" variant="secondary" class="shrink-0">
              {{ $t(`${KEYS}.manual.badge`) }}
            </Badge>
          </span>
          <span
            v-if="row.offset === null"
            class="shrink-0 text-sm text-destructive"
          >
            {{ $t(`${KEYS}.results.unheard`) }}
          </span>
          <span v-else class="shrink-0 font-mono">
            {{ $t(`${KEYS}.results.milliseconds`, [row.offset]) }}
            <!-- An amount to add to what the device already applies, where the
                 delay below it is absolute and already in place. The two mean
                 opposite things, so this one is not dimmed the way that one is
                 and its wording leads with "add". -->
            <span v-if="row.manual !== null" class="font-medium">
              {{ $t(`${KEYS}.manual.row`, [row.manual]) }}
            </span>
            <span
              v-else-if="row.applied !== null"
              class="text-muted-foreground"
            >
              {{ $t(`${KEYS}.results.applied_delay`, [row.applied]) }}
            </span>
          </span>
        </li>
      </ul>

      <!-- Only once the server has said which speakers it could not write to, and
           what it worked out for them: before that the numbers above are raw
           readings, not delays anyone should be copying onto a device. -->
      <Alert v-if="manualNames.length" variant="info">
        <Wrench class="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{{ $t(`${KEYS}.manual.title`) }}</AlertTitle>
        <AlertDescription>
          {{ $t(`${KEYS}.manual.description`, [manualNames.join(", ")]) }}
        </AlertDescription>
      </Alert>

      <!-- What this run does and does not establish about itself, said in those
           terms: a number here that read as a pass either way would be worse than
           no number at all. -->
      <div
        class="rounded-md border p-3"
        :class="trustworthy ? '' : 'border-destructive'"
        role="status"
        aria-live="polite"
      >
        <p class="font-medium">
          {{ $t(`${KEYS}.results.check.${verdict}.title`) }}
        </p>
        <p class="text-sm text-muted-foreground">
          {{
            $t(`${KEYS}.results.check.${verdict}.description`, verdictValues)
          }}
        </p>
      </div>

      <dl
        class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
      >
        <dt class="text-muted-foreground">{{ $t(`${KEYS}.results.clock`) }}</dt>
        <dd class="font-mono">
          {{ $t(`${KEYS}.results.ppm`, [fit.rateErrorPpm.toFixed(1)]) }}
        </dd>
        <dt class="text-muted-foreground">
          {{ $t(`${KEYS}.results.scatter`) }}
        </dt>
        <dd class="font-mono">
          {{ $t(`${KEYS}.results.milliseconds`, [fit.residualMs.toFixed(2)]) }}
        </dd>
        <dt class="text-muted-foreground">
          {{ $t(`${KEYS}.results.arrivals`) }}
        </dt>
        <dd class="font-mono">
          {{ $t(`${KEYS}.results.used`, [fit.used, fit.rejected]) }}
        </dd>
      </dl>
    </CardContent>

    <CardFooter class="flex-col items-stretch gap-2 sm:flex-row">
      <Button
        :disabled="disabled || !trustworthy || applyResult !== null"
        @click="emit('apply')"
      >
        <Spinner v-if="disabled" class="size-4" aria-hidden="true" />
        <Check v-else class="size-4" aria-hidden="true" />
        {{ $t(`${KEYS}.results.${doneLabel}`) }}
      </Button>
      <Button variant="outline" :disabled="disabled" @click="emit('finish')">
        {{ $t(`${KEYS}.results.finish`) }}
      </Button>
    </CardFooter>
  </Card>
</template>

<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { LatencyFit } from "@/helpers/sendspin-sync/latencyFit";
import {
  BRACKET_LIMIT_MS,
  SCATTER_LIMIT_MS,
  worstSpreadMs,
  type RunVerdict,
} from "@/helpers/sendspin-sync/verdict";
import type {
  CalibrationApplyResult,
  CalibrationPlayer,
} from "@/plugins/api/interfaces";
import { Check, Wrench } from "@lucide/vue";
import { computed } from "vue";

const KEYS = "providers.sendspin_sync.calibration";

const {
  players,
  selected,
  fit,
  verdict,
  applyResult,
  trustworthy,
  anchor,
  disabled,
} = defineProps<{
  players: CalibrationPlayer[];
  /** Every speaker the run set out to measure, in the order it walked them. */
  selected: string[];
  fit: LatencyFit;
  verdict: RunVerdict;
  /** The delays the server worked out, split by whether it could write them. */
  applyResult: CalibrationApplyResult | null;
  trustworthy: boolean;
  anchor: string | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ apply: []; finish: [] }>();

const byId = computed(
  () => new Map(players.map((player) => [player.player_id, player])),
);

/** The speaker's name, falling back to its id if the server stopped listing it. */
function nameOf(playerId: string): string {
  return byId.value.get(playerId)?.name ?? playerId;
}

const anchorName = computed(() => (anchor ? nameOf(anchor) : ""));

/** The readings the verdict's wording needs filled in. */
const verdictValues = computed(() => {
  switch (verdict) {
    case "unmeasured":
      return [unheard.value.join(", ")];
    case "unbracketed":
    case "short_bracket":
      return [anchorName.value];
    case "scattered":
      return [
        Math.max(fit.residualMs, worstSpreadMs(fit)).toFixed(2),
        SCATTER_LIMIT_MS,
      ];
    case "pinned":
      return [Math.round((fit.bracketSpanSeconds ?? 0) / 60)];
    default:
      return [(fit.bracketResidualMs ?? 0).toFixed(2), BRACKET_LIMIT_MS];
  }
});

/** Speakers the walk never actually heard, by name. */
const unheard = computed(() =>
  selected.filter((playerId) => !(playerId in fit.offsetsMs)).map(nameOf),
);

/**
 * One row per speaker the run set out to measure — not per speaker it managed to.
 *
 * A speaker with no offset is listed as unheard rather than left out. Omitting it
 * would be worse than useless: the server re-normalises the delays of the
 * speakers it is given, so a silently missing one keeps its old delay while
 * everything else moves around it.
 */
const rows = computed(() =>
  selected.map((playerId) => {
    const manual = applyResult?.manual[playerId] ?? null;
    return {
      playerId,
      name: nameOf(playerId),
      // Which speakers need a hand is the server's call, and it only makes it at
      // write time — a speaker it expected to take a delay can still come back
      // under `manual`. Its own flag stands in until then, defaulting to needing
      // one for a speaker it no longer lists: claiming otherwise would promise an
      // adjustment nothing is going to make.
      byHand: applyResult
        ? manual !== null
        : !(byId.value.get(playerId)?.adjustable ?? false),
      offset:
        playerId in fit.offsetsMs ? fit.offsetsMs[playerId].toFixed(2) : null,
      applied: applyResult?.applied[playerId] ?? null,
      manual,
    };
  }),
);

/** The speakers the server left a delay to be added by hand on, by name. */
const manualNames = computed(() =>
  rows.value.filter((row) => row.manual !== null).map((row) => row.name),
);

/**
 * How the Apply button reads once it has been pressed.
 *
 * A run where nothing could be written did still produce every delay it set out
 * to; calling that "Delays applied" would claim the devices were changed.
 */
const doneLabel = computed(() => {
  if (!applyResult) return "apply";
  return Object.keys(applyResult.applied).length ? "applied" : "worked_out";
});
</script>
