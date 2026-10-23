import type { ReactNode } from "react";
/** File-scoped commands are composed by App; Anime owns episode/version selection. */
export type AnimeResourceActionSlot = (
	source: { fileId: string; sourceVersion: string },
	identificationMenu?: ReactNode,
) => ReactNode;
