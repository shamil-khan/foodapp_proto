import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaConfig: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  pwaAssets: {
    image: 'public/logo.svg',
  },
  manifest: {
    name: 'FoodApp',
    short_name: 'fapp',
    description: 'Offline-first POS and Food Ordering',
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'any',
    scope: '/',
    start_url: '/',
  },
  workbox: {
    globPatterns: [
      '**/*.{js,css,html,ico,png,svg,woff2}',
    ],
    navigateFallbackDenylist: [
      /^\/api/,
    ],
    runtimeCaching: [
      {
        urlPattern: ({ request }) => request.destination === 'image',
        handler: 'CacheFirst',
        options: {
          cacheName: 'foodapp-menu-images',
          expiration: {
            maxEntries: 300,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Days
          },
          cacheableResponse: {
            statuses: [
              0,
              200,
            ],
          },
        },
      },
    ],
  },
};
