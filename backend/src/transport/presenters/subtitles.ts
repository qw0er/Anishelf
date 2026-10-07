import type {
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../../contracts/http.js";
import type {
	SubtitleDiscovery,
	SubtitleFonts,
	SubtitlePreparationResult,
} from "../../modules/subtitles/public.js";

export function subtitleDiscoveryResponse(
	result: SubtitleDiscovery,
): SubtitleDiscoveryResponse {
	return {
		sourceVersion: result.sourceVersion,
		tracks: result.tracks.map((track) => {
			const base = {
				id: track.id,
				name: track.name,
				language: track.language,
				label: track.label,
				sourceVersion: track.sourceVersion,
			};
			return {
				...base,
				origin: track.origin,
				format: track.format,
				sizeBytes: track.sizeBytes,
				codec: track.origin === "embedded" ? track.codec : null,
				default: track.origin === "embedded" ? track.default : false,
				forced: track.origin === "embedded" ? track.forced : false,
				supported:
					track.origin === "external" ||
					(track.extractionSupported && track.webSupported),
				unsupportedReason:
					track.origin === "embedded" ? track.unsupportedReason : null,
			};
		}),
		warnings: result.warnings.map(({ name, code }) => ({ name, code })),
	};
}

export function subtitlePreparationResponse(
	result: SubtitlePreparationResult,
): SubtitlePreparationResponse {
	const fonts = result.fonts
		? { fonts: subtitleFontsResponse(result.fonts) }
		: {};
	if ("external" in result) {
		const { fileId, trackId, sourceVersion, subtitleVersion } = result.external;
		const query = new URLSearchParams({ sourceVersion, subtitleVersion });
		return {
			...fonts,
			id: result.id,
			status: result.status,
			format: result.format,
			errorCode: null,
			statusUrl: null,
			contentUrl: `/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(trackId)}/content?${query}`,
		};
	}
	const url = `/api/subtitle-assets/${encodeURIComponent(result.id)}`;
	return {
		...fonts,
		id: result.id,
		status: result.status,
		format: result.format,
		errorCode: result.errorCode,
		statusUrl: `${url}/status`,
		contentUrl: result.status === "ready" ? url : null,
	};
}

export function subtitleFontsResponse(
	result: SubtitleFonts,
): NonNullable<SubtitlePreparationResponse["fonts"]> {
	const url = `/api/subtitle-font-sets/${encodeURIComponent(result.id)}`;
	return {
		id: result.id,
		status: result.status,
		statusUrl: `${url}/status`,
		warnings: result.warnings,
		assets: result.assets.map((asset) => ({
			id: asset.id,
			family: asset.family,
			format: asset.format,
			sizeBytes: asset.sizeBytes,
			contentUrl: `${url}/fonts/${encodeURIComponent(asset.id)}`,
		})),
	};
}
