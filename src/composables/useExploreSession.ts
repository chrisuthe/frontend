import { ref, computed, onUnmounted } from "vue";
import api from "@/plugins/api";
import { EventType } from "@/plugins/api/interfaces";
import type { EventMessage } from "@/plugins/api/interfaces";

export interface ExploreCandidate {
  item_id: string;
  name: string;
  artist: string;
  image_url: string | null;
  distance: number;
  match_reasons?: string[] | null;
  differ_reasons?: string[] | null;
}

export interface ExploreTheme {
  theme_id: string;
  name: string;
  description: string;
  preset: string;
  icon: string | null;
  builtin: boolean;
}

export interface ExploreCoverage {
  total_tracks: number;
  analyzed_tracks: number;
  coverage_pct: number;
  sufficient: boolean;
}

export interface ExploreSessionState {
  active: boolean;
  mode?: string;
  seed_track_id?: string;
  last_played_track_id?: string;
  candidates?: ExploreCandidate[];
  played_count?: number;
  theme_id?: string | null;
  preset?: string;
  available_presets?: string[];
  weight_overrides?: Record<string, number>;
  diversity_override?: number | null;
  depth_override?: number | null;
  resumable?: boolean;
  last_mode?: string;
  last_seed_track_id?: string;
  last_theme_id?: string | null;
}

export function useExploreSession() {
  const sessionState = ref<ExploreSessionState | null>(null);
  const sessionQueueId = ref<string | null>(null);
  const candidates = ref<ExploreCandidate[]>([]);
  const themes = ref<ExploreTheme[]>([]);
  const coverage = ref<ExploreCoverage | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isActive = computed(() => sessionState.value?.active === true);
  const isResumable = computed(
    () => !isActive.value && sessionState.value?.resumable === true,
  );
  const currentMode = computed(() => sessionState.value?.mode);
  const currentPreset = computed(
    () => sessionState.value?.preset ?? "balanced",
  );
  const availablePresets = computed(
    () => sessionState.value?.available_presets ?? [],
  );

  const unsubscribes: (() => void)[] = [];

  function cleanupSubscriptions() {
    for (const unsub of unsubscribes) {
      unsub();
    }
    unsubscribes.length = 0;
  }

  function subscribeToEvents(queueId: string) {
    cleanupSubscriptions(); // Clean up any existing subscriptions first
    unsubscribes.push(
      api.subscribe(EventType.ALL, (event: EventMessage) => {
        const data = event.data;
        if (typeof data !== "object" || data === null) return;
        const payload = data as Record<string, unknown>;
        const eventType = payload.type as string | undefined;
        if (!eventType) return;
        if (
          eventType === "EXPLORE_CANDIDATES_UPDATED" &&
          payload.queue_id === queueId
        ) {
          candidates.value = (payload.candidates as ExploreCandidate[]) || [];
        }
        if (
          eventType === "EXPLORE_SESSION_ENDED" &&
          payload.queue_id === queueId
        ) {
          sessionState.value = { active: false, resumable: false };
          candidates.value = [];
        }
      }),
    );
  }

  async function fetchStatus(queueId: string) {
    try {
      loading.value = true;
      const result = await api.sendCommand<ExploreSessionState>(
        "explore/status",
        { queue_id: queueId },
      );
      sessionState.value = result;
      candidates.value = result.candidates ?? []; // Always set candidates
      // Subscribe to events if session is active
      if (result.active) {
        subscribeToEvents(queueId);
        sessionQueueId.value = queueId;
      }
    } catch (e) {
      error.value = `Failed to fetch status: ${e}`;
    } finally {
      loading.value = false;
    }
  }

  async function startSession(
    queueId: string,
    mode: string,
    seedTrackId: string,
    themeId?: string,
  ) {
    try {
      loading.value = true;
      error.value = null;
      const result = await api.sendCommand<{
        status: string;
        mode: string;
        seed_track_id: string;
        candidates: ExploreCandidate[];
      }>("explore/start", {
        queue_id: queueId,
        mode,
        seed_track_id: seedTrackId,
        theme_id: themeId,
      });
      sessionState.value = { active: true, mode: result.mode };
      candidates.value = result.candidates || [];
      subscribeToEvents(queueId);
      sessionQueueId.value = queueId;
    } catch (e) {
      error.value = `Failed to start session: ${e}`;
    } finally {
      loading.value = false;
    }
  }

  async function stopSession(queueId: string) {
    try {
      await api.sendCommand("explore/stop", { queue_id: queueId });
      cleanupSubscriptions();
      // Fetch authoritative state from backend
      await fetchStatus(queueId);
      sessionQueueId.value = null;
    } catch (e) {
      error.value = `Failed to stop session: ${e}`;
    }
  }

  async function resumeSession(queueId: string) {
    try {
      loading.value = true;
      const result = await api.sendCommand<{
        status: string;
        mode: string;
        candidates: ExploreCandidate[];
      }>("explore/resume", { queue_id: queueId });
      if (result.status === "started") {
        sessionState.value = { active: true, mode: result.mode };
        candidates.value = result.candidates || [];
        subscribeToEvents(queueId);
        sessionQueueId.value = queueId;
      }
    } catch (e) {
      error.value = `Failed to resume session: ${e}`;
    } finally {
      loading.value = false;
    }
  }

  async function vote(queueId: string, trackId: string) {
    try {
      const result = await api.sendCommand<{
        status: string;
        candidates: ExploreCandidate[];
      }>("explore/vote", {
        queue_id: queueId,
        track_id: trackId,
      });
      if (result.candidates) {
        candidates.value = result.candidates;
      }
    } catch (e) {
      error.value = `Failed to vote: ${e}`;
    }
  }

  async function skip(queueId: string) {
    try {
      const result = await api.sendCommand<{
        status: string;
        candidates: ExploreCandidate[];
      }>("explore/skip", { queue_id: queueId });
      if (result.candidates) {
        candidates.value = result.candidates;
      }
    } catch (e) {
      error.value = `Failed to skip: ${e}`;
    }
  }

  async function fetchThemes() {
    try {
      themes.value = await api.sendCommand<ExploreTheme[]>("explore/themes");
    } catch (e) {
      error.value = `Failed to fetch themes: ${e}`;
    }
  }

  async function fetchCoverage() {
    try {
      coverage.value =
        await api.sendCommand<ExploreCoverage>("explore/coverage");
    } catch (e) {
      error.value = `Failed to fetch coverage: ${e}`;
    }
  }

  async function setAdvanced(
    queueId: string,
    settings: {
      weights: Record<string, number>;
      diversity: number;
      depth: number;
    },
  ) {
    try {
      const result = await api.sendCommand<{
        weights: Record<string, number>;
        diversity: number | null;
        depth: number | null;
        candidates: number;
      }>("explore/set_advanced", {
        queue_id: queueId,
        weights: settings.weights,
        diversity: settings.diversity,
        depth: settings.depth,
      });
      if (sessionState.value) {
        sessionState.value.weight_overrides = result.weights;
        sessionState.value.diversity_override = result.diversity;
        sessionState.value.depth_override = result.depth;
      }
    } catch (e) {
      error.value = `Failed to apply advanced settings: ${e}`;
    }
  }

  async function setPreset(queueId: string, preset: string) {
    try {
      const result = await api.sendCommand<{
        preset: string;
        candidates: number;
      }>("explore/set_preset", {
        queue_id: queueId,
        preset,
      });
      if (sessionState.value) {
        sessionState.value.preset = result.preset;
      }
    } catch (e) {
      error.value = `Failed to change preset: ${e}`;
    }
  }

  async function triggerBackfill() {
    try {
      await api.sendCommand("sonic_analysis/trigger_backfill");
    } catch (e) {
      error.value = `Failed to trigger backfill: ${e}`;
    }
  }

  onUnmounted(() => {
    cleanupSubscriptions();
  });

  return {
    // State
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
    fetchStatus,
    startSession,
    stopSession,
    resumeSession,
    vote,
    skip,
    setPreset,
    setAdvanced,
    fetchThemes,
    fetchCoverage,
    triggerBackfill,
  };
}
