<template>
  <div
    class="candidate-card group cursor-pointer rounded-lg border p-3 transition-all hover:border-primary"
    :class="{ 'border-primary bg-primary/10': selected }"
    @click="$emit('select', candidate.item_id)"
  >
    <div class="flex flex-col items-center text-center gap-2">
      <div
        class="relative w-full aspect-square rounded-md overflow-hidden bg-muted"
      >
        <img
          v-if="imageUrl"
          :src="imageUrl"
          :alt="candidate.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <Music2 :size="32" class="text-muted-foreground" />
        </div>
      </div>
      <div class="w-full min-w-0">
        <p class="font-medium text-sm truncate">{{ candidate.name }}</p>
        <p class="text-xs text-muted-foreground truncate">
          {{ candidate.artist }}
        </p>
        <p v-if="showDistance" class="text-xs text-muted-foreground/60 mt-1">
          {{ matchPct }}% match
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Music2 } from "lucide-vue-next";
import type { ExploreCandidate } from "@/composables/useExploreSession";

const props = withDefaults(
  defineProps<{
    candidate: ExploreCandidate;
    selected?: boolean;
    showDistance?: boolean;
  }>(),
  {
    selected: false,
    showDistance: true,
  },
);

defineEmits<{
  select: [trackId: string];
}>();

const imageUrl = computed(() => {
  return props.candidate.image_url;
});

const matchPct = computed(() => {
  return Math.max(0, Math.round((1 - props.candidate.distance) * 100));
});
</script>
