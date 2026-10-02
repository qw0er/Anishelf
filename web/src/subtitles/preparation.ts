import { getSubtitlePreparation, prepareSubtitle } from "../api/client.js";
import type { SubtitlePreparationResponse } from "../api/contracts.js";

function wait(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const stop = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
			reject(new DOMException("Cancelled", "AbortError"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, 500);
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) stop();
	});
}
/** Poll only a selected pending track; cancellation leaves reusable server work intact. */
export async function prepareSelectedSubtitle(
	fileId: string,
	trackId: string,
	sourceVersion: string,
	signal: AbortSignal,
): Promise<SubtitlePreparationResponse> {
	let result = await prepareSubtitle(fileId, trackId, sourceVersion, {
		signal,
	});
	while (result.status === "pending") {
		await wait(signal);
		result = await getSubtitlePreparation(result.id, { signal });
	}
	if (result.status === "failed")
		throw new Error(result.errorCode ?? "SUBTITLE_EXTRACTION_FAILED");
	if (!result.contentUrl) throw new Error("SUBTITLE_EXTRACTION_FAILED");
	return result;
}
