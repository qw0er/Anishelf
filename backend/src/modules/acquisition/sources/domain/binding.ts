/** Private persisted query identity. HTTP/configuration consumers use SourceInput. */
export interface SourceQuery {
	generation: string;
	indexerId: string;
	titles: readonly string[];
}
export type SourceBinding =
	| { kind: "rss"; url: string }
	| { kind: "jackett"; plan: SourceQuery };
