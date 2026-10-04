export class MediaToolError extends Error {
	constructor(
		readonly code:
			| "TOOL_UNAVAILABLE"
			| "TOOL_FAILED"
			| "INVALID_MEDIA"
			| "INVALID_INPUT"
			| "UNSUPPORTED_SUBTITLE"
			| "UNSUPPORTED_PROCESSING"
			| "CAPABILITY_MISSING"
			| "CAPABILITY_UNKNOWN",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "MediaToolError";
	}
}
