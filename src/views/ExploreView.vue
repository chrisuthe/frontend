<template>
  <div class="explore-view p-6 max-w-5xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Explore Your Library</h1>
      <p class="text-sm text-muted-foreground">
        Discover music you already own in new ways
      </p>
      <p v-if="coverage" class="text-xs text-muted-foreground mt-1">
        {{ coverage.analyzed_tracks }} of {{ coverage.total_tracks }} tracks
        analyzed
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
      @vote="onVote"
      @skip="onSkip"
      @stop="onStop"
    />

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
</script>
