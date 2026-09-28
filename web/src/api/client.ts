import type {
	ApiErrorResponse,
	DirectoryResponse,
	LibraryResponse,
	ResourceId,
	ScanResponse,
} from "./contracts.js";

export type ApiClientErrorKind = "http" | "network" | "invalid_response";

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
}

/** Cancellation remains separate from errors a view should display. */
export function isRequestCancelled(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw isRequestCancelled(signal.reason)
		? signal.reason
		: new DOMException("请求已取消。", "AbortError");
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

/** Uses same-origin /api URLs through the Vite proxy or production server. */
async function request<T>(
	path: string,
	method: "GET" | "POST",
	{ signal }: RequestOptions = {},
): Promise<T> {
	throwIfCancelled(signal);
	let response: Response;
	try {
		response = await fetch(path, {
			method,
			headers: { Accept: "application/json" },
			credentials: "same-origin",
			cache: "no-store",
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		throwIfCancelled(signal);
		if (isRequestCancelled(cause)) throw cause;
		throw new ApiClientError({
			kind: "network",
			message: "无法连接服务器，请检查网络后重试。",
			cause,
		});
	}
	throwIfCancelled(signal);
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
				? "服务器返回的数据无法解析，请重试。"
				: `请求失败（HTTP ${response.status}），请重试。`,
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
			message: `请求失败（HTTP ${response.status}），请重试。`,
			status: response.status,
			requestId,
		});
	}
	return body as T;
}

export function getLibrary(options?: RequestOptions): Promise<LibraryResponse> {
	return request<LibraryResponse>("/api/library", "GET", options);
}

export function startScan(options?: RequestOptions): Promise<ScanResponse> {
	return request<ScanResponse>("/api/library/scan", "POST", options);
}

export function getDirectory(
	id: ResourceId,
	options?: RequestOptions,
): Promise<DirectoryResponse> {
	return request<DirectoryResponse>(
		`/api/directories/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}
