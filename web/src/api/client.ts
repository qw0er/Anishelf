import { subtitleFormats } from "@anishelf/backend/public/subtitles";
import { defaultLanguage } from "../config/interaction-policy.js";
import type {
	ApiErrorResponse,
	ClientConfigResponse,
	ContinueWatchingResponse,
	DirectoryResponse,
	FileResponse,
	LibraryResponse,
	PlaybackSessionResponse,
	ResourceId,
	SavePlaybackProgressRequest,
	SavePlaybackProgressResponse,
	ScanResponse,
	SettingsResponse,
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
	UpdateSettingsRequest,
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
	keepalive?: boolean;
}

/** Cancellation remains separate from errors a view should display. */
export function isRequestCancelled(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
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

/** Uses same-origin /api URLs through the Vite proxy or production server. */
async function request<T>(
	path: string,
	method: "GET" | "POST" | "PUT" | "DELETE",
	{ signal, keepalive }: RequestOptions = {},
	payload?: object,
): Promise<T> {
	throwIfCancelled(signal);
	let response: Response;
	try {
		response = await fetch(path, {
			method,
			headers: {
				Accept: "application/json",
				...(payload ? { "Content-Type": "application/json" } : {}),
			},
			...(payload ? { body: JSON.stringify(payload) } : {}),
			credentials: "same-origin",
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

export async function getClientConfig(
	options?: RequestOptions,
): Promise<ClientConfigResponse> {
	const value = await request<ClientConfigResponse>(
		"/api/client-config",
		"GET",
		options,
	);
	const positive = (n: unknown) =>
		typeof n === "number" && Number.isSafeInteger(n) && n > 0;
	if (
		value?.defaultLanguage !== defaultLanguage ||
		!value.library ||
		!Number.isSafeInteger(value.library.defaultScanIntervalMinutes) ||
		value.library.defaultScanIntervalMinutes < 0 ||
		!positive(value.library.maximumScanIntervalMinutes) ||
		value.library.defaultScanIntervalMinutes >
			value.library.maximumScanIntervalMinutes ||
		!value.playback ||
		!positive(value.playback.progressSaveIntervalMs) ||
		!positive(value.playback.requestTimeoutMs) ||
		!value.subtitles ||
		!positive(value.subtitles.maximumBytes) ||
		!positive(value.subtitles.initializationTimeoutMs) ||
		!positive(value.subtitles.memoryMaximumBytes) ||
		!Array.isArray(value.subtitles.formats) ||
		!value.subtitles.formats.every((format) =>
			subtitleFormats.includes(format),
		) ||
		!value.media ||
		!value.media.videoMimeTypes ||
		Array.isArray(value.media.videoMimeTypes) ||
		typeof value.media.videoMimeTypes !== "object" ||
		!Object.values(value.media.videoMimeTypes).every(
			(mime) => typeof mime === "string",
		)
	)
		throw new ApiClientError({
			kind: "invalid_response",
			message: "The server returned invalid client configuration. Retry.",
		});
	return value;
}

export function getLibrary(options?: RequestOptions): Promise<LibraryResponse> {
	return request<LibraryResponse>("/api/library", "GET", options);
}

export function getSettings(
	options?: RequestOptions,
): Promise<SettingsResponse> {
	return request<SettingsResponse>("/api/settings", "GET", options);
}

export function saveSettings(
	settings: UpdateSettingsRequest,
	options?: RequestOptions,
): Promise<SettingsResponse> {
	return request<SettingsResponse>("/api/settings", "PUT", options, settings);
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

export function getFile(
	id: ResourceId,
	options?: RequestOptions,
): Promise<FileResponse> {
	return request<FileResponse>(
		`/api/files/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}

export function openPlaybackSession(
	fileId: ResourceId,
	options?: RequestOptions,
): Promise<PlaybackSessionResponse> {
	return request("/api/playback/sessions", "POST", options, { fileId });
}
export function savePlaybackProgress(
	token: string,
	progress: SavePlaybackProgressRequest,
	options?: RequestOptions,
): Promise<SavePlaybackProgressResponse> {
	return request(
		`/api/playback/sessions/${encodeURIComponent(token)}/progress`,
		"PUT",
		options,
		progress,
	);
}
export function releasePlaybackSession(
	token: string,
	options?: RequestOptions,
): Promise<void> {
	return request(
		`/api/playback/sessions/${encodeURIComponent(token)}`,
		"DELETE",
		options,
	);
}

export function getHistory(
	options?: RequestOptions,
): Promise<ContinueWatchingResponse> {
	return request("/api/history", "GET", options);
}

export function getSubtitles(
	id: ResourceId,
	options?: RequestOptions,
): Promise<SubtitleDiscoveryResponse> {
	return request(
		`/api/files/${encodeURIComponent(id)}/subtitles`,
		"GET",
		options,
	);
}
/** Same-origin, version-checked text URL consumed directly by Vidstack. */
export function subtitleContentUrl(
	id: ResourceId,
	trackId: string,
	sourceVersion: string,
	subtitleVersion: string,
): string {
	const query = new URLSearchParams({ sourceVersion, subtitleVersion });
	return `/api/files/${encodeURIComponent(id)}/subtitles/${encodeURIComponent(trackId)}/content?${query}`;
}

export function prepareSubtitle(
	fileId: string,
	trackId: string,
	sourceVersion: string,
	options?: RequestOptions,
): Promise<SubtitlePreparationResponse> {
	return request(
		`/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(trackId)}/prepare`,
		"POST",
		options,
		{ sourceVersion },
	);
}
export function getSubtitlePreparation(
	id: string,
	options?: RequestOptions,
): Promise<SubtitlePreparationResponse> {
	return request(
		`/api/subtitle-assets/${encodeURIComponent(id)}/status`,
		"GET",
		options,
	);
}
