<template>
  <v-card class="status-card" elevation="0">
    <div class="status-content">
      <h3 class="status-title">{{ $t("sonic_analysis.status.title") }}</h3>

      <div v-if="loading" class="status-loading">
        <v-progress-circular indeterminate size="20" width="2" />
        <span>{{ $t("loading") }}</span>
      </div>

      <div v-else-if="error" class="status-row status-row--muted">
        <v-icon icon="mdi-alert-circle-outline" color="warning" size="18" />
        <span>{{ $t("sonic_analysis.status.unavailable") }}</span>
      </div>

      <div v-else-if="status" class="status-rows">
        <div v-if="status.clap_model_loaded !== undefined" class="status-row">
          <v-icon
            :icon="
              status.clap_model_loaded ? 'mdi-check-circle' : 'mdi-close-circle'
            "
            :color="status.clap_model_loaded ? 'success' : 'error'"
            size="18"
          />
          <span>{{ $t("sonic_analysis.status.clap_model_loaded") }}</span>
        </div>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "@/plugins/api";
import type { SonicAnalysisStatus } from "@/plugins/api/interfaces";

const status = ref<SonicAnalysisStatus | null>(null);
const loading = ref(true);
const error = ref(false);

onMounted(async () => {
  try {
    status.value = await api.getSonicAnalysisStatus();
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.status-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}

.status-content {
  padding: 20px 24px;
}

.status-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: rgb(var(--v-theme-on-surface));
}

.status-loading,
.status-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  flex-direction: row;
  align-items: center;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
