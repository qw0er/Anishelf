import { createServerConnection } from "@anishelf/client-core/connection";
import type { DesktopBridge } from "../ipc/desktop.js";
import { createDesktopAuthentication } from "./authentication.js";

declare global {
	interface Window {
		desktop?: DesktopBridge;
	}
}

export async function createDesktopClient(desktop: DesktopBridge) {
	const origin = await desktop.getServerOrigin();
	const connection = createServerConnection({
		origin,
		fetch: (url, init) =>
			fetch(url, { ...init, credentials: "omit", redirect: "error" }),
	});
	return {
		connection,
		authentication: createDesktopAuthentication(connection, desktop),
	};
}
