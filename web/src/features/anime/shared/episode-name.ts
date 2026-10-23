import type { TFunction } from "i18next";
export function episodeName(
	value: { kind: "regular" | "special" | "movie"; number: string },
	t: TFunction,
) {
	return value.kind === "movie"
		? t("anime.movie")
		: t(
				value.kind === "special"
					? "player.specialTitle"
					: "player.episodeTitle",
				{ number: value.number },
			);
}
