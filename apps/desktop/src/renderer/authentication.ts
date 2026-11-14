import { ApiClientError } from "@anishelf/client-core";
import type { ClientAuthentication } from "@anishelf/client-core/authentication";
import type { createServerConnection } from "@anishelf/client-core/connection";
import type { DesktopBridge } from "../ipc/desktop.js";

const currentDevicePath = "/api/auth/device-sessions/current";

function isUnauthorized(error: unknown) {
	return error instanceof ApiClientError && error.status === 401;
}

function signInError(status: number): ApiClientError {
	if (status === 0) {
		return new ApiClientError({
			kind: "network",
			message:
				"Cannot connect to the server. Check your connection and try again.",
		});
	}
	let message = "Could not sign in. Check the server and try again.";
	if (status === 401) message = "Invalid password.";
	if (status === 429) message = "Too many login attempts. Try again later.";
	return new ApiClientError({ kind: "http", status, message });
}

export class DesktopAuthentication implements ClientAuthentication {
	private pending = Promise.resolve();

	constructor(
		private readonly api: Pick<
			ReturnType<typeof createServerConnection>["api"],
			"request"
		>,
		private readonly desktop: Pick<
			DesktopBridge,
			"signIn" | "clearDeviceToken"
		>,
	) {
		this.changePassword = this.changePassword.bind(this);
	}

	signIn(password: string): Promise<void> {
		return this.run(async () => {
			const { status } = await this.desktop.signIn(password);
			if (status !== 201) throw signInError(status);
		});
	}

	getSession(): ReturnType<ClientAuthentication["getSession"]> {
		return this.run(async () => {
			try {
				await this.api.request(currentDevicePath, "GET");
				return { authenticated: true };
			} catch (error) {
				if (!isUnauthorized(error)) throw error;
				await this.desktop.clearDeviceToken();
				return { authenticated: false };
			}
		});
	}

	signOut(): Promise<void> {
		return this.run(async () => {
			try {
				await this.api.request(currentDevicePath, "DELETE");
			} catch (error) {
				if (!isUnauthorized(error)) throw error;
			}
			await this.desktop.clearDeviceToken();
		});
	}

	changePassword(currentPassword: string, password: string): Promise<void> {
		return this.run(async () => {
			await this.api.request(
				"/api/auth/password",
				"PUT",
				{},
				{ currentPassword, password },
			);
			await this.desktop.clearDeviceToken();
		});
	}

	// A session check must not clear a credential from a concurrent sign-in.
	private run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.pending.then(operation);
		this.pending = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}
