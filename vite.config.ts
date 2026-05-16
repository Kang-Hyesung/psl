import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function copyManifestPlugin() {
  const manifestPath = resolve(__dirname, 'manifest.json');
  const distDirPath = resolve(__dirname, 'dist');
  const distManifestPath = resolve(distDirPath, 'manifest.json');

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

  return {
    name: 'copy-manifest',
    async closeBundle() {
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
