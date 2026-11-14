import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactElement } from "react";
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
import { createLibraryRoute } from "./routes/library.js";

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
	externalPlayerSettings,
	serverSettings,
	showSecuritySettings,
}: {
	loginElement: ReactElement;
	externalPlayerSettings?: ReactElement;
	serverSettings?: ReactElement;
	showSecuritySettings?: boolean;
}): RouteObject[] {
	return [
		{ path: "/login", element: loginElement },
		authenticatedRoute(
			createLibraryRoute({
				externalPlayerSettings,
				serverSettings,
				showSecuritySettings,
			}),
		),
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
