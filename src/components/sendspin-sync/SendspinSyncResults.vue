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
          <span class="min-w-0 truncate">{{ row.name }}</span>
          <span
            v-if="row.offset === null"
            class="shrink-0 text-sm text-destructive"
          >
            {{ $t(`${KEYS}.results.unheard`) }}
          </span>
          <span v-else class="shrink-0 font-mono">
            {{ $t(`${KEYS}.results.milliseconds`, [row.offset]) }}
            <span v-if="row.applied !== null" class="text-muted-foreground">
              {{ $t(`${KEYS}.results.applied_delay`, [row.applied]) }}
            </span>
          </span>
        </li>
      </ul>

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
        :disabled="disabled || !trustworthy || applied !== null"
        @click="emit('apply')"
      >
        <Spinner v-if="disabled" class="size-4" aria-hidden="true" />
        <Check v-else class="size-4" aria-hidden="true" />
        {{
          applied ? $t(`${KEYS}.results.applied`) : $t(`${KEYS}.results.apply`)
        }}
      </Button>
      <Button variant="outline" :disabled="disabled" @click="emit('finish')">
        {{ $t(`${KEYS}.results.finish`) }}
      </Button>
    </CardFooter>
  </Card>
</template>

<script setup lang="ts">
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
import type { CalibrationPlayer } from "@/plugins/api/interfaces";
import { Check } from "@lucide/vue";
import { computed } from "vue";

const KEYS = "providers.sendspin_sync.calibration";

const {
  players,
  selected,
  fit,
  verdict,
  applied,
  trustworthy,
  anchor,
  disabled,
} = defineProps<{
  players: CalibrationPlayer[];
  /** Every speaker the run set out to measure, in the order it walked them. */
  selected: string[];
  fit: LatencyFit;
  verdict: RunVerdict;
  /** The delay the server actually set per speaker, once applied. */
  applied: Record<string, number> | null;
  trustworthy: boolean;
  anchor: string | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ apply: []; finish: [] }>();

const names = computed(
  () => new Map(players.map((player) => [player.player_id, player.name])),
);

const anchorName = computed(() =>
  anchor ? (names.value.get(anchor) ?? anchor) : "",
);

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
  selected
    .filter((playerId) => !(playerId in fit.offsetsMs))
    .map((playerId) => names.value.get(playerId) ?? playerId),
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
  selected.map((playerId) => ({
    playerId,
    name: names.value.get(playerId) ?? playerId,
    offset:
      playerId in fit.offsetsMs ? fit.offsetsMs[playerId].toFixed(2) : null,
    applied: applied?.[playerId] ?? null,
  })),
);
</script>
