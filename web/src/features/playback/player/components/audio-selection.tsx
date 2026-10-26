import { useTranslation } from "react-i18next";
import type { CompatibilityResult } from "../../../../shared/api/contracts.js";
import { audioTrackLabel } from "../../../media/public.js";
export function AudioSelection({
	audio,
	audioTracks,
	audioStreamIndices,
	selectAudio,
}: {
	audio: string | null;
	audioTracks: CompatibilityResult["audioTracks"];
	audioStreamIndices: number[] | undefined;
	selectAudio(value: string | null): void;
}) {
	const { t, i18n } = useTranslation();
	return audioTracks.length > 1 ? (
		<div className="min-w-0 max-w-full">
			<label className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 text-sm text-muted-foreground">
					{t("player.audio")}
				</span>
				<select
					className="h-11 min-w-0 max-w-40 rounded-md bg-transparent px-2 text-sm sm:max-w-72"
					aria-label={t("audioTracks.playback")}
					value={audio ?? "all"}
					onChange={(event) =>
						selectAudio(
							event.target.value === "all" ? null : event.target.value,
						)
					}
				>
					<option value="all">{t("audioTracks.defaultPlayback")}</option>
					{audioTracks.map(({ stream }, position) => (
						<option key={stream.index} value={String(stream.index)}>
							{audioTrackLabel(stream, position, t, i18n.language)}
						</option>
					))}
					{audio?.includes(",") && (
						<option value={audio}>
							{t("audioTracks.selected", {
								count: audioStreamIndices?.length,
							})}
						</option>
					)}
					<option value="">{t("audioTracks.none")}</option>
				</select>
			</label>
		</div>
	) : null;
}
