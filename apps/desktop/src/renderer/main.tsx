import { createServerConnection } from "@anishelf/client-core/connection";
import {
	ClientApp,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter } from "react-router";
import changelog from "../../../../CHANGELOG.md?raw";
import "@anishelf/client-ui/styles.css";
import {
	createDesktopAuthentication,
	isSessionCommand,
} from "./authentication.js";
import { desktopPlatform } from "./platform.js";

declare const __ANISHELF_BUILD__: BuildInfo;

if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
	document.documentElement.classList.add("dark");
	document.documentElement.style.colorScheme = "dark";
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", "#0f0f10");
}

async function start() {
	const { desktop } = window;
	const { origin, deviceName } = await desktop.configuration();
	let redirectingToLogin = false;

	function onAuthRequired() {
		const { pathname, search, hash } = router.state.location;
		if (pathname === "/login") {
			runtime.queryClient.clear();
			return;
		}
		if (redirectingToLogin) return;
		redirectingToLogin = true;
		console.debug("auth.session_required", { host: "desktop" });
		restartSession(
			`/login?returnTo=${encodeURIComponent(`${pathname}${search}${hash}`)}`,
		);
	}

	function restartSession(path: string) {
		runtime.dispose();
		window.history.replaceState(null, "", `#${path}`);
		window.location.reload();
	}

	const connection = createServerConnection({
		origin,
		fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
		policy: {
			onUnauthorized(path) {
				if (!isSessionCommand(path)) onAuthRequired();
			},
		},
	});
	const runtime = await initializeClient({
		connection,
		authentication: createDesktopAuthentication(
			connection.api,
			desktop,
			deviceName,
		),
		buildInfo: __ANISHELF_BUILD__,
		changelog,
		onAuthRequired,
		platform: desktopPlatform,
		navigate: (path) => void router.navigate(path),
		restartSession,
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("Missing root element.");
	const router = createHashRouter(createClientRoutes());
	console.debug("client.started", { host: "desktop", server: origin });
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
