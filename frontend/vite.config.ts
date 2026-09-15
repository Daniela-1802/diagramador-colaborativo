import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/auth": "http://backend:3000",
      "/api": "http://backend:3000",
      "/diagramas": "http://backend:3000",
    },
  },
});
