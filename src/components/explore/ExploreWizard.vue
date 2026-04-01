<template>
  <div class="explore-wizard space-y-6">
    <!-- Coverage banner -->
    <div
      v-if="coverage && !coverage.sufficient"
      class="rounded-lg border border-warning/30 bg-warning/10 p-4 flex items-center justify-between"
    >
      <div>
        <p class="font-medium text-sm">
          {{ coverage.analyzed_tracks }} of {{ coverage.total_tracks }} tracks
          analyzed ({{ coverage.coverage_pct }}%)
        </p>
        <p class="text-xs text-muted-foreground">
          Analyze more tracks for better exploration results.
        </p>
      </div>
      <button
        class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        @click="$emit('triggerBackfill')"
      >
        Analyze Library
      </button>
    </div>

    <!-- Resume banner -->
    <div
      v-if="resumable"
      class="rounded-lg border border-primary/30 bg-primary/10 p-4 flex items-center justify-between cursor-pointer hover:bg-primary/15 transition-colors"
      @click="$emit('resume')"
    >
      <div>
        <p class="font-medium text-sm text-primary">Resume last session</p>
        <p class="text-xs text-muted-foreground">{{ lastMode }} mode</p>
      </div>
      <ChevronRight :size="20" class="text-primary" />
    </div>

    <!-- Step indicator -->
    <div class="flex items-center gap-2 mb-4">
      <template v-for="s in 3" :key="s">
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          :class="
            s <= step
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          "
        >
          {{ s }}
        </div>
        <div v-if="s < 3" class="h-0.5 w-8 bg-muted"></div>
      </template>
      <span class="text-xs text-muted-foreground ml-2">{{ stepLabel }}</span>
    </div>

    <!-- Step 1: Pick mode -->
    <div v-if="step === 1" class="space-y-3">
      <h2 class="text-lg font-semibold">How do you want to explore?</h2>
      <div
        v-for="m in modes"
        :key="m.id"
        class="rounded-lg border p-4 cursor-pointer transition-all hover:border-primary flex items-center gap-4"
        :class="{ 'border-primary bg-primary/10': selectedMode === m.id }"
        @click="selectMode(m.id)"
      >
        <div
          class="w-11 h-11 rounded-lg flex items-center justify-center text-lg"
          :class="selectedMode === m.id ? 'bg-primary/20' : 'bg-muted'"
        >
          {{ m.emoji }}
        </div>
        <div>
          <p class="font-semibold text-sm">{{ m.name }}</p>
          <p class="text-xs text-muted-foreground">{{ m.description }}</p>
        </div>
      </div>

      <!-- Theme sub-step -->
      <div
        v-if="selectedMode === 'theme' && themes.length > 0"
        class="mt-4 space-y-2"
      >
        <h3 class="text-sm font-medium">Pick a theme</h3>
        <div class="grid grid-cols-2 gap-2">
          <div
            v-for="theme in themes"
            :key="theme.theme_id"
            class="rounded-lg border p-3 cursor-pointer transition-all hover:border-primary text-center"
            :class="{
              'border-primary bg-primary/10':
                selectedThemeId === theme.theme_id,
            }"
            @click="selectedThemeId = theme.theme_id"
          >
            <span class="text-lg">{{ theme.icon || "🎵" }}</span>
            <p class="text-xs font-medium mt-1">{{ theme.name }}</p>
          </div>
        </div>
      </div>

      <button
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        :disabled="!canProceedFromStep1"
        @click="step = 2"
      >
        Next
      </button>
    </div>

    <!-- Step 2: Pick seed -->
    <div v-if="step === 2" class="space-y-3">
      <h2 class="text-lg font-semibold">Pick a starting track</h2>

      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search your library..."
        class="w-full rounded-md border bg-background px-3 py-2 text-sm"
        @input="onSearch"
      />

      <div class="flex gap-2 flex-wrap">
        <button
          v-if="currentTrackId"
          class="rounded-full border px-3 py-1 text-xs hover:bg-primary/10"
          @click="selectSeed(currentTrackId)"
        >
          🎵 From now playing
        </button>
        <button
          class="rounded-full border px-3 py-1 text-xs hover:bg-primary/10"
          @click="pickRandomSeed"
        >
          🎲 Surprise me
        </button>
      </div>

      <div
        v-if="searchResults.length > 0"
        class="space-y-1 max-h-64 overflow-y-auto"
      >
        <div
          v-for="track in searchResults"
          :key="track.item_id"
          class="rounded-md p-2 cursor-pointer hover:bg-muted flex items-center gap-3"
          :class="{ 'bg-primary/10': selectedSeedId === track.item_id }"
          @click="selectSeed(track.item_id)"
        >
          <div class="w-10 h-10 rounded bg-muted flex-shrink-0"></div>
          <div class="min-w-0">
            <p class="text-sm font-medium truncate">{{ track.name }}</p>
            <p class="text-xs text-muted-foreground truncate">
              {{ track.artist }}
            </p>
          </div>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="rounded-md border px-4 py-2 text-sm" @click="step = 1">
          Back
        </button>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          :disabled="!selectedSeedId"
          @click="step = 3"
        >
          Next
        </button>
      </div>
    </div>

    <!-- Step 3: Pick player -->
    <div v-if="step === 3" class="space-y-3">
      <h2 class="text-lg font-semibold">Pick a player</h2>

      <div
        v-for="queue in availableQueues"
        :key="queue.queue_id"
        class="rounded-lg border p-3 cursor-pointer transition-all hover:border-primary flex items-center gap-3"
        :class="{
          'border-primary bg-primary/10': selectedQueueId === queue.queue_id,
        }"
        @click="selectedQueueId = queue.queue_id"
      >
        <div
          class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center"
        >
          <Speaker :size="18" />
        </div>
        <div>
          <p class="text-sm font-medium">{{ queue.display_name }}</p>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="rounded-md border px-4 py-2 text-sm" @click="step = 2">
          Back
        </button>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          :disabled="!selectedQueueId || !selectedSeedId"
          @click="
            $emit(
              'start',
              selectedMode!,
              selectedSeedId!,
              selectedQueueId!,
              selectedThemeId ?? undefined,
            )
          "
        >
          Start Exploring
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ChevronRight, Speaker } from "lucide-vue-next";
import api from "@/plugins/api";
import { store } from "@/plugins/store";
import type {
  ExploreTheme,
  ExploreCoverage,
} from "@/composables/useExploreSession";

defineProps<{
  themes: ExploreTheme[];
  coverage: ExploreCoverage | null;
  resumable: boolean;
  lastMode?: string;
}>();

defineEmits<{
  start: [mode: string, seedTrackId: string, queueId: string, themeId?: string];
  resume: [];
  triggerBackfill: [];
}>();

const step = ref(1);
const selectedMode = ref<string | null>(null);
const selectedThemeId = ref<string | null>(null);
const selectedSeedId = ref<string | null>(null);
const selectedQueueId = ref<string | null>(null);
const searchQuery = ref("");
const searchResults = ref<{ item_id: string; name: string; artist: string }[]>(
  [],
);

const modes = [
  {
    id: "radio",
    name: "Non-Stop Radio",
    description: "Lean back — we auto-queue similar tracks",
    emoji: "📻",
  },
  {
    id: "vote",
    name: "Vote for Next",
    description: "Pick from 3 candidates before each song",
    emoji: "🗳️",
  },
  {
    id: "theme",
    name: "Theme Party",
    description: "Pick a theme and stay in the zone",
    emoji: "🎉",
  },
];

const stepLabel = computed(() => {
  if (step.value === 1) return "Pick mode";
  if (step.value === 2) return "Pick seed track";
  return "Pick player";
});

const canProceedFromStep1 = computed(() => {
  if (!selectedMode.value) return false;
  if (selectedMode.value === "theme" && !selectedThemeId.value) return false;
  return true;
});

const currentTrackId = computed(() => {
  const item = store.curQueueItem;
  return item?.media_item?.item_id;
});

const availableQueues = computed(() => {
  return Object.values(api.queues);
});

function selectMode(mode: string) {
  selectedMode.value = mode;
  if (mode !== "theme") {
    selectedThemeId.value = null;
  }
}

function selectSeed(trackId: string) {
  selectedSeedId.value = trackId;
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

async function onSearch() {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (!searchQuery.value || searchQuery.value.length < 2) {
    searchResults.value = [];
    return;
  }
  searchTimeout = setTimeout(async () => {
    try {
      const tracks = await api.sendCommand<
        {
          item_id: string;
          name: string;
          artists: { name: string }[];
        }[]
      >("music/tracks/library_items", {
        search: searchQuery.value,
        limit: 20,
      });
      searchResults.value = tracks.map((t) => ({
        item_id: t.item_id,
        name: t.name,
        artist: t.artists?.map((a) => a.name).join(", ") || "Unknown",
      }));
    } catch {
      searchResults.value = [];
    }
  }, 300);
}

async function pickRandomSeed() {
  try {
    const tracks = await api.sendCommand<
      { item_id: string; name: string; artists: { name: string }[] }[]
    >("music/tracks/library_items", { limit: 50 });
    if (tracks.length > 0) {
      const random = tracks[Math.floor(Math.random() * tracks.length)];
      selectedSeedId.value = random.item_id;
      searchResults.value = [
        {
          item_id: random.item_id,
          name: random.name,
          artist: random.artists?.map((a) => a.name).join(", ") || "Unknown",
        },
      ];
    }
  } catch {
    // Fallback: do nothing
  }
}
</script>
