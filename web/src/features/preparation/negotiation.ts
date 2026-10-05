import { checkMediaCompatibility, getPreparation } from "../../api/client.js";
import type {
	CompatibilityCheckRequest,
	PreparationTaskResponse,
} from "../../api/contracts.js";
import { queryCapabilities } from "../../lib/media-capabilities.js";
import { inspectBrowserMedia } from "../../lib/media-compatibility.js";

/** Retry and reuse always obtain fresh, source/profile-bound browser evidence. */
export async function negotiatePreparation(
	fileId: string,
	profileId: string,
	signal: AbortSignal,
	sourceVersion?: string,
): Promise<CompatibilityCheckRequest> {
	const output = { profileId, target: "file" as const };
	const description = await inspectBrowserMedia(
		{ fileId, output, ...(sourceVersion ? { sourceVersion } : {}) },
		signal,
	);
	const evidence = await queryCapabilities(description.queries, signal, true);
	return {
		sourceVersion: description.sourceVersion,
		descriptionId: description.descriptionId,
		output,
		evidence,
	};
}

export async function verifyPreparedPlayback(
	task: PreparationTaskResponse,
	signal: AbortSignal,
): Promise<PreparationTaskResponse> {
	const body = await negotiatePreparation(
		task.fileId,
		task.profileId,
		signal,
		task.sourceVersion,
	);
	const result = await checkMediaCompatibility(
		{ fileId: task.fileId, ...body },
		{ signal },
	);
	const combination = {
		remux: "copy-copy",
		"transcode-audio": "copy-encode",
		"transcode-video": "encode-copy",
		transcode: "encode-encode",
	} as const;
	if (result.output?.combinations[combination[task.mode]] !== "supported")
		throw new Error("Prepared playback is not confirmed by this browser");
	const current = await getPreparation(task.id, { signal });
	if (
		current.fileId !== task.fileId ||
		current.sourceVersion !== task.sourceVersion ||
		current.artifactId !== task.artifactId ||
		current.status !== "ready" ||
		!current.playbackUrl
	)
		throw new Error("Prepared copy unavailable");
	return current;
}
