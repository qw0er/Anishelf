import type { createServerConnection } from "@anishelf/client-core/connection";
import type { BuildInfo } from "@anishelf/contracts/http";
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

interface ClientHost {
	connection: ReturnType<typeof createServerConnection>;
	buildInfo: BuildInfo;
	changelog: string;
	onAuthRequired: () => void;
	replaceLocation: (path: string) => void;
}

export function createClientRuntime(host: ClientHost) {
	const queryClient = createQueryClient();
	return {
		...host,
		queryClient,
		dispose() {
			if (host.connection.signal.aborted) return;
			host.connection.dispose();
			queryClient.clear();
			console.debug("connection.disposed");
		},
	};
}

let runtime: ReturnType<typeof createClientRuntime> | undefined;

export function configureClientRuntime(host: ClientHost) {
	if (runtime && !runtime.connection.signal.aborted)
		throw new Error("A client connection is already active.");
	runtime = createClientRuntime(host);
	return runtime;
}

export function getClientRuntime() {
	if (!runtime)
		throw new Error("Configure the client runtime before using it.");
	return runtime;
}

export type { ClientHost };
