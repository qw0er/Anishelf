export type ErrorCode =
	| "PLAYBACK_CONFLICT"
	| "PLAYBACK_UNAVAILABLE"
	| "PLAYBACK_PERSISTENCE_FAILED"
	| "CONFIG_INVALID"
	| "CONFIG_WRITE_FAILED"
	| "SETTINGS_BUSY"
	| "RESOURCE_ROOT_NOT_CONFIGURED"
	| "RESOURCE_ROOT_UNAVAILABLE"
	| "RESOURCE_NOT_FOUND"
	| "RESOURCE_MISSING"
	| "RESOURCE_UNREADABLE"
	| "RESOURCE_ACCESS_DENIED"
	| "SCAN_FAILED"
	| "INVALID_REQUEST"
	| "REQUEST_FORBIDDEN"
	| "ROUTE_NOT_FOUND"
	| "INTERNAL_ERROR";

/** Internal details/cause must never be serialized directly into API responses. */
export class DomainError extends Error {
	readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DomainError";
		this.code = code;
	}
}
