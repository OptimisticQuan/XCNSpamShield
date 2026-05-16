import path from 'node:path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  publicDir: path.resolve(root, 'public'),
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: path.resolve(root, 'popup.html'),
        background: path.resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }

          return 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'popup.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(root, 'public/manifest.json'),
          dest: '.',
        },
      ],
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
