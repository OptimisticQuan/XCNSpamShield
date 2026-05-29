import path from 'node:path';
import { build as viteBuild, defineConfig, type UserConfig } from 'vite';

const root = path.resolve(__dirname);

function createContentBuild(entryFile: string, outputFileName: string, globalName: string): UserConfig {
  return {
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
        entry: path.resolve(root, entryFile),
        name: globalName,
        formats: ['iife'] as const,
        fileName: () => outputFileName,
      },
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo: { name?: string }) => {
            if (assetInfo.name?.endsWith('.css')) {
              return 'content.css';
            }

            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
}

function buildPageBridgePlugin() {
  let bridgeBuildStarted = false;

  return {
    name: 'xcnspamshield-build-page-bridge',
    async closeBundle() {
      if (bridgeBuildStarted) {
        return;
      }

      bridgeBuildStarted = true;
      await viteBuild({
        ...createContentBuild('src/content/page-bridge.ts', 'page-bridge.js', 'XCNSpamShieldPageBridge'),
        configFile: false,
        plugins: [],
      });
    },
  };
}

const contentBuild = createContentBuild('src/content/index.ts', 'content.js', 'XCNSpamShieldContent');

export default defineConfig({
  ...contentBuild,
  plugins: [buildPageBridgePlugin()],
});