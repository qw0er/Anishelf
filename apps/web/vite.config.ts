import {
	developmentDefaults,
	serverDefaults,
} from "@anishelf/contracts/defaults";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { loadClientBuild } from "../../scripts/client-build.mts";

// https://vite.dev/config/
const playerPackage = "node_modules/libmedia-react-player/";
const apiTarget = `http://${serverDefaults.host}:${serverDefaults.port}`;
export default defineConfig({
	define: {
		__ANISHELF_BUILD__: JSON.stringify(loadClientBuild(import.meta.url)),
	},
	resolve: { tsconfigPaths: true },
	build: {
		rolldownOptions: {
			output: {
				// Both dynamic chunks and URL assets belong outside the offline shell.
				assetFileNames: (asset) =>
					asset.originalFileNames.some((name) => name.includes(playerPackage))
						? "assets/libmedia-player-[name]-[hash][extname]"
						: "assets/[name]-[hash][extname]",
				chunkFileNames: (chunk) =>
					chunk.moduleIds.some((id) => id.includes(playerPackage))
						? "assets/libmedia-player-[name]-[hash].js"
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
							proxyRequest.setHeader("origin", apiTarget);
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
				globIgnores: ["**/libmedia-player-*.js"],
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
