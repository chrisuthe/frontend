<template>
  <section class="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
    <header>
      <h1
        class="inline-flex items-center text-2xl font-semibold tracking-tight"
      >
        <Mic class="mr-2 h-5 w-5" aria-hidden="true" />
        {{ $t("providers.sendspin_sync.title") }}
      </h1>
      <p class="text-sm text-muted-foreground">{{ $t(`${KEYS}.subtitle`) }}</p>
    </header>

    <!-- A void is the whole run gone, so it is announced and it replaces the
         flow rather than sitting above it. -->
    <Card v-if="phase === 'voided'" class="gap-4">
      <CardHeader role="status" aria-live="polite">
        <CardTitle class="text-destructive">
          {{ $t(`${KEYS}.void.${voidReason}.title`) }}
        </CardTitle>
        <CardDescription>
          {{ $t(`${KEYS}.void.${voidReason}.description`) }}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button @click="startOver">
          <RotateCcw class="size-4" aria-hidden="true" />
          {{ $t(`${KEYS}.void.restart`) }}
        </Button>
      </CardFooter>
    </Card>

    <template v-else>
      <Alert v-if="openError" variant="destructive">
        <TriangleAlert class="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{{ $t(`${KEYS}.microphone_failed.title`) }}</AlertTitle>
        <AlertDescription>
          {{ $t(`${KEYS}.microphone_failed.description`) }}
        </AlertDescription>
      </Alert>

      <!-- The server holds one session at a time, so starting would be refused.
           Whoever is mid-walk gets to say so rather than be cut off silently. -->
      <Alert v-if="phase === 'picking' && sessionState" variant="warning">
        <TriangleAlert class="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{{ $t(`${KEYS}.in_progress.title`) }}</AlertTitle>
        <AlertDescription class="space-y-2">
          <p>{{ $t(`${KEYS}.in_progress.description`) }}</p>
          <Button size="sm" variant="outline" @click="startOver">
            {{ $t(`${KEYS}.in_progress.stop`) }}
          </Button>
        </AlertDescription>
      </Alert>

      <SendspinSyncPlayerPicker
        v-if="phase === 'picking'"
        v-model:selected="selected"
        :players="players"
        :disabled="busy || Boolean(sessionState)"
        @start="start"
      />

      <template v-else>
        <SendspinSyncWalk
          :players="players"
          :selected="selected"
          :visits="visits"
          :anchor="anchor"
          :needs-bracket="needsBracket"
          :disabled="phase === 'measuring'"
          :measuring="measuringPlayerId"
          @measure="measure($event)"
        />

        <!-- Held back until every speaker has been tried: a fit over one speaker
             is real but has nothing to say yet, and the panel would only ask for
             the walk that is already in progress. -->
        <SendspinSyncResults
          v-if="fit && verdict && remaining.length === 0"
          :players="players"
          :selected="selected"
          :fit="fit"
          :loss="loss"
          :verdict="verdict"
          :apply-result="applyResult"
          :trustworthy="trustworthy"
          :anchor="anchor"
          :disabled="busy || phase === 'measuring'"
          @apply="applyDelays"
          @finish="startOver"
        />
      </template>
    </template>

    <!-- The full continuity capture takes thirty seconds and is only wanted when
         a measurement looks wrong, so it stays reachable rather than in the way. -->
    <Accordion type="single" collapsible>
      <AccordionItem value="probe">
        <AccordionTrigger>{{ $t(`${KEYS}.diagnostics`) }}</AccordionTrigger>
        <AccordionContent>
          <SendspinSyncProbe />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </section>
</template>

<script setup lang="ts">
import SendspinSyncPlayerPicker from "@/components/sendspin-sync/SendspinSyncPlayerPicker.vue";
import SendspinSyncProbe from "@/components/sendspin-sync/SendspinSyncProbe.vue";
import SendspinSyncResults from "@/components/sendspin-sync/SendspinSyncResults.vue";
import SendspinSyncWalk from "@/components/sendspin-sync/SendspinSyncWalk.vue";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCalibrationRun } from "@/composables/sendspin-sync/useCalibrationRun";
import { $t } from "@/plugins/i18n";
import { Mic, RotateCcw, TriangleAlert } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { toast } from "vue-sonner";

const KEYS = "providers.sendspin_sync.calibration";

const {
  players,
  sessionState,
  sessionLost,
  busy,
  phase,
  selected,
  visits,
  measuringPlayerId,
  anchor,
  needsBracket,
  remaining,
  fit,
  loss,
  verdict,
  trustworthy,
  applyResult,
  openError,
  loadPlayers,
  refresh,
  begin,
  measure,
  apply,
  restart,
} = useCalibrationRun();

const voidReason = computed(() => sessionLost.value ?? "suspended");

onMounted(async () => {
  await refresh();
  await loadPlayers();
});

// Leaving the page hands the speakers back. The session's own inactivity timeout
// is a backstop against a phone that vanished, not this flow's cleanup path.
onBeforeRouteLeave(async () => {
  await restart();
});

window.addEventListener("pagehide", onPageHide);
onBeforeUnmount(() => window.removeEventListener("pagehide", onPageHide));

function onPageHide(): void {
  void restart();
}

async function start(force: boolean): Promise<void> {
  if (await begin(force)) toast.success($t(`${KEYS}.toast.started`));
}

/** Hand the run to the server, saying plainly whether anything was written. */
async function applyDelays(): Promise<void> {
  if (!(await apply())) return;
  const wrote = Object.keys(applyResult.value?.applied ?? {}).length > 0;
  toast.success($t(`${KEYS}.toast.${wrote ? "applied" : "manual"}`));
}

/** Give the speakers back, clear the run, and offer the picker again. */
async function startOver(): Promise<void> {
  await restart();
  await loadPlayers();
}
</script>
