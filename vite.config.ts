import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "ResqAI",
        short_name: "ResqAI",
        theme_color: "#DC2626",
        background_color: "#FFFFFF",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "/icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        navigateFallback: "/",
        additionalManifestEntries: [
          { url: "/", revision: null },
          { url: "/triage", revision: null },
          { url: "/guides", revision: null },
          { url: "/sos", revision: null },
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith("googleapis.com")
              || url.hostname === "generativelanguage.googleapis.com",
            handler: "NetworkFirst",
            options: {
              cacheName: "google-api-cache",
              networkTimeoutSeconds: 30,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
});
