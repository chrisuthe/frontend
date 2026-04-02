<template>
  <div
    class="candidate-card group cursor-pointer rounded-lg border p-3 transition-all hover:border-primary"
    :class="{ 'border-primary bg-primary/10': selected }"
    @click="$emit('select', candidate.item_id)"
  >
    <div class="flex items-center gap-3">
      <div
        class="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-muted"
      >
        <img
          v-if="imageUrl"
          :src="imageUrl"
          :alt="candidate.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <Music2 :size="20" class="text-muted-foreground" />
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-medium text-sm truncate">{{ candidate.name }}</p>
        <p class="text-xs text-muted-foreground truncate">
          {{ candidate.artist }}
        </p>
        <p v-if="showDistance" class="text-xs text-muted-foreground/60 mt-0.5">
          {{ matchPct }}% match
        </p>
        <p
          v-if="candidate.match_reasons?.length"
          class="text-xs text-muted-foreground/80 mt-0.5 leading-snug"
        >
          {{ candidate.match_reasons.join(", ") }}
        </p>
        <p
          v-if="candidate.differ_reasons?.length"
          class="text-xs text-muted-foreground/50 italic leading-snug"
        >
          {{ candidate.differ_reasons.join(", ") }}
        </p>
      </div>
      <button
        v-if="showRemove"
        class="flex-shrink-0 p-1 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Remove from queue"
        @click.stop="$emit('remove', candidate.item_id)"
      >
        <X :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Music2, X } from "lucide-vue-next";
import type { ExploreCandidate } from "@/composables/useExploreSession";

const props = withDefaults(
  defineProps<{
    candidate: ExploreCandidate;
    selected?: boolean;
    showDistance?: boolean;
    showRemove?: boolean;
  }>(),
  {
    selected: false,
    showDistance: true,
    showRemove: false,
  },
);

defineEmits<{
  select: [trackId: string];
  remove: [trackId: string];
}>();

const imageUrl = computed(() => {
  return props.candidate.image_url;
});

const matchPct = computed(() => {
  return Math.max(0, Math.round((1 - props.candidate.distance) * 100));
});
</script>
