import {
	ApiClientError,
	checkMediaCompatibility,
	inspectMediaCompatibility,
} from "../api/client.js";
import type { CompatibilityResult, FileDto } from "../api/contracts.js";
import { queryClient } from "../api/query-client.js";
import { interactionPolicy } from "../config/interaction-policy.js";
import { queryCapabilities } from "./media-capabilities.js";

export function originalCompatibilityKey(file: FileDto, scope: string): string {
	return JSON.stringify([scope, file.id, file.modifiedAt, file.sizeBytes]);
}
export function clearOriginalCompatibilityCache(): void {
	queryClient.removeQueries({ queryKey: ["compatibility"] });
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
				attempt >= interactionPolicy.compatibilityBusyRetries
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
					interactionPolicy.compatibilityBusyRetryDelayMs * (attempt + 1),
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
		throw new Error("The source changed. Reopen playback.");
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
	return result;
}
