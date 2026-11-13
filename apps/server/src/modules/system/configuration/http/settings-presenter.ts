import type { SettingsResponse } from "@anishelf/contracts/http";
import type { PersistentSettings } from "../../public.js";

export function settingsResponse(
	settings: Readonly<PersistentSettings>,
): SettingsResponse {
	return {
		resourceRoots: settings.resourceRoots,
		titleDisplayPreference: settings.titleDisplayPreference ?? "native",
		defaultMetadataProvider: settings.defaultMetadataProvider ?? "anilist",
		...(settings.defaultAcquisitionProfileId === undefined
			? {}
			: { defaultAcquisitionProfileId: settings.defaultAcquisitionProfileId }),
		...(settings.qbittorrentWebUiUrl === undefined
			? {}
			: { qbittorrentWebUiUrl: settings.qbittorrentWebUiUrl }),
		...(settings.defaultTranscodeProfileId === undefined
			? {}
			: { defaultTranscodeProfileId: settings.defaultTranscodeProfileId }),
	};
}
