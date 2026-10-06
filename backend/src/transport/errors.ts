import type { ApiErrorResponse } from "../contracts/http.js";
import { DomainError, type ErrorCode } from "../shared/errors.js";

const domainErrors: Record<ErrorCode, { status: number; message: string }> = {
	MEDIA_PLANNING_UNAVAILABLE: {
		status: 503,
		message: "Media planning is unavailable. Retry shortly.",
	},
	PREPARATION_UNAVAILABLE: {
		status: 503,
		message: "Media preparation is unavailable.",
	},
	PREPARATION_BUSY: {
		status: 409,
		message:
			"The preparation queue is full or the prepared media is in use. Retry shortly.",
	},
	PREPARATION_CACHE_FULL: {
		status: 507,
		message:
			"The prepared media cache is full. Delete a prepared copy and retry.",
	},
	PREPARATION_STORAGE_FULL: {
		status: 507,
		message: "Insufficient disk storage for media preparation.",
	},
	MEDIA_INSPECTION_UNAVAILABLE: {
		status: 503,
		message: "Media inspection is unavailable or busy. Retry shortly.",
	},
	SUBTITLE_UNSUPPORTED: {
		status: 422,
		message: "This subtitle track is not supported.",
	},
	SUBTITLE_PREPARATION_UNAVAILABLE: {
		status: 503,
		message: "Subtitle preparation is unavailable.",
	},
	SUBTITLE_PREPARATION_BUSY: {
		status: 503,
		message: "Another subtitle is being prepared. Retry shortly.",
	},
	SUBTITLE_TOO_LARGE: {
		status: 413,
		message: "The subtitle exceeds the configured size limit.",
	},
	SUBTITLE_INVALID_ENCODING: {
		status: 422,
		message: "Save the subtitle as UTF-8 or UTF-16 with a byte-order mark.",
	},
	PLAYBACK_CONFLICT: {
		status: 409,
		message: "The playback session or source changed. Reopen playback.",
	},
	PLAYBACK_UNAVAILABLE: {
		status: 503,
		message: "Playback persistence is unavailable.",
	},
	PLAYBACK_PERSISTENCE_FAILED: {
		status: 500,
		message: "Playback progress could not be loaded or saved. Retry.",
	},
	CONFIG_INVALID: {
		status: 400,
		message:
			"Use an absolute resource directory separate from the application data directory.",
	},
	CONFIG_WRITE_FAILED: { status: 500, message: "Settings could not be saved." },
	SETTINGS_BUSY: {
		status: 409,
		message:
			"Wait for the current scan or settings save to finish and try again.",
	},
	RESOURCE_ROOT_NOT_CONFIGURED: {
		status: 409,
		message: "Set a resource directory before scanning the library.",
	},
	RESOURCE_ROOT_UNAVAILABLE: {
		status: 503,
		message: "The resource directory is unavailable.",
	},
	RESOURCE_NOT_FOUND: { status: 404, message: "The resource was not found." },
	RESOURCE_MISSING: {
		status: 404,
		message: "This file is no longer available. Scan the library again.",
	},
	RESOURCE_UNREADABLE: {
		status: 403,
		message: "The resource is not readable.",
	},
	RESOURCE_ACCESS_DENIED: {
		status: 403,
		message: "Access to this resource is denied.",
	},
	SCAN_FAILED: { status: 500, message: "The library scan failed." },
	INVALID_REQUEST: { status: 400, message: "The request is invalid." },
	REQUEST_FORBIDDEN: { status: 403, message: "This request is not allowed." },
	ROUTE_NOT_FOUND: {
		status: 404,
		message: "The requested endpoint was not found.",
	},
	INTERNAL_ERROR: {
		status: 500,
		message: "An unexpected server error occurred.",
	},
};

export function apiError(code: ErrorCode, requestId: string): ApiErrorResponse {
	return { error: { code, message: domainErrors[code].message, requestId } };
}

export function classifyHttpError(error: unknown): {
	code: ErrorCode;
	status: number;
} {
	if (error instanceof DomainError)
		return { code: error.code, status: domainErrors[error.code].status };
	const status =
		typeof error === "object" && error !== null && "statusCode" in error
			? error.statusCode
			: undefined;
	if (typeof status === "number" && status >= 400 && status < 500) {
		return { code: "INVALID_REQUEST", status };
	}
	return { code: "INTERNAL_ERROR", status: 500 };
}
