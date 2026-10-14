import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useQueryScope } from "../../../shared/api/queries.js";
import { sourceQuery } from "./queries.js";
export function useAnimePlaybackTitle(
	fileId: string,
	selection: {
		workId: string | null;
		episodeId: string | null;
		sourceVersion: string | null;
	},
) {
	const source = useQuery(sourceQuery(fileId, useQueryScope()));
	const { t } = useTranslation();
	const associations = (source.data?.associations ?? []).toSorted((a, b) =>
		a.number.localeCompare(b.number, "en", { numeric: true }),
	);
	const selected = associations.find(
		(item) =>
			item.workId === selection.workId &&
			item.episodeId === selection.episodeId,
	);
	const groups = new Map<string, { title: string; episodes: string[] }>();
	for (const item of selected ? [selected] : associations) {
		const group = groups.get(item.workId) ?? {
			title: item.workTitle,
			episodes: [],
		};
		group.episodes.push(
			item.kind === "movie"
				? t("anime.movie")
				: t(
						item.kind === "special"
							? "player.specialTitle"
							: "player.episodeTitle",
						{ number: item.number },
					),
		);
		groups.set(item.workId, group);
	}
	const title = [...groups.values()]
		.map((group) => `${group.title} — ${group.episodes.join(", ")}`)
		.join(" / ");
	return title &&
		source.data &&
		(!selection.sourceVersion ||
			selection.sourceVersion === source.data.sourceVersion)
		? { title, sourceVersion: source.data.sourceVersion }
		: undefined;
}
