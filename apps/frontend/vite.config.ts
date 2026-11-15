import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaConfig } from './pwa.config.ts';

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

// https://vite.dev/config/
export default defineConfig({
  // server: {
  //   port: 4411, // Change this to your preferred port
  //   strictPort: true, // Optional: if true, Vite will exit if the port is already taken
  // },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    VitePWA({
      ...pwaConfig,
      disable: isCapacitor,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
