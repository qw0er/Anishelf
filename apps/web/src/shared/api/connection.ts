import { createServerConnection } from "@anishelf/client-core/connection";
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: false,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
			mutations: { retry: false },
		},
	});
}

export function createWebConnection(
	origin: string,
	transport: typeof fetch,
	onAuthRequired?: () => void,
) {
	const connection = createServerConnection({
		origin,
		fetch: transport,
		sameOrigin: true,
		...(onAuthRequired ? { onAuthRequired } : {}),
	});
	const queryClient = createQueryClient();
	return {
		...connection,
		queryClient,
		dispose() {
			if (connection.signal.aborted) return;
			connection.dispose();
			queryClient.clear();
			console.debug("connection.disposed");
		},
	};
}

export const webConnection = createWebConnection(
	typeof window === "undefined" ? "http://localhost" : window.location.origin,
	(path, init) => fetch(path, init),
	() => {
		if (typeof window === "undefined") return;
		console.debug("auth.session_required");
		window.dispatchEvent(new Event("anishelf:auth-required"));
	},
);
