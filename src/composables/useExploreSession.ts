import { ref, computed, onUnmounted } from "vue";
import api from "@/plugins/api";
import { EventType } from "@/plugins/api/interfaces";

export interface ExploreCandidate {
  item_id: string;
  name: string;
  artist: string;
  image_url: string | null;
  distance: number;
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
  resumable?: boolean;
  last_mode?: string;
  last_seed_track_id?: string;
  last_theme_id?: string | null;
}

export function useExploreSession() {
  const sessionState = ref<ExploreSessionState | null>(null);
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

  const unsubscribes: (() => void)[] = [];

  function subscribeToEvents(queueId: string) {
    unsubscribes.push(
      api.subscribe(
        EventType.UNKNOWN,
        (event: { data?: Record<string, unknown> }) => {
          if (!event.data) return;
          const eventType = event.data.type as string;
          if (
            eventType === "EXPLORE_CANDIDATES_UPDATED" &&
            event.data.queue_id === queueId
          ) {
            candidates.value =
              (event.data.candidates as ExploreCandidate[]) || [];
          }
          if (
            eventType === "EXPLORE_SESSION_ENDED" &&
            event.data.queue_id === queueId
          ) {
            sessionState.value = { active: false, resumable: false };
            candidates.value = [];
          }
        },
      ),
    );
  }

  function cleanupSubscriptions() {
    for (const unsub of unsubscribes) {
      unsub();
    }
    unsubscribes.length = 0;
  }

  async function fetchStatus(queueId: string) {
    try {
      loading.value = true;
      const result = await api.sendCommand<ExploreSessionState>(
        "explore/status",
        { queue_id: queueId },
      );
      sessionState.value = result;
      if (result.candidates) {
        candidates.value = result.candidates;
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
    } catch (e) {
      error.value = `Failed to start session: ${e}`;
    } finally {
      loading.value = false;
    }
  }

  async function stopSession(queueId: string) {
    try {
      await api.sendCommand("explore/stop", { queue_id: queueId });
      sessionState.value = { active: false, resumable: true };
      candidates.value = [];
      cleanupSubscriptions();
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
    sessionState,
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
  };
}
