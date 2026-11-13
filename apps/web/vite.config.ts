import { existsSync, readFileSync } from "node:fs";
import {
	deploymentDefaults,
	developmentDefaults,
} from "@anishelf/backend/contracts/defaults";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
				readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
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
	worker: {
		rolldownOptions: {
			output: {
				entryFileNames: "assets/playback-worker-[name]-[hash].js",
				chunkFileNames: "assets/playback-worker-[name]-[hash].js",
			},
		},
	},
	build: {
		rolldownOptions: {
			output: {
				// Keep the lazy decoder out of the application shell's precache.
				chunkFileNames: (chunk) =>
					chunk.moduleIds.some((id) =>
						id.includes("/node_modules/movi-player/"),
					)
						? "assets/movi-player-[name]-[hash].js"
						: "assets/[name]-[hash].js",
			},
		},
	},
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
		VitePWA({
			injectRegister: null,
			manifest: {
				name: "Anishelf",
				short_name: "Anishelf",
				description: "Your local media shelf.",
				start_url: "/",
				scope: "/",
				display: "standalone",
				background_color: "#fafafa",
				theme_color: "#fafafa",
				icons: [
					{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
				globIgnores: [
					"**/movi-player-*.js",
					"**/jassub-*.js",
					"**/playback-worker-*.js",
					"**/default-*.woff2",
				],
				skipWaiting: true,
				clientsClaim: true,
				navigateFallback: null,
				runtimeCaching: [
					{
						urlPattern: ({ request, url }) =>
							request.mode === "navigate" &&
							!/^\/api(?:\/|$)/.test(url.pathname),
						handler: "NetworkFirst",
						options: {
							cacheName: "anishelf-pages",
							precacheFallback: { fallbackURL: "/index.html" },
						},
					},
				],
			},
		}),
		react(),
		tailwindcss(),
		babel({ presets: [reactCompilerPreset()] }),
	],
});
