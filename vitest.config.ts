import { defineConfig } from "vitest/config";

// Obsidian-Code ruft window.setTimeout & Co. (Portal-Regel prefer-window-timers); test/setup-window.ts stellt window im Node-Lauf.
export default defineConfig({ test: { setupFiles: ["test/setup-window.ts"] } });
