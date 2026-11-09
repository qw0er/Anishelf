import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	AutoPreparationCatalog,
	ReloadTranscodeProfilesResponse,
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
): Promise<TranscodeProfileCatalog> {
	return request("/api/transcode-profiles/selection", "PUT", options, {
		profileId,
	});
}

export function getAutoPreparationPresets(
	options?: RequestOptions,
): Promise<AutoPreparationCatalog> {
	return request("/api/auto-preparation-presets", "GET", options);
}

export function reloadTranscodeProfiles(): Promise<ReloadTranscodeProfilesResponse> {
	return request("/api/transcode-profiles/reload", "POST");
}
