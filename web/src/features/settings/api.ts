import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	SettingsResponse,
	TranscodeProfileCatalog,
	UpdateSettingsRequest,
} from "../../shared/api/contracts.js";

export function getSettings(
	options?: RequestOptions,
): Promise<SettingsResponse> {
	return request<SettingsResponse>("/api/settings", "GET", options);
}

export function saveSettings(
	settings: UpdateSettingsRequest,
	options?: RequestOptions,
): Promise<SettingsResponse> {
	return request<SettingsResponse>("/api/settings", "PUT", options, settings);
}

export function getTranscodeProfiles(
	options?: RequestOptions,
): Promise<TranscodeProfileCatalog> {
	return request("/api/transcode-profiles", "GET", options);
}

export function selectTranscodeProfile(
	profileId: string | null,
	options?: RequestOptions,
	preparationMode?: TranscodeProfileCatalog["preparationMode"],
): Promise<TranscodeProfileCatalog> {
	return request("/api/transcode-profiles/selection", "PUT", options, {
		profileId,
		...(preparationMode ? { preparationMode } : {}),
	});
}
