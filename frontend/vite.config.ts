import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than app code: separate files stay cached across releases.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/node_modules[\\/](@mui|@emotion|@popperjs|react-transition-group|stylis)/.test(id)) return "mui";
          if (/node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/.test(id)) return "leaflet";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
