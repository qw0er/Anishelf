import { createCookieConnection } from "@anishelf/client-core/cookie-authentication";
import {
	ClientApp,
	ClientSessionLifecycle,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import { browserPlatform } from "@anishelf/client-ui/browser-platform";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { WebLoginPage } from "./auth/login-page.js";
import { registerPwa } from "./platform/pwa.js";
import { WebExternalPlayerSettings } from "./settings/external-player-settings.js";
import "./styles.css";

declare const __ANISHELF_BUILD__: { buildInfo: BuildInfo; changelog: string };

registerPwa();

async function start() {
	const root = document.getElementById("root");
	if (!root) throw new Error("Missing root element.");
	const session = new ClientSessionLifecycle({
		name: "web",
		open: (path) => window.location.replace(path),
	});
	const onAuthRequired = () => session.onAuthRequired();
	const runtime = await initializeClient({
		...createCookieConnection({
			origin: window.location.origin,
			fetch: (path, init) => fetch(path, init),
			onAuthRequired,
		}),
		...__ANISHELF_BUILD__,
		onAuthRequired,
		platform: browserPlatform,
		navigate: (path) => session.navigate(path),
		restartSession: (path) => session.restart(path),
	});

	try {
		const router = createBrowserRouter(
			createClientRoutes({
				loginElement: <WebLoginPage />,
				externalPlayerSettings: <WebExternalPlayerSettings />,
			}),
		);
		if (
			session.attach(
				() => runtime.dispose(),
				router,
				() => runtime.queryClient.clear(),
			)
		)
			render(root, router);
	} catch (error) {
		runtime.dispose();
		throw error;
	}
}

function render(
	root: HTMLElement,
	router: ReturnType<typeof createBrowserRouter>,
) {
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
