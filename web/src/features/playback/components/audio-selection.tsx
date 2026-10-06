import { useTranslation } from "react-i18next";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { audioTrackLabel } from "../../preparation/public.js";
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
		<div className="min-w-0">
			<label className="flex flex-wrap items-center gap-3">
				<span className="font-medium">{t("audioTracks.playback")}</span>
				<select
					className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
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
