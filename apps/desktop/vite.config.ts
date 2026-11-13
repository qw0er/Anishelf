import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadClientBuild } from "../../scripts/client-build.mts";

export default defineConfig({
	base: "./",
	define: {
		__ANISHELF_BUILD__: JSON.stringify(loadClientBuild(import.meta.url)),
	},
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "dist/renderer",
	},
});
