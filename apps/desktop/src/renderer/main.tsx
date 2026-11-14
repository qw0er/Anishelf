import {
	ClientApp,
	ClientSessionLifecycle,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter } from "react-router";
import { DesktopLoginPage } from "./auth/login-page.js";
import { createDesktopPlatform } from "./platform/platform.js";
import { createDesktopServerClient } from "./server/connection.js";
import { DesktopExternalPlayerSettings } from "./settings/external-player-settings.js";
import "./styles.css";

declare const __ANISHELF_BUILD__: { buildInfo: BuildInfo; changelog: string };

const mount = document.getElementById("app");
if (!mount) throw new Error("Desktop mount point is missing.");
const root = createRoot(mount);

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", dark);
document.documentElement.style.colorScheme = dark ? "dark" : "light";

async function start() {
	const desktop = window.desktop;
	if (!desktop) throw new Error("Open Anishelf in Electron.");

	const session = new ClientSessionLifecycle({
		name: "desktop",
		open(path) {
			window.history.replaceState(null, "", `#${path}`);
			window.location.reload();
		},
	});
	const onAuthRequired = () => session.onAuthRequired();
	const client = await createDesktopServerClient(desktop, onAuthRequired);
	const platform = await createDesktopPlatform(desktop);
	const { origin } = client.connection;
	const runtime = await initializeClient({
		...client,
		platform,
		...__ANISHELF_BUILD__,
		onAuthRequired,
		navigate: (path) => session.navigate(path),
		restartSession: (path) => session.restart(path),
		serverConnectionPath: "/login",
	});
	try {
		const router = createHashRouter(
			createClientRoutes({
				externalPlayerSettings: (
					<DesktopExternalPlayerSettings
						chooseExecutable={desktop.choosePlayerExecutable}
					/>
				),
				loginElement: (
					<DesktopLoginPage
						origin={origin}
						signIn={(address, password) =>
							client.authentication.signInTo(address, password)
						}
						restart={(path) => session.restart(path)}
					/>
				),
			}),
		);
		if (!session.attach(() => runtime.dispose(), router)) return;
		render(router);
	} catch (error) {
		runtime.dispose();
		throw error;
	}
}

function render(router: ReturnType<typeof createHashRouter>) {
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
