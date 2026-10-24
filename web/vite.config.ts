import { existsSync, readFileSync } from "node:fs";
import {
	deploymentDefaults,
	developmentDefaults,
} from "@anishelf/backend/contracts/defaults";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
const apiTarget =
	process.env.ANISHELF_API_TARGET ??
	`http://${deploymentDefaults.host}:${deploymentDefaults.port}`;
const buildInfoPath = new URL("./build-info.json", import.meta.url);
// Static analysis loads this config before npm's prebuild generates the manifest.
const buildInfo = existsSync(buildInfoPath)
	? readFileSync(buildInfoPath, "utf8")
	: JSON.stringify({
			version: JSON.parse(
				readFileSync(new URL("../package.json", import.meta.url), "utf8"),
			).version,
			commit: null,
			channel: "development",
			builtAt: null,
		});

export default defineConfig({
	define: {
		__ANISHELF_BUILD__: buildInfo,
	},
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
