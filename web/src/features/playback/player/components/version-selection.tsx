import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type {
	MediaAsset,
	PlaybackSource,
} from "../../../../shared/api/contracts.js";
import {
	boundedSignal,
	useQueryScope,
} from "../../../../shared/api/queries.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../shared/components/ui/native-select.js";
import { audioTrackLabel } from "../../../media/public.js";
import { getPlaybackOptions } from "../api.js";
import { canSelectNativeAudio } from "../runtime.js";
export function PlaybackVersionSelection({
	source,
	audioStreamIndex,
	selectedAssetId,
	onSelect,
}: {
	source: PlaybackSource;
	audioStreamIndex: number | null;
	selectedAssetId: string;
	onSelect(asset: MediaAsset | null): void;
}) {
	const selectId = useId();
	const { t, i18n } = useTranslation();
	const scope = useQueryScope();
	const query = useQuery({
		queryKey: [
			"playback-assets",
			scope,
			source.fileId,
			source.sourceVersion,
			audioStreamIndex,
			selectedAssetId,
		],
		staleTime: 0,
		queryFn: ({ signal }) =>
			getPlaybackOptions(
				{
					fileId: source.fileId,
					sourceVersion: source.sourceVersion,
					audioStreamIndex,
					canSelectAudio: canSelectNativeAudio(),
					...(selectedAssetId === "auto" ? {} : { assetId: selectedAssetId }),
				},
				{ signal: boundedSignal(signal) },
			),
	});
	const assets = query.data?.assets.map((inspection) => inspection.asset) ?? [];
	return (
		<label htmlFor={selectId} className="space-y-1 text-sm">
			<span>{t("player.assetSelection")}</span>
			<NativeSelect
				id={selectId}
				aria-label={t("player.assetSelection")}
				className="h-11 w-full rounded-md border bg-background px-2"
				value={selectedAssetId}
				disabled={!query.data}
				onChange={(event) =>
					onSelect(
						assets.find((asset) => asset.id === event.target.value) ?? null,
					)
				}
			>
				<NativeSelectOption value="auto">
					{t("player.automaticAsset")}
				</NativeSelectOption>
				{assets.map((asset) => (
					<NativeSelectOption key={asset.id} value={asset.id}>
						{t(`player.assets.${asset.kind}`)} ·{" "}
						{asset.video?.codec?.toUpperCase()} ·{" "}
						{asset.video?.height ? `${asset.video.height}p · ` : ""}
						{asset.audioTracks
							.map(({ stream }, position) =>
								audioTrackLabel(
									{
										...stream,
										label: stream.language ? null : (stream.label ?? null),
										default: false,
									},
									position,
									t,
									i18n.language,
								),
							)
							.join(" / ") || t("audioTracks.none")}
					</NativeSelectOption>
				))}
			</NativeSelect>
			{query.error && (
				<span role="alert" className="block text-muted-foreground">
					{t("player.versionsUnavailable")}
				</span>
			)}
		</label>
	);
}
