import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol, type Session } from "electron";

import { desktopScheme, rendererUrl } from "../renderer-url.js";

export function registerDesktopScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: desktopScheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
			},
		},
	]);
}

export function registerRendererFiles(
	session: Session,
	serverOrigin: string,
	root: string,
) {
	const csp = [
		"default-src 'none'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		"font-src 'self' data:",
		"img-src 'self' https: http: data: blob:",
		`connect-src 'self' ${serverOrigin}`,
		`media-src 'self' blob: ${serverOrigin}`,
		"worker-src 'self' blob:",
		"base-uri 'none'",
		"frame-ancestors 'none'",
		"form-action 'none'",
	].join("; ");
	session.protocol.handle(desktopScheme, async (request) => {
		if (request.method !== "GET" && request.method !== "HEAD")
			return new Response(null, { status: 405 });
		const url = new URL(request.url);
		if (
			url.host !== rendererUrl.host ||
			url.username ||
			url.password ||
			url.search
		)
			return new Response(null, { status: 404 });
		const asset = /^\/assets\/([a-zA-Z0-9_@.-]+)$/.exec(url.pathname)?.[1];
		const file =
			url.pathname === "/"
				? join(root, "index.html")
				: asset && !asset.startsWith(".")
					? join(root, "assets", asset)
					: undefined;
		if (!file) return new Response(null, { status: 404 });
		try {
			const response = await net.fetch(pathToFileURL(file).href, {
				method: request.method,
			});
			const headers = new Headers(response.headers);
			headers.set("Content-Security-Policy", csp);
			headers.set("Referrer-Policy", "no-referrer");
			headers.set("X-Content-Type-Options", "nosniff");
			return new Response(response.body, { status: response.status, headers });
		} catch {
			return new Response(null, { status: 404 });
		}
	});
}
