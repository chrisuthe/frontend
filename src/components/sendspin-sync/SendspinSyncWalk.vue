<template>
  <Card class="gap-4">
    <CardHeader>
      <CardTitle>{{ $t(`${KEYS}.walk.title`) }}</CardTitle>
      <CardDescription>{{ $t(`${KEYS}.walk.description`) }}</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- What the user is waiting on, so it is what gets announced. -->
      <Alert
        v-if="needsBracket"
        role="status"
        aria-live="polite"
        variant="info"
      >
        <RotateCcw class="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{{ $t(`${KEYS}.walk.bracket.title`) }}</AlertTitle>
        <AlertDescription>
          {{ $t(`${KEYS}.walk.bracket.description`, [anchorName]) }}
        </AlertDescription>
      </Alert>

      <ul class="divide-y border-t">
        <li v-for="step in steps" :key="step.playerId" class="py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ step.name }}</p>
              <p class="text-sm text-muted-foreground">
                {{
                  step.reading
                    ? $t(`${KEYS}.walk.found`, [
                        step.reading.found,
                        step.reading.expected,
                      ])
                    : $t(`${KEYS}.walk.not_measured`)
                }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <Badge
                v-if="step.confidence"
                :variant="CONFIDENCE_VARIANT[step.confidence]"
              >
                {{ $t(`${KEYS}.confidence.${step.confidence}`) }}
              </Badge>
              <Button
                :variant="step.next ? 'default' : 'outline'"
                size="sm"
                :disabled="disabled"
                @click="emit('measure', step.playerId)"
              >
                <Spinner
                  v-if="measuring === step.playerId"
                  class="size-4"
                  aria-hidden="true"
                />
                <Mic v-else class="size-4" aria-hidden="true" />
                {{
                  step.reading
                    ? $t(`${KEYS}.walk.again`)
                    : $t(`${KEYS}.walk.measure`)
                }}
              </Button>
            </div>
          </div>
        </li>
      </ul>

      <!-- Deliberately not a live region: the countdown would talk over the
           screen reader for the whole recording. -->
      <p v-if="measuring" class="text-sm text-muted-foreground">
        {{ $t(`${KEYS}.walk.listening`) }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Mic, RotateCcw } from "@lucide/vue";
import { computed } from "vue";

const KEYS = "providers.sendspin_sync.calibration";

const CONFIDENCE_VARIANT: Record<Confidence, BadgeVariants["variant"]> = {
  good: "default",
  weak: "warning",
  poor: "destructive",
};

const { players, selected, visits, anchor, needsBracket, disabled, measuring } =
  defineProps<{
    players: CalibrationPlayer[];
    selected: string[];
    visits: Measurement[];
    anchor: string | null;
    needsBracket: boolean;
    disabled: boolean;
    /** The speaker currently being recorded, if any. */
    measuring: string | null;
  }>();

const emit = defineEmits<{ measure: [playerId: string] }>();

const names = computed(
  () => new Map(players.map((player) => [player.player_id, player.name])),
);

const anchorName = computed(() =>
  anchor ? (names.value.get(anchor) ?? anchor) : "",
);

/**
 * One row per speaker, carrying its most recent reading.
 *
 * The speaker to do next is marked so exactly one button reads as the primary
 * action — the bracketing re-measure of the first speaker once the rest are done,
 * and otherwise the first speaker still outstanding.
 */
const steps = computed(() => {
  const next = needsBracket
    ? anchor
    : (selected.find(
        (playerId) => !visits.some((visit) => visit.playerId === playerId),
      ) ?? null);

  return selected.map((playerId) => {
    const readings = visits.filter((visit) => visit.playerId === playerId);
    const reading = readings[readings.length - 1] ?? null;
    return {
      playerId,
      name: names.value.get(playerId) ?? playerId,
      reading,
      confidence: reading ? measurementConfidence(reading) : null,
      next: playerId === next,
    };
  });
});
</script>
