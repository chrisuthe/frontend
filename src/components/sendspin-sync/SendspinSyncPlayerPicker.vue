<template>
  <Card class="gap-4">
    <CardHeader>
      <CardTitle>{{ $t(`${KEYS}.pick.title`) }}</CardTitle>
      <CardDescription>{{ $t(`${KEYS}.pick.description`) }}</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      <Empty v-if="!players.length">
        <EmptyHeader>
          <EmptyTitle>{{ $t(`${KEYS}.pick.none.title`) }}</EmptyTitle>
          <EmptyDescription>
            {{ $t(`${KEYS}.pick.none.description`) }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>

      <fieldset v-else class="space-y-0 divide-y border-t">
        <legend class="sr-only">{{ $t(`${KEYS}.pick.legend`) }}</legend>
        <div
          v-for="player in players"
          :key="player.player_id"
          class="flex items-center gap-3 py-3"
        >
          <Checkbox
            :id="`sendspin-sync-${player.player_id}`"
            :model-value="selected.includes(player.player_id)"
            :disabled="disabled"
            @update:model-value="toggle(player.player_id, $event)"
          />
          <Label
            :for="`sendspin-sync-${player.player_id}`"
            class="flex min-w-0 flex-1 items-center gap-2 font-normal"
          >
            <span class="truncate">{{ player.name }}</span>
            <Badge v-if="player.busy" variant="warning" class="shrink-0">
              {{ $t(`${KEYS}.pick.busy`) }}
            </Badge>
          </Label>
        </div>
      </fieldset>

      <!-- Taking a speaker off the user's own music is worth saying out loud
           before it happens, not after. -->
      <Alert v-if="busySelected.length" variant="warning">
        <TriangleAlert class="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{{ $t(`${KEYS}.pick.takeover.title`) }}</AlertTitle>
        <AlertDescription>
          {{
            $t(`${KEYS}.pick.takeover.description`, [
              busySelected.map((player) => player.name).join(", "),
            ])
          }}
        </AlertDescription>
      </Alert>

      <p v-if="players.length" class="text-sm text-muted-foreground">
        {{ $t(`${KEYS}.pick.minimum`) }}
      </p>
    </CardContent>

    <CardFooter>
      <Button
        class="w-full sm:w-auto"
        :disabled="disabled || selected.length < 2"
        @click="emit('start', busySelected.length > 0)"
      >
        <Spinner v-if="disabled" class="size-4" aria-hidden="true" />
        <Play v-else class="size-4" aria-hidden="true" />
        {{
          busySelected.length
            ? $t(`${KEYS}.pick.start_takeover`)
            : $t(`${KEYS}.pick.start`)
        }}
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { CalibrationPlayer } from "@/plugins/api/interfaces";
import { Play, TriangleAlert } from "@lucide/vue";
import { computed } from "vue";

const KEYS = "providers.sendspin_sync.calibration";

const { players, selected, disabled } = defineProps<{
  players: CalibrationPlayer[];
  selected: string[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:selected": [playerIds: string[]];
  /** The boolean says whether starting means taking a busy speaker over. */
  start: [force: boolean];
}>();

const busySelected = computed(() =>
  players.filter(
    (player) => player.busy && selected.includes(player.player_id),
  ),
);

/**
 * Add or remove one speaker, keeping the order the user picked them in.
 *
 * That order is the order they will be walked, and the first one is the speaker
 * every other reading ends up relative to.
 */
function toggle(playerId: string, checked: boolean | "indeterminate"): void {
  emit(
    "update:selected",
    checked === true
      ? [...selected, playerId]
      : selected.filter((id) => id !== playerId),
  );
}
</script>
