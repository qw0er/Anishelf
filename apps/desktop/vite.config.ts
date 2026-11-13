import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const manifest = new URL("./build-info.json", import.meta.url);
const buildInfo = existsSync(manifest)
	? readFileSync(manifest, "utf8")
	: JSON.stringify({
			version: JSON.parse(
				readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
			).version,
			channel: "development",
			commit: null,
			builtAt: null,
		});

export default defineConfig({
	define: {
		__ANISHELF_BUILD__: buildInfo,
	},
	plugins: [react(), tailwindcss()],
	build: { outDir: "dist/renderer", emptyOutDir: true },
});
