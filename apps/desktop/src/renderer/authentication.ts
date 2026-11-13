import { ApiClientError } from "@anishelf/client-core";
import type { ClientAuthentication } from "@anishelf/client-core/authentication";
import type { createServerConnection } from "@anishelf/client-core/connection";
import type { DesktopBridge } from "../ipc/desktop.js";

const currentDevicePath = "/api/auth/device-sessions/current";

function isUnauthorized(error: unknown) {
	return error instanceof ApiClientError && error.status === 401;
}

export function createDesktopAuthentication(
	connection: ReturnType<typeof createServerConnection>,
	desktop: DesktopBridge,
): ClientAuthentication {
	const { api } = connection;
	let pending = Promise.resolve();

	// A session check must not clear a credential from a concurrent sign-in.
	function run<T>(operation: () => Promise<T>): Promise<T> {
		const result = pending.then(operation);
		pending = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	return {
		signIn(password) {
			return run(async () => {
				const { status } = await desktop.signIn(password);
				if (status === 201) return;
				if (status === 0) {
					throw new ApiClientError({
						kind: "network",
						message:
							"Cannot connect to the server. Check your connection and try again.",
					});
				}
				const message =
					status === 401
						? "Invalid password."
						: status === 429
							? "Too many login attempts. Try again later."
							: "Could not sign in. Check the server and try again.";
				throw new ApiClientError({ kind: "http", status, message });
			});
		},
		getSession() {
			return run(async () => {
				try {
					await api.request(currentDevicePath, "GET");
					return { authenticated: true };
				} catch (error) {
					if (!isUnauthorized(error)) throw error;
					await desktop.clearDeviceToken();
					return { authenticated: false };
				}
			});
		},
		signOut() {
			return run(async () => {
				try {
					await api.request(currentDevicePath, "DELETE");
				} catch (error) {
					if (!isUnauthorized(error)) throw error;
				}
				await desktop.clearDeviceToken();
			});
		},
		changePassword(currentPassword, password) {
			return run(async () => {
				await api.request(
					"/api/auth/password",
					"PUT",
					{},
					{ currentPassword, password },
				);
				await desktop.clearDeviceToken();
			});
		},
	};
}
