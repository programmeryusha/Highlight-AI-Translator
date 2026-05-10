import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: "public/manifest.json",
      additionalInputs: ["src/chat/chat.html", "src/crop/crop.html", "src/welcome/welcome.html"],
    }),
  ],
});
