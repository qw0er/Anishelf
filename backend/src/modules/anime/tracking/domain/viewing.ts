/** Product-owned cumulative viewing states; adapters map external encodings. */
export type ViewingStatus =
	| "watching"
	| "planned"
	| "completed"
	| "paused"
	| "dropped"
	| "rewatching";

/** Shared membership policy; retain the original status for display and sync. */
export function isActiveViewing(status: string | null | undefined): boolean {
	return status === "watching" || status === "rewatching";
}
