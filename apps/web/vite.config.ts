import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  // Deduped for the same reason the dashboard is, and it has to be repeated in
  // every web app rather than set once: the workspace carries TWO React
  // versions — the root has 19.2.3, pinned by the mobile app's React Native
  // requirement, while this app has 19.2.8 — and Vite will happily resolve
  // both into one graph. Two Reacts means every hook in a shared component
  // throws "Invalid hook call" and the page renders blank with a 200.
  //
  // Aligning the versions is not available while React Native pins the root
  // one, so deduping is the fix rather than a workaround.
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
  },
});
