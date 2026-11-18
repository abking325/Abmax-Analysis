import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

import fs from 'fs';

export default defineConfig(() => {
  return {
    base: process.env.VITE_BASE_PATH || './',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'keystore-download-handler',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/download-keystore-base64') {
              const filePath = path.resolve('android/app/abmax-permanent-base64.txt');
              if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Content-Disposition': 'attachment; filename="abmax-permanent-base64.txt"',
                });
                fs.createReadStream(filePath).pipe(res);
                return;
              }
            } else if (req.url === '/download-keystore-file') {
              const filePath = path.resolve('android/app/abmax-permanent.keystore');
              if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': 'attachment; filename="abmax-permanent.keystore"',
                });
                fs.createReadStream(filePath).pipe(res);
                return;
              }
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
