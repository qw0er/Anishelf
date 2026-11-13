import { createApiClient } from "@anishelf/client-core";
import type { ClientSession } from "@anishelf/client-core/authentication";
import { createServerConnection } from "@anishelf/client-core/connection";
import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import {
	ClientApp,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import changelog from "../../../../CHANGELOG.md?raw";
import "@anishelf/client-ui/styles.css";
import { desktopPlatform } from "./platform.js";

declare const __ANISHELF_BUILD__: BuildInfo;
declare const __ANISHELF_DESKTOP_DEV__: boolean;

async function desktopConnection(onAuthRequired: () => void) {
	const options = {
		origin: window.location.origin,
		fetch: (path: string, init: RequestInit) => fetch(path, init),
	};
	if (__ANISHELF_DESKTOP_DEV__)
		return createCookieConnection({ ...options, onAuthRequired });
	const config = await fetch("/desktop-config.json", { cache: "no-store" });
	if (!config.ok) throw new Error("Could not load desktop configuration.");
	const { deviceAuthentication } = await config.json();
	if (!deviceAuthentication)
		return createCookieConnection({ ...options, onAuthRequired });
	const connection = createServerConnection({
		...options,
		sameOrigin: true,
		policy: { onUnauthorized: onAuthRequired },
	});
	const api = createApiClient({
		fetch: options.fetch,
		signal: connection.signal,
	});
	const path = "/api/desktop/session";
	return {
		connection,
		authentication: {
			getSession: () => api.request<ClientSession>(path, "GET"),
			signIn: (password: string) =>
				api.request<void>(path, "POST", {}, { password }),
			signOut: () => api.request<void>(path, "DELETE"),
		},
	};
}

async function start() {
	let redirectingToLogin = false;
	function onAuthRequired() {
		if (window.location.pathname === "/login") {
			runtime.queryClient.clear();
			return;
		}
		if (redirectingToLogin) return;
		redirectingToLogin = true;
		console.debug("auth.session_required", { host: "desktop" });
		restartSession(
			`/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
		);
	}

	function restartSession(path: string) {
		runtime.dispose();
		window.location.replace(path);
	}

	const runtime = await initializeClient({
		...(await desktopConnection(onAuthRequired)),
		buildInfo: __ANISHELF_BUILD__,
		changelog,
		onAuthRequired,
		platform: desktopPlatform,
		navigate: (path) => void router.navigate(path),
		restartSession,
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("Missing root element.");
	const router = createBrowserRouter(createClientRoutes());
	console.debug("client.started", { host: "desktop" });
	createRoot(root).render(
		<StrictMode>
			<ClientApp router={router} />
		</StrictMode>,
	);
}

void start().catch((error: unknown) => {
	console.error("client.start_failed", {
		host: "desktop",
		errorType: error instanceof Error ? error.name : "unknown",
	});
});
