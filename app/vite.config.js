import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    vue(),
    // Old/budget Android tablets can ship a WebView too old to run native
    // <script type="module"> at all, which fails silently (blank white
    // screen, no console error) rather than throwing. This emits a second,
    // ES5-transpiled + polyfilled bundle that such devices load instead.
    // NOTE: this does NOT help if the WebView lacks Proxy support — Vue 3's
    // reactivity requires Proxy and it cannot be polyfilled. If the white
    // screen persists after this, that's the next thing to check.
    legacy({
      targets: ['Android >= 4.4', 'iOS >= 9', 'last 4 versions', 'not dead'],
    }),
  ],
  build: {
    outDir: 'dist',
  },
});
