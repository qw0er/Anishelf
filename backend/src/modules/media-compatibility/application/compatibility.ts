import type { Logger } from "pino";
import { Check } from "typebox/value";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
} from "../../../contracts/http.js";
import { CompatibilityCheckRequestSchema } from "../../../contracts/schemas/compatibility.js";
import { TranscodeProfileSchema } from "../../../contracts/schemas/transcode-profiles.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";
import {
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../../media-inspection/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import { checkDirectCompatibility } from "../domain/direct.js";
import {
	aggregateCompatibility,
	compatibilityDecision,
	compatibilityStatus,
	validateCompatibilityEvidence,
} from "../domain/evidence.js";
import type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "../domain/model.js";
import { describeOriginalMedia } from "./description.js";
import { describeOutputCandidates } from "./output-description.js";

/** One source-bound browser negotiation workflow, with optional concrete output context. */
export class MediaCompatibilityApplication {
	constructor(
		private readonly options: {
			inspection: MediaInspectionApi;
			sources: ResourceAccessApi;
			profiles?: DeepReadonly<TranscodeProfile[]>;
			logger?: Logger;
		},
	) {}
	private async load(input: CompatibilityInspectInput) {
		let profile: DeepReadonly<TranscodeProfile> | null = null;
		if (input.output) {
			if (!["file", "media-source"].includes(input.output.target))
				throw new DomainError(
					"INVALID_REQUEST",
					"Invalid compatibility delivery target.",
				);
			const configured = this.options.profiles?.find(
				(profile) => profile.id === input.output?.profileId,
			);
			if (!configured || !Check(TranscodeProfileSchema, configured))
				throw new DomainError(
					"INVALID_REQUEST",
					"Selected output profile is unavailable or invalid.",
				);
			profile = freeze(structuredClone(configured));
		}
		let inspected: Awaited<ReturnType<MediaInspectionApi["inspect"]>>;
		try {
			inspected = await this.options.inspection.inspect(
				input.fileId,
				input.sourceVersion,
			);
		} catch (error) {
			if (
				error instanceof MediaInspectionBusyError ||
				error instanceof MediaToolError
			)
				throw new DomainError(
					"MEDIA_INSPECTION_UNAVAILABLE",
					"Media inspection could not be completed. Retry.",
					{ cause: error },
				);
			throw error;
		}
		const { source, info } = inspected;
		const original = describeOriginalMedia(
			input.fileId,
			source.identity.sourceVersion,
			info,
			input.audioStreamIndices,
		);
		const candidates =
			profile && input.output
				? describeOutputCandidates(original, profile, input.output.target)
				: { queries: original.queries, output: null };
		const description: CompatibilityInspection = {
			...original,
			...candidates,
			descriptionId: fingerprint({
				rulesVersion: "3",
				root: source.identity.canonicalRoot,
				rootEpoch: source.rootEpoch,
				fileId: input.fileId,
				sourceVersion: source.identity.sourceVersion,
				output: candidates.output,
				queries: candidates.queries,
				audioStreamIndices: input.audioStreamIndices,
			}),
		};
		return { source, original, profile, description };
	}
	async inspect(
		input: CompatibilityInspectInput,
	): Promise<CompatibilityInspection> {
		const { source, description } = await this.load(input);
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertRootEpoch(source.rootEpoch);
		return description;
	}
	async check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CheckedCompatibility>> {
		const { fileId, ...request } = input;
		if (!Check(CompatibilityCheckRequestSchema, request))
			throw new DomainError(
				"INVALID_REQUEST",
				"Invalid compatibility request.",
			);
		const { source, original, profile, description } = await this.load(input);
		if (input.descriptionId !== description.descriptionId)
			throw new DomainError(
				"INVALID_REQUEST",
				"Compatibility evidence is stale. Request a new description.",
			);
		validateCompatibilityEvidence(description.queries, input.evidence);
		const decision = (id: string) =>
			compatibilityDecision(description.queries, input.evidence, id);
		const status = (id: string) =>
			compatibilityStatus(description.queries, input.evidence, id);
		const tracks = original.audioTracks;
		const trackDecision = (track: (typeof tracks)[number]) =>
			decision(
				track.index === original.audio?.index
					? "original-audio"
					: `original-audio-${track.index}`,
			);
		const aggregateStatus = (prefix: string) =>
			aggregateCompatibility(
				description.queries
					.filter(
						(query) => query.id === prefix || query.id.startsWith(`${prefix}-`),
					)
					.map((query) => decision(query.id)),
			).status;
		const warnings: string[] = ["browser-report-is-not-playback-certification"];
		if (original.multipleTracks)
			warnings.push("native-track-selection-uncertain");
		if (original.video?.hdr) warnings.push("hdr-display-unverified");
		if (input.evidence.some((entry) => entry.smooth === false))
			warnings.push("playback-may-not-be-smooth");
		const checked: CheckedCompatibility = {
			fileId,
			sourceVersion: source.identity.sourceVersion,
			rulesVersion: "3",
			canonicalRoot: source.identity.canonicalRoot,
			profile,
			selectedVideo: original.video,
			selectedAudio: original.selectedAudioTracks?.[0] ?? null,
			selectedAudioTracks: original.selectedAudioTracks,
			audioTracks: tracks.map((stream) => ({
				stream,
				compatibility: trackDecision(stream),
			})),
			direct:
				input.audioStreamIndices !== undefined
					? {
							status: "unsupported",
							reason: "audio-selection-requires-processing",
						}
					: checkDirectCompatibility(original, input.evidence),
			container: decision("original-container"),
			video: decision("original-video"),
			audio: aggregateCompatibility(tracks.map(trackDecision)),
			warnings,
			output: description.output
				? {
						...description.output,
						copyVideo: status("copy-video"),
						copyAudio: aggregateStatus("copy-audio"),
						combinations: {
							"copy-copy": aggregateStatus("output-copy-copy"),
							"copy-encode": aggregateStatus("output-copy-encode"),
							"encode-copy": aggregateStatus("output-encode-copy"),
							"encode-encode": aggregateStatus("output-encode-encode"),
						},
					}
				: null,
		};
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertRootEpoch(source.rootEpoch);
		this.options.logger?.debug(
			{
				event: "media.compatibility_checked",
				fileId,
				status: checked.direct.status,
				profileId: description.output?.profileId,
				target: description.output?.target,
			},
			"Media compatibility checked.",
		);
		return freeze(checked);
	}
}
