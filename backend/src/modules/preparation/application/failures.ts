import {
	MediaOutputBudgetError,
	MediaToolError,
} from "../../../platform/media/index.js";
import { MediaProcessError } from "../../../platform/media/processing-process.js";
import { DomainError } from "../../../shared/errors.js";
import type { PreparationFailureReason } from "../domain/model.js";
import { PreparationProfileChangedError } from "./context.js";
export function preparationFailure(
	error: unknown,
	budgetFailure: PreparationFailureReason = "cache-full",
): PreparationFailureReason {
	if (error instanceof PreparationProfileChangedError) return "profile-changed";
	if (error instanceof MediaOutputBudgetError) return budgetFailure;
	if (error instanceof DomainError) {
		if (error.code === "PREPARATION_CACHE_FULL") return "cache-full";
		if (error.code === "PREPARATION_STORAGE_FULL") return "storage-full";
		if (
			[
				"PLAYBACK_CONFLICT",
				"RESOURCE_MISSING",
				"RESOURCE_NOT_FOUND",
				"RESOURCE_ROOT_UNAVAILABLE",
				"RESOURCE_ROOT_NOT_CONFIGURED",
				"RESOURCE_ACCESS_DENIED",
				"RESOURCE_UNREADABLE",
			].includes(error.code)
		)
			return "source-changed";
	}
	if (error instanceof MediaToolError) {
		if (error.code === "TOOL_UNAVAILABLE") return "tool-unavailable";
		if (error.code === "CAPABILITY_MISSING") return "capability-missing";
		if (error.code === "CAPABILITY_UNKNOWN") return "capability-unknown";
	}
	if (error instanceof Error && "code" in error && error.code === "ENOSPC")
		return "storage-full";
	// FFmpeg only exposes this OS failure through its bounded diagnostic.
	if (
		error instanceof MediaProcessError &&
		/No space left on device/i.test(error.diagnostic ?? "")
	)
		return "storage-full";
	return "processing-failed";
}
