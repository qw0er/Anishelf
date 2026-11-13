import type { ApiErrorResponse } from "@anishelf/contracts/http";

type ApiClientErrorKind = "http" | "network" | "invalid_response";

/** Safe to display; HTTP diagnostics retain status, code, and request ID. */
export class ApiClientError extends Error {
	readonly kind: ApiClientErrorKind;
	readonly status: number | null;
	readonly code: string | null;
	readonly requestId: string | null;

	constructor(options: {
		kind: ApiClientErrorKind;
		message: string;
		status?: number;
		code?: string;
		requestId?: string | null;
		cause?: unknown;
	}) {
		super(options.message, { cause: options.cause });
		this.name = "ApiClientError";
		this.kind = options.kind;
		this.status = options.status ?? null;
		this.code = options.code ?? null;
		this.requestId = options.requestId ?? null;
	}
}

export interface RequestOptions {
	signal?: AbortSignal;
	keepalive?: boolean;
}

/** Cancellation remains separate from errors a view should display. */
export function isRequestCancelled(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw isRequestCancelled(signal.reason)
		? signal.reason
		: new DOMException("Request cancelled.", "AbortError");
}

type PublicApiError = {
	error: Omit<ApiErrorResponse["error"], "code"> & { code: string };
};

function isApiError(value: unknown): value is PublicApiError {
	if (typeof value !== "object" || value === null || !("error" in value))
		return false;
	const error = value.error;
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		"message" in error &&
		typeof error.message === "string" &&
		"requestId" in error &&
		typeof error.requestId === "string"
	);
}

export interface ApiRequestPolicy {
	credentials?: RequestCredentials;
	headers?: (
		method: string,
	) => Promise<Record<string, string>> | Record<string, string> | undefined;
	onUnauthorized?: (path: string) => void;
}

/** Sends JSON requests using the transport and credential policy supplied by the host. */
export function createApiClient({
	fetch: fetcher,
	policy,
	signal: lifetime,
}: {
	fetch: (path: string, init: RequestInit) => Promise<Response>;
	policy?: ApiRequestPolicy;
	signal?: AbortSignal;
}) {
	async function request<T>(
		path: string,
		method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
		{ signal: callerSignal, keepalive }: RequestOptions = {},
		payload?: object,
	): Promise<T> {
		const signal =
			lifetime && callerSignal
				? AbortSignal.any([lifetime, callerSignal])
				: (lifetime ?? callerSignal);
		throwIfCancelled(signal);
		const headers = policy?.headers?.(method);
		const authHeaders = headers instanceof Promise ? await headers : headers;
		throwIfCancelled(signal);
		let response: Response;
		try {
			response = await fetcher(path, {
				method,
				headers: {
					Accept: "application/json",
					...authHeaders,
					...(payload ? { "Content-Type": "application/json" } : {}),
				},
				...(payload ? { body: JSON.stringify(payload) } : {}),
				credentials: policy?.credentials ?? "omit",
				cache: "no-store",
				...(signal ? { signal } : {}),
				...(keepalive ? { keepalive: true } : {}),
			});
		} catch (cause) {
			throwIfCancelled(signal);
			if (isRequestCancelled(cause)) throw cause;
			throw new ApiClientError({
				kind: "network",
				message:
					"Cannot connect to the server. Check your connection and try again.",
				cause,
			});
		}
		throwIfCancelled(signal);
		if (response.status === 401) policy?.onUnauthorized?.(path);
		if (response.ok && response.status === 204) return undefined as T;
		const requestId = response.headers.get("x-request-id");
		let body: unknown;
		try {
			body = await response.json();
		} catch (cause) {
			throwIfCancelled(signal);
			if (isRequestCancelled(cause)) throw cause;
			throw new ApiClientError({
				kind: response.ok ? "invalid_response" : "http",
				message: response.ok
					? "The server returned an invalid response. Please try again."
					: `Request failed (HTTP ${response.status}). Please try again.`,
				status: response.status,
				requestId,
				cause,
			});
		}
		throwIfCancelled(signal);
		if (!response.ok) {
			if (isApiError(body))
				throw new ApiClientError({
					kind: "http",
					message: body.error.message,
					status: response.status,
					code: body.error.code,
					requestId: body.error.requestId || requestId,
				});
			throw new ApiClientError({
				kind: "http",
				message: `Request failed (HTTP ${response.status}). Please try again.`,
				status: response.status,
				requestId,
			});
		}
		return body as T;
	}

	return { request };
}
