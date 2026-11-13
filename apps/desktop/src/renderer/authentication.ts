import { ApiClientError } from "@anishelf/client-core";
import type {
	ClientAuthentication,
	ClientSession,
} from "@anishelf/client-core/authentication";
import type { createServerConnection } from "@anishelf/client-core/connection";
import type { DeviceLoginResponse } from "@anishelf/contracts/http";
import type { DesktopBridge } from "../ipc/desktop.js";

const sessionsPath = "/api/auth/device-sessions";
const currentPath = `${sessionsPath}/current`;
const passwordPath = "/api/auth/password";

export function isSessionCommand(path: string) {
	return [sessionsPath, currentPath, passwordPath].includes(path);
}

export function createDesktopAuthentication(
	api: ReturnType<typeof createServerConnection>["api"],
	desktop: DesktopBridge,
	name: string,
): ClientAuthentication {
	let checking: Promise<ClientSession> | undefined;
	return {
		getSession() {
			checking ??= api
				.request(currentPath, "GET")
				.then(
					() => ({ authenticated: true }),
					async (error: unknown) => {
						if (!(error instanceof ApiClientError && error.status === 401))
							throw error;
						await desktop.setDeviceToken(null);
						return { authenticated: false };
					},
				)
				.finally(() => {
					checking = undefined;
				});
			return checking;
		},
		async signIn(password) {
			await checking?.catch(() => {});
			const { token } = await api.request<DeviceLoginResponse>(
				sessionsPath,
				"POST",
				{},
				{ name, password },
			);
			await desktop.setDeviceToken(token);
		},
		async signOut() {
			try {
				await api.request(currentPath, "DELETE");
			} catch (error) {
				if (!(error instanceof ApiClientError && error.status === 401))
					throw error;
			}
			await desktop.setDeviceToken(null);
		},
		async changePassword(currentPassword, password) {
			await api.request(passwordPath, "PUT", {}, { currentPassword, password });
			await desktop.setDeviceToken(null);
		},
	};
}
