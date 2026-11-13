import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { authenticatedRoute } from "./app/auth/guard.js";
import { LoginPage } from "./app/auth/login-page.js";
import { webConnection } from "./shared/api/connection.js";
import { queryClient } from "./shared/api/query-client.js";
import "./index.css";
import { Toaster } from "./shared/components/ui/toast.js";
import "./shared/i18n.js";
import { libraryRoute } from "./app/routes/library.js";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
	const wasControlled = Boolean(navigator.serviceWorker.controller);
	if (wasControlled) {
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			console.info("Updated service worker activated; reloading the page.");
			window.location.reload();
		});
	}
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").then(
			(registration) => {
				console.info("Service worker registered.");
				const checkForUpdate = () => {
					if (document.visibilityState === "visible") {
						registration
							.update()
							.catch((error) =>
								console.warn("Service worker update check failed:", error),
							);
					}
				};
				checkForUpdate();
				document.addEventListener("visibilitychange", checkForUpdate);
			},
			(error) => console.error("Service worker registration failed:", error),
		);
	});
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");
const router = createBrowserRouter([
	{ path: "/login", element: <LoginPage /> },
	authenticatedRoute(libraryRoute),
]);
let redirectingToLogin = false;
window.addEventListener("anishelf:auth-required", () => {
	if (window.location.pathname === "/login") {
		queryClient.clear();
		return;
	}
	if (redirectingToLogin) return;
	redirectingToLogin = true;
	webConnection.dispose();
	window.location.replace(
		`/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
	);
});

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
		<Toaster />
	</StrictMode>,
);
