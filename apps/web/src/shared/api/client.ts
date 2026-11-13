import { createApiClient } from "@anishelf/client-core";

export {
	ApiClientError,
	isRequestCancelled,
	type RequestOptions,
} from "@anishelf/client-core";

// Relative API paths use the Vite proxy or the production server.
export const { request, loadAuthSession, clearAuthToken } = createApiClient({
	fetch: (path, init) => fetch(path, init),
	onAuthRequired: () => {
		if (typeof window === "undefined") return;
		console.debug("auth.session_required");
		window.dispatchEvent(new Event("anishelf:auth-required"));
	},
});
