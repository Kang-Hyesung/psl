import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as buildWithEsbuild } from 'esbuild';
import { defineConfig } from 'vite';

function copyManifestPlugin() {
  const manifestPath = resolve(__dirname, 'manifest.json');
  const distDirPath = resolve(__dirname, 'dist');
  const distManifestPath = resolve(distDirPath, 'manifest.json');
  const contentEntryPath = resolve(__dirname, 'src/content/index.ts');
  const distContentPath = resolve(distDirPath, 'content.js');

  const sleep = async (timeoutMs: number): Promise<void> => {
    await new Promise((resolveTimer) => {
      setTimeout(resolveTimer, timeoutMs);
    });
  };

  const copyManifestWithRetry = async (): Promise<void> => {
    const maxRetries = 3;

    await mkdir(distDirPath, { recursive: true });

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await copyFile(manifestPath, distManifestPath);
        return;
      } catch (error) {
        const isRetryableError =
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'EBUSY';

        if (!isRetryableError || attempt === maxRetries) {
          throw error;
        }

        await sleep(100 * (attempt + 1));
      }
    }
  };

  const bundleContentScriptAsClassicScript = async (): Promise<void> => {
    await buildWithEsbuild({
      entryPoints: [contentEntryPath],
      outfile: distContentPath,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome109',
      charset: 'utf8',
      minify: true,
      logLevel: 'silent'
    });
  };

  return {
    name: 'copy-manifest',
    async closeBundle() {
      await bundleContentScriptAsClassicScript();
      await copyManifestWithRetry();
    }
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  plugins: [copyManifestPlugin()]
});
