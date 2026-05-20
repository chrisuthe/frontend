<template>
  <v-card class="status-card" elevation="0">
    <div class="status-content">
      <h3 class="status-title">{{ $t("sonic_similarity.status.title") }}</h3>

      <div v-if="loading" class="status-loading">
        <v-progress-circular indeterminate size="20" width="2" />
        <span>{{ $t("loading") }}</span>
      </div>

      <div v-else-if="error" class="status-row status-row--muted">
        <v-icon icon="mdi-alert-circle-outline" color="warning" size="18" />
        <span>{{ $t("sonic_similarity.status.unavailable") }}</span>
      </div>

      <template v-else-if="ssStatus">
        <p v-if="ssStatus.aa_provider_domain" class="status-source">
          {{
            $t("sonic_similarity.status.reading_from", {
              domain: ssStatus.aa_provider_domain,
            })
          }}
        </p>

        <div v-if="ssStatus.index_size !== undefined" class="status-headline">
          <span class="status-headline-number">{{ ssStatus.index_size }}</span>
          <span class="status-headline-label">
            {{ $t("sonic_similarity.status.tracks_searchable") }}
          </span>
          <span
            v-if="ssStatus.cached_signatures !== undefined"
            class="status-headline-secondary"
          >
            {{
              $t("sonic_similarity.status.signatures_cached", {
                count: ssStatus.cached_signatures,
              })
            }}
          </span>
        </div>

        <div v-if="ssStatus.has_corpus_stats !== undefined" class="status-row">
          <v-icon
            :icon="
              ssStatus.has_corpus_stats
                ? 'mdi-check-circle'
                : 'mdi-progress-clock'
            "
            :color="ssStatus.has_corpus_stats ? 'success' : 'warning'"
            size="18"
          />
          <span>
            {{
              ssStatus.has_corpus_stats
                ? $t("sonic_similarity.status.normalization_ready")
                : $t("sonic_similarity.status.normalization_pending")
            }}
          </span>
        </div>

        <div v-if="coveragePercent !== null" class="status-coverage">
          <div class="status-coverage-header">
            <span>{{ $t("sonic_similarity.status.coverage_label") }}</span>
            <span class="status-coverage-value">{{ coveragePercent }}%</span>
          </div>
          <v-progress-linear
            :model-value="coveragePercent"
            :color="coveragePercent >= 95 ? 'success' : 'primary'"
            height="6"
            rounded
          />
          <p v-if="coveragePercent < 95" class="status-coverage-hint">
            {{ $t("sonic_similarity.status.coverage_hint") }}
          </p>
        </div>

        <div class="status-actions">
          <v-btn
            color="warning"
            variant="flat"
            size="small"
            :loading="rebuilding"
            prepend-icon="mdi-refresh"
            @click="onRebuild"
          >
            {{ $t("sonic_similarity.status.rebuild_index") }}
          </v-btn>
        </div>
      </template>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/plugins/api";
import { $t } from "@/plugins/i18n";
import type {
  AaProviderCoverage,
  SonicSimilarityStatus,
} from "@/plugins/api/interfaces";
import { calculateCoveragePercent } from "@/helpers/sonicSimilarity";

const ssStatus = ref<SonicSimilarityStatus | null>(null);
const aaCoverage = ref<AaProviderCoverage | null>(null);
const loading = ref(true);
const error = ref(false);
const rebuilding = ref(false);

// Coverage is index_size over the upstream AA provider's full candidate pool
// (analyzed + pending). The denominator comes from audio_analysis/coverage on
// whichever provider sonic_similarity reports as its source, so this works
// regardless of which AA backend is wired in.
const coveragePercent = computed(() => {
  const cov = aaCoverage.value;
  if (!cov) return null;
  return calculateCoveragePercent(
    ssStatus.value?.index_size,
    cov.analyzed + cov.pending,
  );
});

const refresh = async () => {
  try {
    ssStatus.value = await api.getSonicSimilarityStatus();
  } catch {
    error.value = true;
    return;
  }

  const aaDomain = ssStatus.value?.aa_provider_domain;
  if (!aaDomain) return;

  try {
    aaCoverage.value = await api.getAaProviderCoverage(aaDomain);
  } catch {
    // ProviderUnavailableError or transient failure — keep the rest of the
    // panel visible and just omit the coverage section.
  }
};

onMounted(async () => {
  try {
    await refresh();
  } finally {
    loading.value = false;
  }
});

const onRebuild = async () => {
  rebuilding.value = true;
  try {
    await api.rebuildSonicSimilarityIndex();
    toast.success($t("sonic_similarity.status.rebuild_started"));
    await refresh();
  } catch {
    toast.error($t("sonic_similarity.status.rebuild_failed"));
  } finally {
    rebuilding.value = false;
  }
};
</script>

<style scoped>
.status-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}

.status-content {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}

.status-source {
  font-size: 0.813rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: 0;
}

.status-headline {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.status-headline-number {
  font-size: 1.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.status-headline-label {
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.status-headline-secondary {
  font-size: 0.813rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.status-row--muted {
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.status-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.status-coverage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.status-coverage-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.status-coverage-value {
  font-weight: 600;
}

.status-coverage-hint {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 0;
  line-height: 1.4;
}

.status-actions {
  margin-top: 8px;
}
</style>
