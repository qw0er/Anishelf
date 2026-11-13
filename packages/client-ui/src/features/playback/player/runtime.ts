export interface PlaybackFailure {
	kind: "network" | "decode" | "unsupported" | "unknown";
	code: number | null;
}

/** Normalize engine errors without forwarding private resource locators to logs/UI. */
export function playbackFailure(error: unknown): PlaybackFailure {
	const value = error instanceof CustomEvent ? error.detail : error;
	const code =
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		typeof value.code === "number"
			? value.code
			: null;
	const message =
		value instanceof Error ? `${value.name} ${value.message}` : "";
	const kind =
		code === 2 ||
		/NetworkError|fetch|network|HTTP\s+\d{3}|connection/i.test(message)
			? "network"
			: code === 4 ||
					/NotSupportedError|unsupported|not supported/i.test(message)
				? "unsupported"
				: code === 3 ||
						/EncodingError|decode|decoder|WebAssembly|wasm/i.test(message)
					? "decode"
					: "unknown";
	return { kind, code };
}
