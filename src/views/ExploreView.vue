<template>
  <div class="explore-view p-6 max-w-5xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Explore Your Library</h1>
      <p class="text-sm text-muted-foreground">
        Discover music you already own in new ways
      </p>
      <p v-if="coverage" class="text-xs text-muted-foreground mt-1">
        {{ coverage.analyzed_tracks }} of {{ coverage.total_tracks }} tracks
        analyzed ({{ Math.round(coverage.coverage_pct) }}%)
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <div
        class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
      ></div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="rounded-lg border border-destructive/30 bg-destructive/10 p-4"
    >
      <p class="text-sm text-destructive">{{ error }}</p>
    </div>

    <!-- Session active: show session view -->
    <ExploreSession
      v-else-if="isActive"
      :mode="currentMode || 'radio'"
      :candidates="candidates"
      :queue-id="activeQueueId"
      :preset="currentPreset"
      :available-presets="availablePresets"
      :weight-overrides="sessionState?.weight_overrides"
      :effective-weights="sessionState?.effective_weights"
      :diversity-override="sessionState?.diversity_override"
      :depth-override="sessionState?.depth_override"
      :analysis-source="sessionState?.aa_provider_domain"
      :fetch-track-analysis="onFetchTrackAnalysis"
      @vote="onVote"
      @skip="onSkip"
      @stop="onStop"
      @set-preset="onSetPreset"
      @switch-source="onSwitchSource"
      @set-advanced="onSetAdvanced"
      @remove-track="onRemoveTrack"
    />

    <!-- No players available -->
    <div v-else-if="!hasQueues" class="rounded-lg border p-6 text-center">
      <p class="font-medium text-sm">No players available</p>
      <p class="text-xs text-muted-foreground mt-1">
        Set up a player in Settings before exploring.
      </p>
    </div>

    <!-- No session: show wizard -->
    <ExploreWizard
      v-else
      :themes="themes"
      :coverage="coverage"
      :resumable="isResumable"
      :last-mode="sessionState?.last_mode"
      @start="onStart"
      @resume="onResume"
      @trigger-backfill="triggerBackfill"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import api from "@/plugins/api";
import { store } from "@/plugins/store";
import { useExploreSession } from "@/composables/useExploreSession";
import ExploreWizard from "@/components/explore/ExploreWizard.vue";
import ExploreSession from "@/components/explore/ExploreSession.vue";

const {
  sessionState,
  sessionQueueId,
  candidates,
  themes,
  coverage,
  loading,
  error,
  isActive,
  isResumable,
  currentMode,
  currentPreset,
  availablePresets,
  setPreset,
  setAdvanced,
  switchSource,
  removeTrack,
  fetchTrackAnalysis,
  fetchStatus,
  startSession,
  stopSession,
  resumeSession,
  vote,
  skip,
  fetchThemes,
  fetchCoverage,
  triggerBackfill,
} = useExploreSession();

const activeQueueId = computed(
  () => sessionQueueId.value ?? store.activePlayerQueue?.queue_id,
);

const hasQueues = computed(() => Object.keys(api.queues).length > 0);

onMounted(async () => {
  const queueId = activeQueueId.value;
  await Promise.all([fetchThemes(), fetchCoverage()]);
  if (queueId) {
    await fetchStatus(queueId);
  }
});

async function onStart(
  mode: string,
  seedTrackId: string,
  queueId: string,
  themeId?: string,
) {
  await startSession(queueId, mode, seedTrackId, themeId);
}

async function onResume() {
  if (activeQueueId.value) {
    await resumeSession(activeQueueId.value);
  }
}

async function onVote(trackId: string) {
  if (activeQueueId.value) {
    await vote(activeQueueId.value, trackId);
  }
}

async function onSkip() {
  if (activeQueueId.value) {
    await skip(activeQueueId.value);
  }
}

async function onStop() {
  if (activeQueueId.value) {
    await stopSession(activeQueueId.value);
  }
}

async function onSwitchSource(domain: string) {
  if (activeQueueId.value) {
    await switchSource(activeQueueId.value, domain);
  }
}

async function onSetPreset(preset: string) {
  if (activeQueueId.value) {
    await setPreset(activeQueueId.value, preset);
  }
}

async function onFetchTrackAnalysis(queueId: string) {
  return await fetchTrackAnalysis(queueId);
}

async function onRemoveTrack(trackId: string) {
  if (activeQueueId.value) {
    await removeTrack(activeQueueId.value, trackId);
  }
}

async function onSetAdvanced(settings: {
  weights: Record<string, number>;
  diversity: number;
  depth: number;
}) {
  if (activeQueueId.value) {
    await setAdvanced(activeQueueId.value, settings);
  }
}
</script>
