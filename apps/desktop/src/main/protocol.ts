import { app, net, protocol } from "electron";

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

export function registerRendererProtocol(getServerOrigin: () => string) {
	const development =
		!app.isPackaged && process.env.ANISHELF_DESKTOP_DEV === "1";
	if (development) console.info("desktop.renderer_development_server_enabled");
	protocol.handle("anishelf", async (request) => {
		const url = new URL(request.url);
		const path = url.pathname === "/" ? "/index.html" : url.pathname;
		// Vite emits flat, hashed asset names.
		if (
			url.host !== "desktop" ||
			request.method !== "GET" ||
			(!development && path !== "/index.html" && !rendererAsset.test(path))
		) {
			return new Response(null, { status: 404 });
		}

		const devResource = new URL("http://127.0.0.1:5174");
		devResource.pathname = path;
		devResource.search = url.search;
		const resource = development
			? devResource.href
			: new URL(path.slice(1), rendererRoot).href;
		const response = await net.fetch(resource);
		const headers = new Headers(response.headers);
		const serverOrigin = getServerOrigin();
		headers.set(
			"Content-Security-Policy",
			[
				"default-src 'none'",
				`script-src 'self' 'wasm-unsafe-eval'${development ? " 'unsafe-inline'" : ""}`,
				"style-src 'self' 'unsafe-inline'",
				"font-src 'self' blob: data:",
				`img-src 'self' ${serverOrigin} https: data: blob:`,
				`connect-src 'self' ${serverOrigin} blob: data:${development ? " ws://127.0.0.1:5174" : ""}`,
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
