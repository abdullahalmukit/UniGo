import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ws: Socket.IO for chat (B2b) runs under /api/socket on the API server
      "/api": { target: "http://localhost:4000", ws: true },
    },
  },
});
