import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "UML Colaborativo",
        short_name: "UMLApp",
        description: "Diagramador UML colaborativo en tiempo real",
        theme_color: "#1a1a2e",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: "0.0.0.0",
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      "/auth": "http://backend:3000",
      "/api": "http://backend:3000",
      "/diagramas": "http://backend:3000",
    },
  },
});
