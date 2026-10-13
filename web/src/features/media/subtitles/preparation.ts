import { type QueryClient, QueryObserver } from "@tanstack/react-query";
import type { SubtitlePreparationResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { queryClient } from "../../../shared/api/query-client.js";
import { getSubtitlePreparation, prepareSubtitle } from "./api.js";
import { SubtitlePreparationError } from "./errors.js";
import { waitForFonts } from "./fonts.js";
import { subtitlesInteractionPolicy } from "./policy.js";

/** Only the selected pending track has an observer. Leaving does not cancel the server job. */
export async function prepareSelectedSubtitle(
	fileId: string,
	trackId: string,
	sourceVersion: string,
	subtitleVersion: string,
	signal: AbortSignal,
	client: QueryClient = queryClient,
): Promise<SubtitlePreparationResponse> {
	signal.throwIfAborted();
	const result = await client
		.getMutationCache()
		.build(client, {
			mutationFn: () =>
				prepareSubtitle(fileId, trackId, sourceVersion, subtitleVersion, {
					signal: boundedSignal(signal),
				}),
			retry: false,
		})
		.execute(undefined);
	signal.throwIfAborted();
	const queryKey = [
		"subtitle-preparation",
		fileId,
		sourceVersion,
		trackId,
		subtitleVersion,
	];
	client.setQueryData(queryKey, result);
	const completed =
		result.status === "pending"
			? await new Promise<SubtitlePreparationResponse>((resolve, reject) => {
					if (!result.statusUrl) {
						reject(new SubtitlePreparationError());
						return;
					}
					const observer = new QueryObserver(client, {
						queryKey,
						queryFn: ({ signal }) =>
							getSubtitlePreparation(result.statusUrl as string, {
								signal: boundedSignal(signal),
							}),
						staleTime: 0,
						retry: false,
						refetchInterval: (query) =>
							query.state.data?.status === "pending"
								? subtitlesInteractionPolicy.subtitlePollIntervalMs
								: false,
					});
					const finish = () => {
						observer.destroy();
						signal.removeEventListener("abort", abort);
					};
					const abort = () => {
						finish();
						reject(signal.reason);
					};
					signal.addEventListener("abort", abort, { once: true });
					observer.subscribe((value) => {
						if (value.error) {
							finish();
							reject(value.error);
						} else if (value.data && value.data.status !== "pending") {
							finish();
							resolve(value.data);
						}
					});
					if (signal.aborted) abort();
				})
			: result;
	if (completed.status === "failed" || !completed.contentUrl)
		throw new SubtitlePreparationError(
			completed.errorCode ?? "SUBTITLE_EXTRACTION_FAILED",
		);
	const fonts = completed.fonts ?? result.fonts;
	return fonts
		? { ...completed, fonts: await waitForFonts(fonts, signal) }
		: completed;
}
