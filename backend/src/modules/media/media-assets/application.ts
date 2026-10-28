import type { Logger } from "pino";
import { originalTimeline } from "../../../contracts/media.js";
import { MediaToolError } from "../../../platform/media/errors.js";
import type { MediaInfo } from "../../../platform/media/model.js";
import { DomainError } from "../../../shared/errors.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import {
	describeAudio,
	describeVideo,
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../media-inspection/public.js";
import type { PreparationApi } from "../preparation/public.js";
import type {
	MediaAsset,
	MediaAssetCatalog,
	MediaAssetCatalogApi,
} from "./public.js";

/** Read model of original and published bytes. Task settings supply provenance only. */
export class MediaAssetsApplication implements MediaAssetCatalogApi {
	constructor(
		private readonly options: {
			inspection: MediaInspectionApi;
			preparation: Pick<PreparationApi, "catalog">;
			sources: ResourceAccessApi;
			logger: Logger;
		},
	) {}
	private describe(input: {
		id: string;
		kind: MediaAsset["kind"];
		profileId: string | null;
		info: MediaInfo;
		sourceVersion: string;
		sizeBytes: number;
		mimeType: string;
		sourceAudio: readonly number[];
		sourceDurationMs: number | null;
	}): MediaAsset {
		const { info } = input;
		const videos = info.streams.filter(
			(stream) => stream.type === "video" && !stream.attachedPicture,
		);
		const video = videos.find((stream) => stream.default) ?? videos[0];
		const audios = info.streams.filter((stream) => stream.type === "audio");
		if (audios.length !== input.sourceAudio.length)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Prepared audio provenance does not match the actual output.",
			);
		return {
			id: input.id,
			kind: input.kind,
			inspection: "complete",
			profileId: input.profileId,
			revision: fingerprint({
				sourceVersion: input.sourceVersion,
				info,
				sizeBytes: input.sizeBytes,
			}),
			container: info.container,
			video: video ? describeVideo(video) : null,
			audioTracks: audios.map((stream, position) => ({
				stream: describeAudio(stream),
				sourceStreamIndex: input.sourceAudio[position] as number,
			})),
			defaultAudioStreamIndex:
				(audios.find((stream) => stream.default) ?? audios[0])?.index ?? null,
			durationMs:
				info.duration === null ? null : Math.round(info.duration * 1000),
			sizeBytes: input.sizeBytes,
			mimeType: input.mimeType,
			timeline: originalTimeline(input.sourceDurationMs),
		};
	}
	async list(
		fileId: string,
		sourceVersion?: string,
	): Promise<MediaAssetCatalog> {
		let inspected: Awaited<ReturnType<MediaInspectionApi["inspect"]>>;
		try {
			inspected = await this.options.inspection.inspect(fileId, sourceVersion);
		} catch (error) {
			if (
				!(error instanceof MediaToolError) &&
				!(error instanceof MediaInspectionBusyError)
			)
				throw error;
			const source = await this.options.sources.resolveSource(
				fileId,
				sourceVersion,
			);
			await this.options.sources.revalidateSource(source);
			this.options.sources.assertAccessRevision(source.accessRevision);
			this.options.logger.debug(
				{ event: "media.asset_inspection_unavailable", fileId },
				"Original bytes may be tried explicitly while media inspection is unavailable.",
			);
			return {
				source: {
					fileId,
					sourceVersion: source.identity.sourceVersion,
					audioTracks: [],
					defaultAudioStreamIndex: null,
				},
				assets: [
					{
						id: fileId,
						kind: "original",
						inspection: "unavailable",
						revision: fingerprint(source.identity),
						profileId: null,
						container: null,
						video: null,
						audioTracks: [],
						defaultAudioStreamIndex: null,
						durationMs: null,
						sizeBytes: source.file.sizeBytes,
						mimeType: source.file.mimeType,
						timeline: originalTimeline(),
					},
				],
				pendingAudioSelections: [],
			};
		}
		const { source, info } = inspected;
		const audios = info.streams.filter((stream) => stream.type === "audio");
		const durationMs =
			info.duration === null ? null : Math.round(info.duration * 1000);
		const original = this.describe({
			id: fileId,
			kind: "original",
			profileId: null,
			info,
			sourceVersion: source.identity.sourceVersion,
			sizeBytes: source.file.sizeBytes,
			mimeType: source.file.mimeType,
			sourceAudio: audios.map((stream) => stream.index),
			sourceDurationMs: durationMs,
		});
		const catalog: MediaAssetCatalog = {
			source: {
				fileId,
				sourceVersion: source.identity.sourceVersion,
				audioTracks: audios.map(describeAudio),
				defaultAudioStreamIndex: original.defaultAudioStreamIndex,
			},
			assets: [original],
			pendingAudioSelections: [],
		};
		try {
			const inventory = await this.options.preparation.catalog(fileId);
			const matches = (
				candidate: (typeof inventory.pending)[number]["source"],
			) =>
				candidate.fileId === fileId &&
				candidate.scopeId === source.identity.scopeId &&
				candidate.sourceVersion === source.identity.sourceVersion;
			catalog.pendingAudioSelections = inventory.pending
				.filter((item) => matches(item.source))
				.map((item) => item.sourceAudioStreamIndices);
			for (const artifact of inventory.assets) {
				if (!matches(artifact.source)) continue;
				catalog.assets.push(
					this.describe({
						id: artifact.id,
						kind: "prepared",
						profileId: artifact.profileId,
						info: artifact.info,
						sourceVersion: source.identity.sourceVersion,
						sizeBytes: artifact.sizeBytes,
						mimeType: artifact.mimeType,
						sourceAudio: artifact.sourceAudioStreamIndices,
						sourceDurationMs: durationMs,
					}),
				);
			}
		} catch (error) {
			if (
				!(error instanceof DomainError) ||
				error.code !== "PREPARATION_UNAVAILABLE"
			)
				throw error;
			this.options.logger.debug(
				{ event: "media.asset_copies_unavailable", fileId },
				"Original media remains available while prepared copies are unavailable.",
			);
		}
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertAccessRevision(source.accessRevision);
		return catalog;
	}
}
