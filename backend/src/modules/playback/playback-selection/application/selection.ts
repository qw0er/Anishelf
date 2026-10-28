import type { Logger } from "pino";
import { playbackSelectionConstraints } from "../../../../contracts/defaults.js";
import { DomainError } from "../../../../shared/errors.js";
import { assessAsset, inspectAsset } from "../domain/assets.js";
import type { PlaybackAssets } from "../ports.js";
import type {
	PlaybackAssetChoice,
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelection,
	PlaybackSelectionApi,
	PlaybackSelectionRequest,
} from "../public.js";
/** Read-only choice among existing assets; encoding plans are not playback inputs. */
export class PlaybackSelectionApplication implements PlaybackSelectionApi {
	constructor(
		private readonly options: { assets: PlaybackAssets; logger: Logger },
	) {}
	async inspect(
		input: PlaybackOptionsRequest,
	): Promise<PlaybackOptionsResponse> {
		const catalog = await this.options.assets.list(
			input.fileId,
			input.sourceVersion,
		);
		const audio =
			input.audioStreamIndex === undefined
				? catalog.source.defaultAudioStreamIndex
				: input.audioStreamIndex;
		if (
			audio !== null &&
			!catalog.source.audioTracks.some((track) => track.index === audio)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"The requested source audio track is unavailable.",
			);
		const assets = [...catalog.assets].sort(
			(a, b) => Number(b.id === input.assetId) - Number(a.id === input.assetId),
		);
		return {
			source: catalog.source,
			resolvedAudioStreamIndex: audio,
			assets: assets
				.slice(0, playbackSelectionConstraints.maximumCandidates)
				.map((asset) => inspectAsset(asset, audio, input.canSelectAudio)),
			pending: catalog.pendingAudioSelections.some((selection) =>
				audio === null ? selection.length === 0 : selection.includes(audio),
			),
		};
	}
	async select(input: PlaybackSelectionRequest): Promise<PlaybackSelection> {
		const inspected = await this.inspect(input);
		if (
			new Set(input.evidence.map((entry) => entry.assetId)).size !==
			input.evidence.length
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Duplicate asset compatibility evidence.",
			);
		for (const entry of input.evidence) {
			const current = inspected.assets.find(
				(asset) => asset.asset.id === entry.assetId,
			);
			if (!current || current.descriptionId !== entry.descriptionId)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The media asset changed. Refresh playback options.",
				);
		}
		const choices: PlaybackAssetChoice[] = inspected.assets.map(
			(inspection) => {
				const evidence =
					input.evidence.find((entry) => entry.assetId === inspection.asset.id)
						?.evidence ?? [];
				const compatibility = assessAsset(
					inspection,
					evidence,
					input.canSelectAudio,
				);
				const unavailableReason =
					(inspected.resolvedAudioStreamIndex !== null && !inspection.audio) ||
					(inspected.resolvedAudioStreamIndex === null &&
						inspection.asset.audioTracks.length > 0)
						? "audio-track-missing"
						: input.failedResourceIds?.includes(inspection.asset.id)
							? "asset-playback-failed"
							: compatibility.overall.status === "supported"
								? null
								: compatibility.overall.reason;
				return {
					asset: inspection.asset,
					audio: inspection.audio,
					compatibility,
					unavailableReason,
				};
			},
		);
		const allowed = choices.filter(
			(choice) =>
				(!input.assetId || choice.asset.id === input.assetId) &&
				(choice.unavailableReason === null ||
					(input.allowUnverified &&
						!["no-video-stream", "audio-track-selection-unavailable"].includes(
							choice.compatibility.overall.reason,
						) &&
						choice.unavailableReason !== "audio-track-missing" &&
						choice.unavailableReason !== "asset-playback-failed")),
		);
		allowed.sort(
			(a, b) =>
				Number(a.asset.kind !== "original") -
				Number(b.asset.kind !== "original"),
		);
		const selected = allowed[0];
		const result: PlaybackSelection = {
			source: inspected.source,
			resolvedAudioStreamIndex: inspected.resolvedAudioStreamIndex,
			choices,
			pending: inspected.pending,
			active: selected ?? null,
			reason: selected
				? null
				: inspected.pending
					? "preparation-pending"
					: input.assetId &&
							!choices.some((choice) => choice.asset.id === input.assetId)
						? "asset-unavailable"
						: "no-playable-asset",
		};
		this.options.logger.debug(
			{
				event: "playback.asset_selected",
				fileId: input.fileId,
				sourceVersion: inspected.source.sourceVersion,
				assetId: selected?.asset.id,
				sourceAudioStreamIndex: inspected.resolvedAudioStreamIndex,
				assetAudioStreamIndex: selected?.audio?.streamIndex,
				reason: result.reason,
			},
			"Playback resolved against actual media assets.",
		);
		return result;
	}
}
