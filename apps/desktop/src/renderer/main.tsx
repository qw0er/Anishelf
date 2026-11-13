import {
	ClientApp,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter } from "react-router";
import "@anishelf/client-ui/styles.css";
import { createDesktopClient } from "./connection.js";

declare const __ANISHELF_BUILD__: { buildInfo: BuildInfo; changelog: string };

const mount = document.getElementById("app");
if (!mount) throw new Error("Desktop mount point is missing.");
const root = createRoot(mount);

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", dark);
document.documentElement.style.colorScheme = dark ? "dark" : "light";

async function start() {
	if (!window.desktop) throw new Error("Open Anishelf in Electron.");

	let restarting = false;
	function restartSession(path: string) {
		if (restarting) return;
		restarting = true;
		runtime.dispose();
		window.history.replaceState(null, "", `#${path}`);
		window.location.reload();
	}

	function onAuthRequired() {
		const { pathname, search, hash } = router.state.location;
		if (pathname === "/login") return;
		const returnTo = encodeURIComponent(`${pathname}${search}${hash}`);
		console.debug("auth.session_required", { host: "desktop" });
		restartSession(`/login?returnTo=${returnTo}`);
	}

	const client = await createDesktopClient(window.desktop, onAuthRequired);
	const runtime = await initializeClient({
		...client,
		...__ANISHELF_BUILD__,
		onAuthRequired,
		navigate: (path) => void router.navigate(path),
		restartSession,
	});
	const router = createHashRouter(createClientRoutes());
	root.render(
		<StrictMode>
			<ClientApp router={router} />
		</StrictMode>,
	);
	console.info("client.started", { host: "desktop" });
}

void start().catch((error: unknown) => {
	console.error("client.start_failed", {
		host: "desktop",
		errorType: error instanceof Error ? error.name : "unknown",
	});
	root.render(
		<main className="grid min-h-screen place-items-center p-6">
			<p role="alert">Could not start Anishelf Desktop.</p>
		</main>,
	);
});
