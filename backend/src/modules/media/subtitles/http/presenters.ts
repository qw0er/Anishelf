import type { SubtitleDiscoveryResponse } from "../../../../contracts/http.js";
import type { SubtitleDiscovery } from "../public.js";

export function subtitleDiscoveryResponse(
	result: SubtitleDiscovery,
): SubtitleDiscoveryResponse {
	return {
		sourceVersion: result.sourceVersion,
		tracks: result.tracks.map((track) => ({
			...track,
			codec: null,
			default: false,
			forced: false,
			supported: true,
			unsupportedReason: null,
		})),
		warnings: result.warnings.map(({ name, code }) => ({ name, code })),
	};
}
