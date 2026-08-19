import { ref, watchEffect } from 'vue';

const KEY = 'vfw_pos_dark_mode';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved != null) return saved === '1';
  } catch (e) { /* ignore */ }
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export const isDark = ref(initial());

watchEffect(() => {
  document.documentElement.classList.toggle('dark', isDark.value);
  try { localStorage.setItem(KEY, isDark.value ? '1' : '0'); } catch (e) { /* ignore */ }
});

export function toggleDark() { isDark.value = !isDark.value; }
