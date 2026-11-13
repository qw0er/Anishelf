import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import {
	ClientApp,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import { browserPlatform } from "@anishelf/client-ui/browser-platform";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import "@anishelf/client-ui/styles.css";
import { registerPwa } from "./pwa.js";
import { loginRedirectPath } from "./session.js";

declare const __ANISHELF_BUILD__: { buildInfo: BuildInfo; changelog: string };

registerPwa();

async function start() {
	let redirectingToLogin = false;
	function onAuthRequired() {
		if (window.location.pathname === "/login") {
			runtime.queryClient.clear();
			return;
		}
		if (redirectingToLogin) return;
		redirectingToLogin = true;
		console.debug("auth.session_required", { host: "web" });
		restartSession(loginRedirectPath(window.location));
	}

	function restartSession(path: string) {
		runtime.dispose();
		window.location.replace(path);
	}

	const runtime = await initializeClient({
		...createCookieConnection({
			origin: window.location.origin,
			fetch: (path, init) => fetch(path, init),
			onAuthRequired,
		}),
		...__ANISHELF_BUILD__,
		onAuthRequired,
		platform: browserPlatform,
		navigate: (path) => void router.navigate(path),
		restartSession,
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("Missing root element.");
	const router = createBrowserRouter(createClientRoutes());
	console.debug("client.started", { host: "web" });
	createRoot(root).render(
		<StrictMode>
			<ClientApp router={router} />
		</StrictMode>,
	);
}

void start().catch((error: unknown) => {
	console.error("client.start_failed", {
		host: "web",
		errorType: error instanceof Error ? error.name : "unknown",
	});
});
