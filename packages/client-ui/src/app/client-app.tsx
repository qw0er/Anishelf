import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactElement } from "react";
import {
	Outlet,
	type RouteObject,
	ScrollRestoration,
	useParams,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import {
	OfflineCachePage,
	OfflineCachePlayer,
	OfflineCacheProvider,
} from "../features/playback/ui.js";
import {
	type ClientHost,
	configureClientRuntime,
	getClientRuntime,
} from "../shared/api/connection.js";
import { Toaster } from "../shared/components/ui/toast.js";
import { initializeLanguage } from "../shared/i18n.js";
import { initializeTheme } from "../shared/theme.js";
import { authenticatedRoute } from "./auth/guard.js";
import AppHeader from "./components/app-header.js";
import { FilesNavigation } from "./components/files-layout.js";
import { createLibraryRoute } from "./routes/library.js";
import { watchServerResume } from "./runtime/server-resume.js";

export async function initializeClient(host: ClientHost) {
	const runtime = configureClientRuntime(host);
	try {
		await initializeLanguage(host.platform);
		watchServerResume(runtime);
		initializeTheme(host.platform, runtime.connection.signal);
		return runtime;
	} catch (error) {
		runtime.dispose();
		throw error;
	}
}

export {
	ExternalPlayerSettings,
	maximumPlayerTemplateLength,
} from "../features/settings/ui.js";
export { Button, buttonStyles } from "../shared/components/ui/button.js";
export {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../shared/components/ui/card.js";
export { Checkbox } from "../shared/components/ui/checkbox.js";
export { Field, FieldError } from "../shared/components/ui/field.js";
export { FieldHelp } from "../shared/components/ui/field-help.js";
export { Input } from "../shared/components/ui/input.js";
export {
	NativeSelect,
	NativeSelectOption,
} from "../shared/components/ui/native-select.js";
export { Spinner } from "../shared/components/ui/spinner.js";
export { Textarea } from "../shared/components/ui/textarea.js";
export { toast } from "../shared/components/ui/toast.js";
export { Tooltip } from "../shared/components/ui/tooltip.js";
export type { ClientPlatform } from "../shared/platform.js";
export { PasswordSignInForm, SignInPanel } from "./auth/password-sign-in.js";
export { loginReturnPath } from "./auth/return-path.js";
export { ClientSessionLifecycle } from "./session-lifecycle.js";

export function createClientRoutes({
	loginElement,
	offlineCache = false,
	externalPlayerSettings,
	desktopSettings,
	showSecuritySettings,
}: {
	loginElement: ReactElement;
	offlineCache?: boolean;
	externalPlayerSettings?: ReactElement;
	desktopSettings?: ReactElement;
	showSecuritySettings?: boolean;
}): RouteObject[] {
	return [
		{ path: "/login", element: loginElement },
		...(offlineCache
			? [
					{
						path: offlineCachePath,
						element: <OfflineCacheShell />,
						children: [
							{ index: true as const, element: <OfflineCachePage /> },
							{ path: ":id", element: <OfflineCachePlayerRoute /> },
						],
					},
				]
			: []),
		authenticatedRoute(
			createLibraryRoute({
				offlineCache,
				externalPlayerSettings,
				desktopSettings,
				showSecuritySettings,
			}),
		),
	];
}

function OfflineCacheShell() {
	return (
		<div className="app-shell min-h-screen bg-background">
			<AppHeader />
			<ScrollRestoration
				getKey={(location) => `${location.pathname}${location.search}`}
			/>
			<main className="page-container page-content space-y-5">
				<FilesNavigation offlineCache />
				<Outlet />
			</main>
		</div>
	);
}

function OfflineCachePlayerRoute() {
	const { id } = useParams();
	return <OfflineCachePlayer key={id} />;
}

export function ClientApp({
	router,
}: Pick<ComponentProps<typeof RouterProvider>, "router">) {
	const runtime = getClientRuntime();
	const cache = runtime.platform.offlineCache;
	const body = (
		<QueryClientProvider client={runtime.queryClient}>
			<RouterProvider router={router} />
			<Toaster />
		</QueryClientProvider>
	);
	return cache ? (
		<OfflineCacheProvider cache={cache} navigate={runtime.navigate}>
			{body}
		</OfflineCacheProvider>
	) : (
		body
	);
}
