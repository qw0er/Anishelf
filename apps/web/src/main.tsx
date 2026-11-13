import { createServerConnection } from "@anishelf/client-core/connection";
import {
	ClientApp,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import changelog from "../../../CHANGELOG.md?raw";
import "@anishelf/client-ui/styles.css";
import { browserPlatform } from "./browser-platform.js";
import { registerPwa } from "./pwa.js";

declare const __ANISHELF_BUILD__: BuildInfo;

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
		console.debug("auth.session_required");
		restartSession(
			`/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
		);
	}

	function restartSession(path: string) {
		runtime.dispose();
		window.location.replace(path);
	}

	const runtime = await initializeClient({
		connection: createServerConnection({
			origin: window.location.origin,
			sameOrigin: true,
			fetch: (path, init) => fetch(path, init),
			onAuthRequired,
		}),
		buildInfo: __ANISHELF_BUILD__,
		changelog,
		onAuthRequired,
		platform: browserPlatform,
		navigate: (path) => void router.navigate(path),
		restartSession,
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("Missing root element.");
	const router = createBrowserRouter(createClientRoutes());
	createRoot(root).render(
		<StrictMode>
			<ClientApp router={router} />
		</StrictMode>,
	);
}

void start().catch((error: unknown) => {
	console.error("client.start_failed", error);
});
