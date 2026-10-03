import {
	deploymentDefaults,
	developmentDefaults,
} from "@anishelf/backend/public/defaults";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
const apiTarget =
	process.env.ANISHELF_API_TARGET ??
	`http://${deploymentDefaults.host}:${deploymentDefaults.port}`;

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: {
		host: developmentDefaults.host,
		port: developmentDefaults.port,
		strictPort: true,
		proxy: {
			"/api": {
				target: apiTarget,
				changeOrigin: true,
				configure(proxy) {
					proxy.on("proxyReq", (proxyRequest, request) => {
						if (
							request.headers.host &&
							request.headers.origin === `http://${request.headers.host}`
						) {
							proxyRequest.setHeader("origin", new URL(apiTarget).origin);
						}
					});
				},
			},
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		babel({ presets: [reactCompilerPreset()] }),
	],
});
