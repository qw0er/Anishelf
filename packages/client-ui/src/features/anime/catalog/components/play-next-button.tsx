import { Play } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import type { Episode } from "../detail-format.js";

export function PlayNextButton({
	episode,
	disabledReason,
	onPlay,
}: {
	episode: Episode | null;
	disabledReason: string | null;
	onPlay(): void;
}) {
	const { t } = useTranslation();
	const reasonId = useId();
	const label =
		episode === null
			? t("anime.playNext")
			: episode.kind === "movie"
				? t("anime.playMovie")
				: t("anime.playEpisode", { episode: episode.number });
	const hint =
		episode === null ? (disabledReason ?? "") : t("anime.nextPlaybackHint");
	return (
		<Tooltip content={hint}>
			<span className="inline-flex">
				<Button
					type="button"
					disabled={episode === null}
					onClick={onPlay}
					title={episode === null ? hint : undefined}
					aria-describedby={episode === null ? reasonId : undefined}
					className="w-full sm:w-auto"
				>
					<Play className="size-4 fill-current" aria-hidden="true" />
					{label}
				</Button>
				{episode === null && (
					<span id={reasonId} className="sr-only">
						{hint}
					</span>
				)}
			</span>
		</Tooltip>
	);
}
