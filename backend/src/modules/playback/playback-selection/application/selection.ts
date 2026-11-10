import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { PlaybackAssets } from "../ports.js";
import type {
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelection,
	PlaybackSelectionApi,
	PlaybackSelectionRequest,
} from "../public.js";
/** Only the user's selected bytes are bound; capability predictions never choose a file. */
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
			catalog.source.audioTracks.length &&
			!catalog.source.audioTracks.some((t) => t.index === audio)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"The requested source audio track is unavailable.",
			);
		return {
			source: catalog.source,
			resolvedAudioStreamIndex: audio,
			assets: catalog.assets.map((asset) => {
				const position = asset.audioTracks.findIndex(
					(t) => t.sourceStreamIndex === audio,
				);
				const track = asset.audioTracks[position];
				return {
					asset,
					audio: track
						? {
								position,
								streamIndex: track.stream.index,
								sourceStreamIndex: track.sourceStreamIndex,
							}
						: null,
				};
			}),
		};
	}
	async select(input: PlaybackSelectionRequest): Promise<PlaybackSelection> {
		const inspected = await this.inspect(input);
		const choices = inspected.assets.map((item) => ({
			...item,
			unavailableReason:
				inspected.resolvedAudioStreamIndex !== null &&
				!item.audio &&
				item.asset.inspection !== "unavailable"
					? "audio-track-missing"
					: null,
		}));
		const selected = choices.find((c) =>
			input.assetId
				? c.asset.id === input.assetId
				: c.asset.kind === "original",
		);
		const active = selected?.unavailableReason === null ? selected : null;
		const reason = active
			? null
			: (selected?.unavailableReason ?? "asset-unavailable");
		this.options.logger.info(
			{
				event: "playback.asset_selected",
				fileId: input.fileId,
				assetId: active?.asset.id,
				reason,
			},
			"Explicit playback resource resolved.",
		);
		return {
			source: inspected.source,
			resolvedAudioStreamIndex: inspected.resolvedAudioStreamIndex,
			choices,
			active,
			reason,
		};
	}
}
