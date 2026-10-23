/** Product-owned cumulative viewing states; adapters map external encodings. */
export type ViewingStatus =
	| "watching"
	| "planned"
	| "completed"
	| "paused"
	| "dropped"
	| "rewatching";
