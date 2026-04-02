<template>
  <div class="explore-session flex h-full min-h-[400px]">
    <!-- Left: Now Playing -->
    <div
      class="flex-1 flex flex-col items-center justify-center p-6 border-r overflow-y-auto"
    >
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

      <!-- Match Style Preset -->
      <div v-if="availablePresets?.length" class="mt-3 w-full max-w-[200px]">
        <label
          for="preset-select"
          class="block text-xs text-muted-foreground mb-1 text-center"
        >
          Match Style
        </label>
        <select
          id="preset-select"
          :value="preset"
          class="w-full rounded-md border bg-background px-2 py-1.5 text-xs capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          @change="onPresetChange"
        >
          <option
            v-for="p in availablePresets"
            :key="p"
            :value="p"
            class="capitalize"
          >
            {{ presetLabel(p) }}
          </option>
        </select>
      </div>

      <!-- Advanced Settings Drawer -->
      <div class="mt-2 w-full max-w-[200px]">
        <button
          class="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          @click="showAdvanced = !showAdvanced"
        >
          <ChevronDown
            :size="14"
            class="transition-transform"
            :class="{ 'rotate-180': showAdvanced }"
          />
          Advanced
        </button>

        <div
          v-if="showAdvanced"
          class="mt-2 rounded-md border bg-muted/30 p-3 space-y-3"
        >
          <!-- Weight Sliders -->
          <div
            v-for="group in WEIGHT_GROUPS"
            :key="group.key"
            class="space-y-0.5"
          >
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted-foreground">{{
                group.label
              }}</label>
              <span class="text-xs font-mono text-primary">{{
                Math.round(localWeights[group.key] * 100)
              }}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              :value="Math.round(localWeights[group.key] * 100)"
              class="w-full h-1.5 accent-primary cursor-pointer"
              @input="
                (e) =>
                  onWeightChange(
                    group.key,
                    parseInt((e.target as HTMLInputElement).value) / 100,
                  )
              "
            />
          </div>

          <!-- Diversity -->
          <div class="space-y-0.5">
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted-foreground">Diversity</label>
              <span class="text-xs font-mono text-primary">{{
                Math.round(localDiversity * 100)
              }}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              :value="Math.round(localDiversity * 100)"
              class="w-full h-1.5 accent-primary cursor-pointer"
              @input="
                (e) =>
                  (localDiversity =
                    parseInt((e.target as HTMLInputElement).value) / 100)
              "
            />
          </div>

          <!-- Depth -->
          <div class="space-y-0.5">
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted-foreground">Search Depth</label>
              <span class="text-xs font-mono text-primary">{{
                localDepth
              }}</span>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              :value="localDepth"
              class="w-full h-1.5 accent-primary cursor-pointer"
              @input="
                (e) =>
                  (localDepth = parseInt((e.target as HTMLInputElement).value))
              "
            />
          </div>

          <button
            class="w-full rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            @click="applyAdvanced"
          >
            Apply
          </button>
        </div>
      </div>
    </div>

    <!-- Right: Candidates -->
    <div class="flex-1 flex flex-col p-6">
      <span
        class="text-xs uppercase tracking-wider text-primary font-semibold mb-3"
      >
        {{ mode === "vote" ? "Pick What's Next" : "Up Next" }}
      </span>

      <div class="flex-1 flex flex-col gap-2">
        <ExploreCandidateCard
          v-for="candidate in candidates"
          :key="candidate.item_id"
          :candidate="candidate"
          :show-distance="mode === 'vote'"
          :selected="candidate.item_id === pendingVoteId"
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
import { computed, ref, watch, reactive } from "vue";
import { Music2, ChevronDown } from "lucide-vue-next";
import { store } from "@/plugins/store";
import api from "@/plugins/api";
import { getImageThumbForItem } from "@/helpers/utils";
import ExploreCandidateCard from "./ExploreCandidateCard.vue";
import type { ExploreCandidate } from "@/composables/useExploreSession";

const PRESET_LABELS: Record<string, string> = {
  balanced: "Balanced",
  vibe: "Vibe & Mood",
  party: "Party & Rhythm",
  genre_era: "Genre & Era",
  discover: "Discover",
};

const WEIGHT_GROUPS = [
  { key: "rhythm", label: "Tempo & Energy" },
  { key: "loudness", label: "Loudness" },
  { key: "timbre", label: "Tone & Texture" },
  { key: "regularity", label: "Groove" },
  { key: "tonal", label: "Key & Harmony" },
  { key: "dynamics", label: "Dynamics" },
] as const;

type WeightKey = (typeof WEIGHT_GROUPS)[number]["key"];

const props = defineProps<{
  mode: string;
  candidates: ExploreCandidate[];
  queueId?: string;
  preset?: string;
  availablePresets?: string[];
  weightOverrides?: Record<string, number>;
  diversityOverride?: number | null;
  depthOverride?: number | null;
}>();

const emit = defineEmits<{
  vote: [trackId: string];
  skip: [];
  stop: [];
  "set-preset": [preset: string];
  "set-advanced": [
    settings: {
      weights: Record<string, number>;
      diversity: number;
      depth: number;
    },
  ];
}>();

const showAdvanced = ref(false);

const localWeights = reactive<Record<WeightKey, number>>({
  rhythm: 1.0,
  loudness: 1.0,
  timbre: 1.0,
  regularity: 1.0,
  tonal: 1.0,
  dynamics: 1.0,
});
const localDiversity = ref(0.3);
const localDepth = ref(1);

// Sync local state from props when they change
watch(
  () => props.weightOverrides,
  (overrides) => {
    if (overrides && Object.keys(overrides).length > 0) {
      for (const group of WEIGHT_GROUPS) {
        if (group.key in overrides) {
          localWeights[group.key] = overrides[group.key];
        }
      }
    }
  },
  { immediate: true },
);
watch(
  () => props.diversityOverride,
  (v) => {
    if (v != null) localDiversity.value = v;
  },
  { immediate: true },
);
watch(
  () => props.depthOverride,
  (v) => {
    if (v != null) localDepth.value = v;
  },
  { immediate: true },
);

function onWeightChange(key: WeightKey, value: number) {
  localWeights[key] = value;
}

function applyAdvanced() {
  emit("set-advanced", {
    weights: { ...localWeights },
    diversity: localDiversity.value,
    depth: localDepth.value,
  });
}

function presetLabel(p: string): string {
  return PRESET_LABELS[p] ?? p;
}

function onPresetChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("set-preset", value);
}

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

const pendingVoteId = ref<string | null>(null);

watch(
  () => props.candidates,
  () => {
    pendingVoteId.value = null;
  },
);

function onCandidateSelect(trackId: string) {
  if (props.mode === "vote") {
    pendingVoteId.value = trackId;
    emit("vote", trackId);
  }
}
</script>
