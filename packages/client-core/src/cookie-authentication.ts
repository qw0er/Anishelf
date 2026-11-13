import type { AuthSessionResponse } from "@anishelf/contracts/http";
import { throwIfCancelled } from "./api-client.ts";
import type { ClientAuthentication, ClientSession } from "./authentication.ts";
import { createServerConnection } from "./connection.ts";

/** Creates the Web host's same-origin connection and its cookie session adapter. */
export function createCookieConnection({
	onAuthRequired,
	...options
}: Pick<Parameters<typeof createServerConnection>[0], "origin" | "fetch"> & {
	onAuthRequired: () => void;
}) {
	let csrfToken: string | undefined;
	let bootstrap: Promise<ClientSession> | undefined;
	const connection = createServerConnection({
		...options,
		sameOrigin: true,
		policy: {
			credentials: "same-origin",
			headers(method) {
				if (method === "GET") return;
				if (csrfToken) return { "x-csrf-token": csrfToken };
				return getSession().then(
					(): Record<string, string> =>
						csrfToken ? { "x-csrf-token": csrfToken } : {},
				);
			},
			onUnauthorized(path) {
				if (path === "/api/auth/login" || path === "/api/auth/password") return;
				csrfToken = undefined;
				onAuthRequired();
			},
		},
	});
	const { api, signal } = connection;
	function clearCsrfToken() {
		csrfToken = undefined;
	}
	signal.addEventListener("abort", clearCsrfToken, { once: true });

	function getSession() {
		bootstrap ??= api
			.request<AuthSessionResponse>("/api/auth/session", "GET")
			.then(({ authenticated, csrfToken: token }) => {
				throwIfCancelled(signal);
				csrfToken = token;
				return { authenticated };
			})
			.finally(() => {
				bootstrap = undefined;
			});
		return bootstrap;
	}

	const authentication = {
		getSession,
		async signIn(password: string) {
			const result = await api.request<AuthSessionResponse>(
				"/api/auth/login",
				"POST",
				{},
				{ password },
			);
			throwIfCancelled(signal);
			csrfToken = result.csrfToken;
		},
		async signOut() {
			await api.request("/api/auth/logout", "POST");
			csrfToken = undefined;
		},
		async changePassword(currentPassword: string, password: string) {
			await api.request(
				"/api/auth/password",
				"PUT",
				{},
				{ currentPassword, password },
			);
			csrfToken = undefined;
		},
	} satisfies ClientAuthentication;

	return { connection, authentication, clearCsrfToken };
}
