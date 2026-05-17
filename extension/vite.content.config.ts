import path from 'node:path';
import { defineConfig } from 'vite';

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(root, 'src/content/index.ts'),
      name: 'XCNSpamShieldContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'content.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});