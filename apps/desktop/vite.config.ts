import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadClientBuild } from "../../scripts/client-build.mts";

export default defineConfig(({ command }) => ({
	base: command === "serve" ? "/" : "./",
	define: {
		__ANISHELF_BUILD__: JSON.stringify(loadClientBuild(import.meta.url)),
	},
	plugins: [react(), tailwindcss()],
	server: {
		host: "127.0.0.1",
		port: 5174,
		strictPort: true,
		hmr: { protocol: "ws", host: "127.0.0.1", clientPort: 5174 },
	},
	build: {
		outDir: "dist/renderer",
	},
}));
