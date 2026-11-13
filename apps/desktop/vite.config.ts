import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ServerOptions } from "vite";
import {
	defaultDesktopDevUrl,
	desktopApiTarget,
} from "./src/renderer-defaults.js";

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

function developmentServer(): ServerOptions {
	const rendererUrl = new URL(
		process.env.ANISHELF_DESKTOP_URL ?? defaultDesktopDevUrl,
	);
	const apiTarget = desktopApiTarget();
	if (
		rendererUrl.protocol !== "http:" ||
		rendererUrl.hostname !== "127.0.0.1" ||
		rendererUrl.username ||
		rendererUrl.password
	)
		throw new Error(
			"The desktop Vite server requires an HTTP ANISHELF_DESKTOP_URL on 127.0.0.1 without credentials.",
		);
	return {
		host: rendererUrl.hostname,
		port: Number(rendererUrl.port || 80),
		strictPort: true,
		proxy: {
			"/api": {
				target: apiTarget,
				changeOrigin: true,
				configure(proxy) {
					proxy.on("proxyReq", (upstream, request) => {
						if (
							request.headers.host &&
							request.headers.origin === `http://${request.headers.host}`
						)
							upstream.setHeader("origin", new URL(apiTarget).origin);
					});
				},
			},
		},
	};
}

export default defineConfig(({ command }) => ({
	define: {
		__ANISHELF_BUILD__: buildInfo,
		__ANISHELF_DESKTOP_DEV__: JSON.stringify(command === "serve"),
	},
	plugins: [react(), tailwindcss()],
	build: { outDir: "dist/renderer", emptyOutDir: true },
	server: command === "serve" ? developmentServer() : undefined,
}));
