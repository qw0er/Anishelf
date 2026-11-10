import type { Logger } from "pino";
import { DomainError } from "../../../../../shared/errors.js";
import { fingerprint } from "../../../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../../resources/public.js";
import type { TranscodeProfile } from "../../../../system/public.js";
import {
	describeAudio,
	describeVideo,
	type MediaInspectionApi,
} from "../../../inspection/public.js";
import { resolveExecutionPlan } from "../domain/execution-plan.js";
import type { PreparationRequest } from "../public.js";
import type { MediaPlanningResult } from "../result.js";

/** Compiles explicit manual commands; browser capabilities are never inputs. */
export class MediaPlanningApplication {
	private closed = false;
	constructor(
		private readonly options: {
			inspection: MediaInspectionApi;
			sources: ResourceAccessApi;
			profiles:
				| DeepReadonly<TranscodeProfile[]>
				| (() => DeepReadonly<TranscodeProfile[]>);
			refreshProfiles?: (() => Promise<void>) | undefined;
			logger?: Logger;
		},
	) {}
	close() {
		this.closed = true;
	}
	async plan(
		input: PreparationRequest & { fileId: string },
	): Promise<DeepReadonly<MediaPlanningResult>> {
		if (this.closed)
			throw new DomainError(
				"MEDIA_PLANNING_UNAVAILABLE",
				"Preparation planning is closed.",
			);
		await this.options.refreshProfiles?.();
		const profiles =
			typeof this.options.profiles === "function"
				? this.options.profiles()
				: this.options.profiles;
		const profile = profiles.find((p) => p.id === input.profileId);
		if (!profile)
			throw new DomainError(
				"INVALID_REQUEST",
				"Selected preparation profile is unavailable.",
			);
		const { source, info } = await this.options.inspection.inspect(
			input.fileId,
			input.sourceVersion,
		);
		const videos = info.streams.filter(
			(s) => s.type === "video" && !s.attachedPicture,
		);
		const video = videos.find((s) => s.default) ?? videos[0];
		const audios = info.streams.filter((s) => s.type === "audio");
		const selection = input.audioStreamIndices ?? audios.map((s) => s.index);
		if (
			selection.length > 128 ||
			new Set(selection).size !== selection.length ||
			selection.some((i) => !audios.some((s) => s.index === i))
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Invalid source audio selection.",
			);
		const retained = info.streams.filter(
			(s) => s.type === "subtitle" || s.type === "attachment",
		);
		// Matroska preserves the supported subtitle codecs and font attachments without conversion.
		if (retained.length && profile.container !== "matroska")
			return freeze({
				kind: "blocked",
				reason: "subtitle-preservation-requires-matroska",
			});
		const subtitleCodecs = new Set([
			"subrip",
			"ass",
			"ssa",
			"webvtt",
			"hdmv_pgs_subtitle",
			"dvd_subtitle",
			"dvb_subtitle",
		]);
		if (
			retained.some(
				(s) => s.type === "subtitle" && !subtitleCodecs.has(s.codec ?? ""),
			)
		)
			return freeze({ kind: "blocked", reason: "subtitle-copy-unavailable" });
		if (retained.some((s) => s.type === "attachment" && !s.tags.filename))
			return freeze({ kind: "blocked", reason: "attachment-name-missing" });

		const resolved = resolveExecutionPlan({
			fileId: input.fileId,
			sourceVersion: source.identity.sourceVersion,
			scopeId: source.identity.scopeId,
			profile,
			selectedVideo: video ? describeVideo(video) : null,
			defaultAudioStreamIndex:
				(audios.find((s) => s.default) ?? audios[0])?.index ?? null,
			selectedAudioStreamIndices: selection,
			audioTracks: audios.map((s) => ({ stream: describeAudio(s) })),
			profileFingerprint: fingerprint({
				profile,
				preservation: "subtitles-fonts-chapters:1",
			}),
		});
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertAccessRevision(source.accessRevision);
		if (this.closed)
			throw new DomainError(
				"MEDIA_PLANNING_UNAVAILABLE",
				"Preparation planning is closed.",
			);
		if (resolved.kind !== "processing")
			return freeze({
				kind: "blocked",
				reason: resolved.kind === "blocked" ? resolved.reason : "invalid-plan",
			});
		this.options.logger?.info(
			{
				event: "media.manual_plan_compiled",
				fileId: input.fileId,
				profileId: profile.id,
				container: profile.container,
				mode: resolved.mode,
				reasons: resolved.reasons,
			},
			"Manual preparation plan compiled.",
		);
		return freeze({
			kind: "processing-required",
			target: "file",
			mode: resolved.mode,
			reasons: resolved.reasons,
			identity: {
				rootId: source.identity.scopeId,
				fileId: input.fileId,
				sourceVersion: source.identity.sourceVersion,
				profileFingerprint: resolved.profileFingerprint,
				executionPlanId: resolved.request.plan.id,
				videoStreamIndex: resolved.request.videoStreamIndex,
				audioStreamIndices: resolved.request.audioStreamIndices,
			},
			execution: resolved.request,
		});
	}
}
