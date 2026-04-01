<template>
  <div class="explore-session flex h-full min-h-[400px]">
    <!-- Left: Now Playing -->
    <div class="flex-1 flex flex-col items-center justify-center p-6 border-r">
      <span
        class="text-xs uppercase tracking-wider text-primary font-semibold mb-3"
      >
        Now Playing
      </span>
      <div class="w-36 h-36 rounded-xl bg-muted overflow-hidden mb-4">
        <img
          v-if="nowPlayingImage"
          :src="nowPlayingImage"
          alt="Album art"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <Music2 :size="48" class="text-muted-foreground" />
        </div>
      </div>
      <p class="font-semibold text-base text-center">
        {{ nowPlayingName }}
      </p>
      <p class="text-sm text-muted-foreground text-center">
        {{ nowPlayingArtist }}
      </p>
      <div class="mt-4">
        <span
          class="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary font-medium"
        >
          {{ modeLabel }}
        </span>
      </div>
      <button
        class="mt-4 rounded-md border px-3 py-1.5 text-xs hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition-colors"
        @click="$emit('stop')"
      >
        Stop Exploring
      </button>
    </div>

    <!-- Right: Candidates -->
    <div class="flex-1 flex flex-col p-6">
      <span
        class="text-xs uppercase tracking-wider text-primary font-semibold mb-3"
      >
        {{ mode === "vote" ? "Pick What's Next" : "Up Next" }}
      </span>

      <div class="flex-1 grid gap-3" :class="gridClass">
        <ExploreCandidateCard
          v-for="candidate in candidates"
          :key="candidate.item_id"
          :candidate="candidate"
          :show-distance="mode === 'vote'"
          @select="onCandidateSelect"
        />
      </div>

      <div v-if="mode === 'vote'" class="mt-3 flex justify-center">
        <button
          class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          @click="$emit('skip')"
        >
          Show different options
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Music2 } from "lucide-vue-next";
import { store } from "@/plugins/store";
import api from "@/plugins/api";
import { getImageThumbForItem } from "@/helpers/utils";
import ExploreCandidateCard from "./ExploreCandidateCard.vue";
import type { ExploreCandidate } from "@/composables/useExploreSession";

const props = defineProps<{
  mode: string;
  candidates: ExploreCandidate[];
  queueId?: string;
}>();

const emit = defineEmits<{
  vote: [trackId: string];
  skip: [];
  stop: [];
}>();

const sessionQueue = computed(() => {
  if (props.queueId && props.queueId in api.queues) {
    return api.queues[props.queueId];
  }
  return store.activePlayerQueue;
});

const currentItem = computed(() => sessionQueue.value?.current_item);

const nowPlayingName = computed(
  () => currentItem.value?.media_item?.name || "Nothing playing",
);
const nowPlayingArtist = computed(() => {
  const mediaItem = currentItem.value?.media_item;
  if (!mediaItem || !("artists" in mediaItem)) return "";
  return mediaItem.artists.map((a) => a.name).join(", ");
});
const nowPlayingImage = computed(() => {
  return getImageThumbForItem(currentItem.value, undefined, 300);
});

const modeLabel = computed(() => {
  if (props.mode === "radio") return "Non-Stop Radio";
  if (props.mode === "vote") return "Vote for Next";
  if (props.mode === "theme") return "Theme Party";
  return props.mode;
});

const gridClass = computed(() => {
  const count = props.candidates.length;
  if (count <= 2) return "grid-cols-2";
  return "grid-cols-2 auto-rows-fr";
});

function onCandidateSelect(trackId: string) {
  if (props.mode === "vote") {
    emit("vote", trackId);
  }
}
</script>
