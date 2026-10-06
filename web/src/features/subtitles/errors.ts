import { ApiClientError } from "../../api/client.js";
/** Preparation status codes never travel in Error.message. */
export class SubtitlePreparationError extends Error {
	readonly code: string;
	constructor(code: string = "SUBTITLE_EXTRACTION_FAILED") {
		super("Subtitle preparation failed.");
		this.name = "SubtitlePreparationError";
		this.code = code;
	}
}
export function subtitleErrorCode(error: unknown): string {
	if (error instanceof SubtitlePreparationError) return error.code;
	if (error instanceof ApiClientError && error.code) return error.code;
	return "SUBTITLE_EXTRACTION_FAILED";
}
