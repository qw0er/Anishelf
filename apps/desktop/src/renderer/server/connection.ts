import { createServerConnection } from "@anishelf/client-core/connection";
import type { DesktopBridge } from "../../ipc/desktop.js";
import { DesktopAuthentication } from "./authentication.js";

declare global {
	interface Window {
		desktop?: DesktopBridge;
	}
}

export async function createDesktopServerClient(
	desktop: DesktopBridge,
	onAuthRequired: () => void,
) {
	const origin = await desktop.getServerOrigin();
	const connection = createServerConnection({
		origin,
		fetch: (url, init) =>
			fetch(url, { ...init, credentials: "omit", redirect: "error" }),
		policy: {
			onUnauthorized(path) {
				if (
					path !== "/api/auth/device-sessions/current" &&
					path !== "/api/auth/password"
				)
					onAuthRequired();
			},
		},
	});
	return {
		connection,
		authentication: new DesktopAuthentication(connection.api, desktop, origin),
	};
}
