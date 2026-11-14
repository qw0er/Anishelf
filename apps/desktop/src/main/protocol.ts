import { net, protocol } from "electron";

const rendererRoot = new URL("../renderer/", import.meta.url);
const rendererAsset = /^\/assets\/[\w@.-]+\.(?:js|css|wasm|woff2)$/;

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
		// Vite emits flat, hashed asset names.
		if (
			url.host !== "desktop" ||
			request.method !== "GET" ||
			(path !== "/index.html" && !rendererAsset.test(path))
		) {
			return new Response(null, { status: 404 });
		}

		const response = await net.fetch(new URL(path.slice(1), rendererRoot).href);
		const headers = new Headers(response.headers);
		headers.set(
			"Content-Security-Policy",
			[
				"default-src 'none'",
				"script-src 'self' 'wasm-unsafe-eval'",
				"style-src 'self' 'unsafe-inline'",
				"font-src 'self' blob: data:",
				`img-src 'self' ${serverOrigin} https: data: blob:`,
				`connect-src 'self' ${serverOrigin} blob: data:`,
				`media-src 'self' ${serverOrigin} blob:`,
				"worker-src 'self' blob:",
				"base-uri 'none'",
				"form-action 'none'",
			].join("; "),
		);
		headers.set("Referrer-Policy", "no-referrer");
		return new Response(response.body, { status: response.status, headers });
	});
	return () => {
		protocol.unhandle("anishelf");
	};
}
