<template>
  <span class="avatar-badge">
    <img v-if="isImage" :src="value" :alt="alt" @error="failed = true">
    <span v-else>{{ value || fallback }}</span>
  </span>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  value: { type: String, default: '' },
  fallback: { type: String, default: '🌿' },
  alt: { type: String, default: '头像' }
})
const failed = ref(false)
watch(() => props.value, () => { failed.value = false })
const isImage = computed(() => !failed.value && /^(\/api\/avatars\/|https?:\/\/|data:image\/)/i.test(props.value || ''))
</script>

<style scoped>
.avatar-badge{position:relative;display:grid;width:100%;height:100%;place-items:center;overflow:hidden;border-radius:inherit}.avatar-badge img{position:absolute;inset:0;display:block;width:100%!important;height:100%!important;min-width:100%;min-height:100%;object-fit:cover!important;border-radius:inherit;transform:scale(1.01)}
</style>
