import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import {
	type ClientHost,
	configureClientRuntime,
	getClientRuntime,
} from "../shared/api/connection.js";
import { Toaster } from "../shared/components/ui/toast.js";
import { initializeLanguage } from "../shared/i18n.js";
import { authenticatedRoute } from "./auth/guard.js";
import { LoginPage } from "./auth/login-page.js";
import { libraryRoute } from "./routes/library.js";

export async function initializeClient(host: ClientHost) {
	const runtime = configureClientRuntime(host);
	try {
		await initializeLanguage(host.platform);
		return runtime;
	} catch (error) {
		runtime.dispose();
		throw error;
	}
}

export type { ClientPlatform } from "../shared/platform.js";
export { ClientSessionLifecycle } from "./session-lifecycle.js";

export function createClientRoutes(): RouteObject[] {
	return [
		{ path: "/login", element: <LoginPage /> },
		authenticatedRoute(libraryRoute),
	];
}

export function ClientApp({
	router,
}: Pick<ComponentProps<typeof RouterProvider>, "router">) {
	return (
		<QueryClientProvider client={getClientRuntime().queryClient}>
			<RouterProvider router={router} />
			<Toaster />
		</QueryClientProvider>
	);
}
