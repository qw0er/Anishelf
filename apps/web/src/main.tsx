import { createServerConnection } from "@anishelf/client-core/connection";
import {
	ClientApp,
	configureClientRuntime,
	createClientRoutes,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import changelog from "../../../CHANGELOG.md?raw";
import "@anishelf/client-ui/styles.css";
import { registerPwa } from "./pwa.js";

declare const __ANISHELF_BUILD__: BuildInfo;

function onAuthRequired() {
	console.debug("auth.session_required");
	window.dispatchEvent(new Event("anishelf:auth-required"));
}

const runtime = configureClientRuntime({
	connection: createServerConnection({
		origin: window.location.origin,
		sameOrigin: true,
		fetch: (path, init) => fetch(path, init),
		onAuthRequired,
	}),
	buildInfo: __ANISHELF_BUILD__,
	changelog,
	onAuthRequired,
	replaceLocation: (path) => window.location.replace(path),
});

registerPwa();
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");
const router = createBrowserRouter(createClientRoutes());
let redirectingToLogin = false;
window.addEventListener("anishelf:auth-required", () => {
	if (window.location.pathname === "/login") {
		runtime.queryClient.clear();
		return;
	}
	if (redirectingToLogin) return;
	redirectingToLogin = true;
	runtime.dispose();
	window.location.replace(
		`/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
	);
});

createRoot(root).render(
	<StrictMode>
		<ClientApp router={router} />
	</StrictMode>,
);
