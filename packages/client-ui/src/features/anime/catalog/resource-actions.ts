import type { ReactNode } from "react";
/** File-scoped commands are composed by App; Anime owns episode/version selection. */
export type AnimeResourceActionSlot = (
	source: {
		fileId: string;
		sourceVersion: string;
		evidence: { originalName: string };
	},
	identificationMenu?: ReactNode,
) => ReactNode;

export type AnimeEpisodeActionSlot = (target: {
	workKey: string;
	episode: number;
}) => ReactNode;
