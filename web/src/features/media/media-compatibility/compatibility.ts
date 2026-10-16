import { ApiClientError } from "../../../shared/api/client.js";
import type {
	CompatibilityResult,
	FileDto,
} from "../../../shared/api/contracts.js";
import { checkMediaCompatibility, inspectMediaCompatibility } from "./api.js";
import { queryCapabilities } from "./capabilities.js";
import { mediacompatibilityInteractionPolicy } from "./policy.js";

export function originalCompatibilityKey(file: FileDto, scope: string): string {
	return JSON.stringify([scope, file.id, file.modifiedAt, file.sizeBytes]);
}

/** A cancelled folder may leave a shared server probe finishing; retry only bounded unavailable responses. */
export async function inspectBrowserMedia(
	input: Parameters<typeof inspectMediaCompatibility>[0],
	signal: AbortSignal,
) {
	for (let attempt = 0; ; attempt++) {
		signal.throwIfAborted();
		try {
			return await inspectMediaCompatibility(input, { signal });
		} catch (error) {
			if (
				!(error instanceof ApiClientError) ||
				error.code !== "MEDIA_INSPECTION_UNAVAILABLE" ||
				error.status !== 503 ||
				attempt >= mediacompatibilityInteractionPolicy.compatibilityBusyRetries
			)
				throw error;
			await new Promise<void>((resolve, reject) => {
				const abort = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					reject(signal.reason);
				};
				const timer = setTimeout(
					() => {
						signal.removeEventListener("abort", abort);
						resolve();
					},
					mediacompatibilityInteractionPolicy.compatibilityBusyRetryDelayMs *
						(attempt + 1),
				);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			});
		}
	}
}
/** Pure negotiation; Query owns completed results, cancellation and deduplication. */
export async function checkOriginalMedia(
	fileId: string,
	signal: AbortSignal,
	options: { sourceVersion?: string; cacheKey?: string; fresh?: boolean } = {},
): Promise<CompatibilityResult> {
	const description = await inspectBrowserMedia(
		{
			fileId,
			...(options.sourceVersion
				? { sourceVersion: options.sourceVersion }
				: {}),
		},
		signal,
	);
	if (
		options.sourceVersion &&
		description.sourceVersion !== options.sourceVersion
	)
		throw new ApiClientError({
			kind: "http",
			status: 409,
			code: "PLAYBACK_CONFLICT",
			message: "The source changed. Reopen playback.",
		});
	const evidence = await queryCapabilities(
		description.queries,
		signal,
		options.fresh,
	);
	const result = await checkMediaCompatibility(
		{
			fileId,
			sourceVersion: description.sourceVersion,
			descriptionId: description.descriptionId,
			output: null,
			evidence,
		},
		{ signal },
	);
	signal.throwIfAborted();
	if (options.sourceVersion && result.sourceVersion !== options.sourceVersion)
		throw new ApiClientError({
			kind: "http",
			status: 409,
			code: "PLAYBACK_CONFLICT",
			message: "The source changed. Reopen playback.",
		});
	return result;
}
