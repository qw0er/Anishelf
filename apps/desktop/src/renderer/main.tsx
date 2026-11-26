import {
	ClientApp,
	ClientSessionLifecycle,
	createClientRoutes,
	initializeClient,
} from "@anishelf/client-ui";
import type { BuildInfo } from "@anishelf/contracts/http";
import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter } from "react-router";
import type { DesktopMenuCommand } from "../ipc/desktop.js";
import { DesktopLoginPage } from "./auth/login-page.js";
import { syncDesktopLanguage } from "./desktop-language.js";
import { createDesktopPlatform } from "./platform/platform.js";
import { createDesktopServerClient } from "./server/connection.js";
import { DesktopExternalPlayerSettings } from "./settings/external-player-settings.js";
import { ServerConnectionSettings } from "./settings/server-connection-settings.js";
import { StartupSettings } from "./settings/startup-settings.js";
import { TraySettings } from "./settings/tray-settings.js";
import { syncWindowControlsTheme } from "./window-controls-theme.js";
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
	syncWindowControlsTheme(desktop);

	const session = new ClientSessionLifecycle({
		name: "desktop",
		open(path) {
			window.history.replaceState(null, "", `#${path}`);
			window.location.reload();
		},
	});
	const onAuthRequired = () => {
		const path = window.location.hash.slice(1).split("?", 1)[0];
		if (path !== offlineCachePath && !path?.startsWith(`${offlineCachePath}/`))
			session.onAuthRequired();
	};
	const client = await createDesktopServerClient(desktop, onAuthRequired);
	const platform = await createDesktopPlatform(desktop, {
		canChooseDirectories: client.server.kind === "local",
		cacheServer:
			client.server.kind === "local" ? "local" : client.server.origin,
	});
	const [closeToTray, launchAtLogin] = await Promise.all([
		desktop.getCloseToTray(),
		desktop.getLaunchAtLogin(),
	]);
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
	const stopLanguageSync = syncDesktopLanguage(desktop);
	let unsubscribeMenu: (() => void) | undefined;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		unsubscribeMenu?.();
		stopLanguageSync();
		runtime.dispose();
	};
	try {
		const router = createHashRouter(
			createClientRoutes({
				offlineCache: true,
				externalPlayerSettings: (
					<DesktopExternalPlayerSettings
						chooseExecutable={desktop.choosePlayerExecutable}
					/>
				),
				desktopSettings: (
					<>
						<ServerConnectionSettings
							server={client.server}
							signIn={(address, password) =>
								client.authentication.signInTo(address, password)
							}
							switchToLocal={desktop.useLocalBackend}
							restart={() => session.restart("/settings?section=desktop")}
						/>
						<StartupSettings
							status={launchAtLogin}
							save={desktop.setLaunchAtLogin}
						/>
						<TraySettings
							closeToTray={closeToTray}
							save={desktop.setCloseToTray}
						/>
					</>
				),
				showSecuritySettings: client.server.kind === "external",
				loginElement: (
					<DesktopLoginPage
						origin={origin}
						switchToLocal={
							client.server.kind === "external"
								? desktop.useLocalBackend
								: undefined
						}
						signIn={(address, password) =>
							client.authentication.signInTo(address, password)
						}
						restart={(path) => session.restart(path)}
					/>
				),
			}),
		);
		if (!session.attach(dispose, router)) {
			dispose();
			return;
		}
		unsubscribeMenu = desktop.onMenuCommand((command) =>
			handleMenuCommand(command, router, session),
		);
		render(router);
		void desktop
			.consumePendingMenuCommand()
			.then((command) => {
				if (command) handleMenuCommand(command, router, session);
			})
			.catch((error: unknown) => {
				console.warn("desktop.menu_pending_command_failed", { error });
			});
	} catch (error) {
		dispose();
		throw error;
	}
}

function handleMenuCommand(
	command: DesktopMenuCommand,
	router: ReturnType<typeof createHashRouter>,
	session: ClientSessionLifecycle,
) {
	if (command.kind === "navigate") {
		session.navigate(command.path);
		return;
	}
	if (command.kind === "checkForUpdates") {
		session.navigate(
			`/settings?section=about&checkUpdates=${encodeURIComponent(String(Date.now()))}`,
		);
		return;
	}
	void router.navigate(command.direction === "back" ? -1 : 1);
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
