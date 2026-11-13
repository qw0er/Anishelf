import { net, protocol } from "electron";

const rendererRoot = new URL("../renderer/", import.meta.url);

export function registerRendererScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: "anishelf",
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
			},
		},
	]);
}

export function registerRendererProtocol(serverOrigin: string) {
	protocol.handle("anishelf", async (request) => {
		const url = new URL(request.url);
		const path = url.pathname === "/" ? "/index.html" : url.pathname;
		// Vite emits flat, hashed asset names. Serve only the entry and those assets.
		if (
			url.host !== "desktop" ||
			request.method !== "GET" ||
			(path !== "/index.html" && !/^\/assets\/[\w.-]+\.(?:js|css)$/.test(path))
		) {
			return new Response(null, { status: 404 });
		}

		const response = await net.fetch(new URL(path.slice(1), rendererRoot).href);
		const headers = new Headers(response.headers);
		headers.set(
			"Content-Security-Policy",
			`default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${serverOrigin}`,
		);
		return new Response(response.body, { status: response.status, headers });
	});
}
