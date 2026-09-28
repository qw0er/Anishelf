export type ErrorCode =
	| "CONFIG_INVALID"
	| "CONFIG_WRITE_FAILED"
	| "RESOURCE_ROOT_UNAVAILABLE"
	| "RESOURCE_NOT_FOUND"
	| "RESOURCE_MISSING"
	| "RESOURCE_UNREADABLE"
	| "RESOURCE_ACCESS_DENIED"
	| "SCAN_FAILED"
	| "INVALID_REQUEST"
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
