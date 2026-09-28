import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": {
				target: process.env.ANISHELF_API_TARGET ?? "http://127.0.0.1:3000",
				changeOrigin: true,
			},
		},
	},
	plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
});
