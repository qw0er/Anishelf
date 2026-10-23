import { ApiClientError } from "../api/client.js";

export function getErrorTranslationKey(error: unknown): string | undefined {
	if (!(error instanceof ApiClientError)) return undefined;
	if (error.kind === "network") return "errors.network";
	if (error.kind === "invalid_response") return "errors.invalidResponse";
	if (error.code) return `errors.api.${error.code}`;
	return "errors.requestFailed";
}

export function getScanWarningTranslationKey(message: string): string | null {
	if (
		message === "A directory could not be scanned; its contents were skipped."
	)
		return "scan.warningDirectory";
	if (message === "A video file could not be read and was skipped.")
		return "scan.warningFile";
	return null;
}
