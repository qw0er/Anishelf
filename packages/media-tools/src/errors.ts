export type MediaToolErrorCode =
	| "CONFIG_INVALID"
	| "TOOL_UNAVAILABLE"
	| "TOOL_FAILED"
	| "INVALID_MEDIA"
	| "INVALID_INPUT"
	| "UNSUPPORTED_SUBTITLE"
	| "UNSUPPORTED_PROCESSING"
	| "CAPABILITY_MISSING"
	| "CAPABILITY_UNKNOWN";

export class MediaToolError extends Error {
	readonly code: MediaToolErrorCode;

	constructor(
		code: MediaToolErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "MediaToolError";
		this.code = code;
	}
}

export class MediaOutputBudgetError extends MediaToolError {
	constructor() {
		super("TOOL_FAILED", "Media output exceeds the execution budget.");
	}
}
