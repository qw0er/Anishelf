export interface PlaybackFailure {
	kind: "network" | "decode" | "unsupported" | "unknown";
	code: number | null;
}
