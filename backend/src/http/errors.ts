import type { ApiErrorResponse } from "../contracts/api.js";
import { DomainError, type ErrorCode } from "../errors.js";

const domainErrors: Record<ErrorCode, { status: number; message: string }> = {
	CONFIG_INVALID: { status: 400, message: "Configuration is invalid." },
	CONFIG_WRITE_FAILED: { status: 500, message: "Settings could not be saved." },
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
