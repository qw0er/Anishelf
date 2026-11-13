import { createApiClient, throwIfCancelled } from "./api-client.ts";

function httpUrl(value: string, base?: string): URL | null {
	try {
		const url = new URL(value, base);
		return (url.protocol === "http:" || url.protocol === "https:") &&
			!url.username &&
			!url.password
			? url
			: null;
	} catch {
		return null;
	}
}

/** A server origin, its session state, and the lifetime of work started against it. */
export function createServerConnection({
	origin,
	fetch: transport,
	onAuthRequired,
	sameOrigin = false,
}: {
	origin: string;
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	onAuthRequired?: () => void;
	sameOrigin?: boolean;
}) {
	const server = httpUrl(origin);
	if (server?.pathname !== "/" || server.search || server.hash)
		throw new TypeError("Expected an HTTP(S) server origin.");
	const base = server.origin;
	const lifetime = new AbortController();
	const { signal } = lifetime;

	function resolveResourceUrl(value: string, absolute = !sameOrigin) {
		const url = httpUrl(value, base);
		if (
			(!value.startsWith("/") && !/^https?:\/\//i.test(value)) ||
			value.startsWith("//") ||
			value.includes("\\") ||
			!url ||
			url.origin !== base ||
			url.pathname.startsWith("//")
		)
			return null;
		return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
	}

	async function send(path: string, init: RequestInit) {
		const url = resolveResourceUrl(path);
		if (!url)
			throw new TypeError("Expected a resource on the configured server.");
		return transport(url, init);
	}

	const api = createApiClient({
		fetch: send,
		signal,
		...(onAuthRequired ? { onAuthRequired } : {}),
	});

	async function fetchResource(path: string, init: RequestInit = {}) {
		const requestSignal = init.signal
			? AbortSignal.any([signal, init.signal])
			: signal;
		throwIfCancelled(requestSignal);
		const response = await send(path, {
			credentials: "same-origin",
			...init,
			signal: requestSignal,
		});
		throwIfCancelled(requestSignal);
		return response;
	}

	return {
		origin: base,
		signal,
		api,
		resolveResourceUrl,
		fetchResource,
		dispose() {
			lifetime.abort();
			api.clearAuthToken();
		},
	};
}
