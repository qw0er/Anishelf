import { desktopOrigin, serverDefaults } from "@anishelf/contracts/defaults";
import type { Session, WebContents } from "electron";
import { isDesktopPage } from "../renderer-url.js";

export function serverAddress() {
	const argument = process.argv.find((value) => value.startsWith("--server="));
	const url = URL.parse(
		argument?.slice("--server=".length) ??
			process.env.ANISHELF_API_TARGET ??
			`http://${serverDefaults.host}:${process.env.ANISHELF_PORT ?? serverDefaults.port}`,
	);
	if (
		!url ||
		!["http:", "https:"].includes(url.protocol) ||
		url.href !== `${url.origin}/`
	)
		throw new Error("The Anishelf server address must be an HTTP(S) origin.");
	if (
		url.protocol === "http:" &&
		!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
	)
		throw new Error("A remote Anishelf server must use HTTPS.");
	return url;
}

export function attachDeviceCredentials(
	session: Session,
	origin: string,
	authorization: () => string | undefined,
	windows: ReadonlySet<WebContents>,
) {
	const apiUrls = { urls: [`${origin}/api`, `${origin}/api/*`] };
	// Chromium still sends the request directly. Keep the stored token out of the renderer.
	session.webRequest.onBeforeSendHeaders(apiUrls, (request, callback) => {
		const headers = request.requestHeaders;
		const content = request.webContents;
		const trusted =
			content &&
			windows.has(content) &&
			(request.initiatorOrigin === desktopOrigin ||
				(!request.initiatorOrigin &&
					(request.resourceType === "media" ||
						request.resourceType === "image") &&
					isDesktopPage(request.frame?.url ?? "")));
		const url = new URL(request.url);
		if (!trusted || url.origin !== origin || request.method === "OPTIONS") {
			callback({});
			return;
		}
		const isSignIn =
			request.method === "POST" && url.pathname === "/api/auth/device-sessions";
		const isMediaLink =
			(request.method === "GET" || request.method === "HEAD") &&
			/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
			url.searchParams.has("access_token");
		for (const name of Object.keys(headers)) {
			if (["authorization", "cookie"].includes(name.toLowerCase()))
				delete headers[name];
		}
		const credential = authorization();
		if (!isSignIn && !isMediaLink && credential)
			headers.Authorization = credential;
		callback({ requestHeaders: headers });
	});
}
