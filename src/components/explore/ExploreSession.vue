<template>
  <div class="explore-session flex flex-col gap-0">
    <!-- Row 1: Now Playing | Up Next -->
    <div class="flex min-h-[300px]">
      <!-- Left: Now Playing -->
      <div
        class="flex-1 flex flex-col items-center justify-center p-6 border-r"
      >
        <span
          class="text-xs uppercase tracking-wider text-primary font-semibold mb-3"
        >
          Now Playing
        </span>
        <div class="w-32 h-32 rounded-xl bg-muted overflow-hidden mb-3">
          <img
            v-if="nowPlayingImage"
            :src="nowPlayingImage"
            alt="Album art"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <Music2 :size="40" class="text-muted-foreground" />
          </div>
        </div>
        <p class="font-semibold text-sm text-center">
          {{ nowPlayingName }}
        </p>
        <p class="text-xs text-muted-foreground text-center">
          {{ nowPlayingArtist }}
        </p>
        <div class="mt-3 flex items-center gap-2">
          <span
            class="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary font-medium"
          >
            {{ modeLabel }}
          </span>
          <button
            class="rounded-md border px-3 py-1 text-xs hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition-colors"
            @click="$emit('stop')"
          >
            Stop
          </button>
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
            :show-remove="mode !== 'vote'"
            :selected="candidate.item_id === pendingVoteId"
            @select="onCandidateSelect"
            @remove="(id: string) => $emit('remove-track', id)"
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

    <!-- Row 2: Match Style + Advanced -->
    <div class="border-t px-6 py-4">
      <div class="flex items-start gap-6">
        <!-- Preset -->
        <div v-if="availablePresets?.length" class="flex-shrink-0">
          <label
            for="preset-select"
            class="block text-xs text-muted-foreground mb-1"
          >
            Match Style
          </label>
          <select
            id="preset-select"
            :value="preset"
            class="rounded-md border bg-background px-2 py-1.5 text-xs capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
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

        <!-- Analysis Source -->
        <div class="flex-shrink-0">
          <label
            for="source-select"
            class="block text-xs text-muted-foreground mb-1"
          >
            Analysis Source
          </label>
          <select
            id="source-select"
            :value="analysisSource"
            class="rounded-md border bg-background px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            @change="onSourceChange"
          >
            <option value="sonic_analysis">Librosa</option>
            <option value="essentia_analysis">Essentia</option>
          </select>
        </div>

        <!-- Advanced toggle + inline panel -->
        <div class="flex-1 min-w-0">
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
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
            class="mt-2 grid grid-cols-3 gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-4"
          >
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
            <div class="space-y-0.5">
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground"
                  >Search Depth</label
                >
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
                    (localDepth = parseInt(
                      (e.target as HTMLInputElement).value,
                    ))
                "
              />
            </div>
            <div class="col-span-3 flex justify-end mt-1">
              <button
                class="rounded-md bg-primary px-4 py-1.5 text-xs text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                @click="applyAdvanced"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 3: Track Analysis -->
    <div class="border-t px-6 py-4">
      <div class="flex items-center justify-between mb-3">
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="toggleAnalysis"
        >
          <ChevronDown
            :size="14"
            class="transition-transform"
            :class="{ 'rotate-180': showAnalysis }"
          />
          Track Analysis
        </button>
        <button
          v-if="showAnalysis"
          class="text-xs text-muted-foreground hover:text-foreground"
          @click="refreshAnalysis"
        >
          Refresh
        </button>
      </div>

      <div
        v-if="showAnalysis && analysisData"
        class="grid grid-cols-3 gap-4 text-xs font-mono"
      >
        <div
          v-for="(slot, label) in {
            Last: analysisData.last,
            Current: analysisData.current,
            Next: analysisData.next,
          }"
          :key="label"
          class="rounded-md border bg-muted/20 p-3"
        >
          <p class="text-xs font-sans font-semibold text-primary mb-1">
            {{ label }}
          </p>
          <template v-if="slot">
            <p class="font-sans text-sm font-medium truncate">
              {{ slot.name }}
            </p>
            <p class="font-sans text-muted-foreground truncate mb-2">
              {{ slot.artist }}
            </p>

            <div
              v-if="slot.group_distances"
              class="mb-2 pb-2 border-b border-border/50"
            >
              <p
                class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1"
              >
                Distances
                <span v-if="slot.distance_label" class="normal-case"
                  >({{ slot.distance_label }})</span
                >
              </p>
              <div
                v-for="(dist, group) in slot.group_distances as Record<
                  string,
                  number
                >"
                :key="group"
                class="flex justify-between"
              >
                <span class="text-muted-foreground">{{ group }}</span>
                <span>{{ (dist as number).toFixed(4) }}</span>
              </div>
            </div>

            <div v-if="slot.analysis && Object.keys(slot.analysis).length > 0">
              <p
                class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1"
              >
                Analysis
              </p>
              <div
                v-for="(val, key) in slot.analysis as Record<string, unknown>"
                :key="key"
                class="flex justify-between"
              >
                <span class="text-muted-foreground">{{ key }}</span>
                <span class="text-right truncate max-w-[120px]">{{
                  typeof val === "number" ? (val as number).toFixed(4) : val
                }}</span>
              </div>
            </div>
          </template>
          <p v-else class="text-muted-foreground/50 font-sans italic">
            No data
          </p>
        </div>
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
import type {
  ExploreCandidate,
  TrackAnalysisData,
} from "@/composables/useExploreSession";

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
  { key: "mood", label: "Mood & Character" },
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
  analysisSource?: string;
  weightOverrides?: Record<string, number>;
  effectiveWeights?: Record<string, number>;
  diversityOverride?: number | null;
  depthOverride?: number | null;
  fetchTrackAnalysis?: (queueId: string) => Promise<TrackAnalysisData | null>;
}>();

const emit = defineEmits<{
  vote: [trackId: string];
  skip: [];
  stop: [];
  "set-preset": [preset: string];
  "switch-source": [domain: string];
  "set-advanced": [
    settings: {
      weights: Record<string, number>;
      diversity: number;
      depth: number;
    },
  ];
  "remove-track": [trackId: string];
}>();

// -- Advanced settings state --
const showAdvanced = ref(false);

const localWeights = reactive<Record<WeightKey, number>>({
  rhythm: 1.0,
  loudness: 1.0,
  timbre: 1.0,
  regularity: 1.0,
  mood: 1.0,
  tonal: 1.0,
  dynamics: 1.0,
});
const localDiversity = ref(0.3);
const localDepth = ref(1);

// Use effective weights (preset defaults merged with overrides) for slider display
watch(
  () => props.effectiveWeights,
  (weights) => {
    if (weights && Object.keys(weights).length > 0) {
      for (const group of WEIGHT_GROUPS) {
        localWeights[group.key] =
          group.key in weights ? weights[group.key] : 1.0;
      }
    } else {
      for (const group of WEIGHT_GROUPS) {
        localWeights[group.key] = 1.0;
      }
    }
  },
  { immediate: true },
);
watch(
  () => props.diversityOverride,
  (v) => {
    localDiversity.value = v != null ? v : 0.3;
  },
  { immediate: true },
);
watch(
  () => props.depthOverride,
  (v) => {
    localDepth.value = v != null ? v : 1;
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

function onSourceChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("switch-source", value);
}

// -- Track Analysis state --
const showAnalysis = ref(false);
const analysisData = ref<TrackAnalysisData | null>(null);

async function refreshAnalysis() {
  if (!props.queueId || !props.fetchTrackAnalysis) return;
  analysisData.value = await props.fetchTrackAnalysis(props.queueId);
}

function toggleAnalysis() {
  showAnalysis.value = !showAnalysis.value;
  if (showAnalysis.value && !analysisData.value) {
    refreshAnalysis();
  }
}

// Auto-refresh analysis when candidates change (track advanced)
watch(
  () => props.candidates,
  () => {
    if (showAnalysis.value) {
      refreshAnalysis();
    }
    pendingVoteId.value = null;
  },
);

// -- Queue / playback state --
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

function onCandidateSelect(trackId: string) {
  if (props.mode === "vote") {
    pendingVoteId.value = trackId;
    emit("vote", trackId);
  }
}
</script>
