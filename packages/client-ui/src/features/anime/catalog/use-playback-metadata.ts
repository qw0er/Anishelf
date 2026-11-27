import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getClientRuntime } from "../../../shared/api/connection.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { localWorkDetailQuery, sourceQuery } from "./queries.js";

export function useAnimePlaybackMetadata(
	fileId: string,
	selection: {
		workId: string | null;
		episodeId: string | null;
		sourceVersion: string | null;
	},
) {
	const scope = useQueryScope();
	const source = useQuery(sourceQuery(fileId, scope));
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
	const sourceVersion = source.data?.sourceVersion;
	const matchesVersion =
		sourceVersion !== undefined &&
		(!selection.sourceVersion || selection.sourceVersion === sourceVersion);
	const [workId] = groups.keys();
	const artworkWork = matchesVersion && groups.size === 1 ? workId : undefined;
	const { platform } = getClientRuntime();
	const detail = useQuery({
		...localWorkDetailQuery(artworkWork ?? "", scope),
		enabled: Boolean(platform.systemMedia && artworkWork),
	});
	if (!title || !matchesVersion) return;
	const work = detail.data?.work;
	return {
		title,
		sourceVersion,
		artworkUrl:
			work && work.id === artworkWork
				? (work.coverUrl ?? undefined)
				: undefined,
	};
}
