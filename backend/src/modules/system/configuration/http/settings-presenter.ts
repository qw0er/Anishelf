import type { SettingsResponse } from "../../../../contracts/http.js";
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
		...(settings.rssRefreshIntervalMinutes === undefined
			? {}
			: { rssRefreshIntervalMinutes: settings.rssRefreshIntervalMinutes }),
		...(settings.qbittorrentWebUiUrl === undefined
			? {}
			: { qbittorrentWebUiUrl: settings.qbittorrentWebUiUrl }),
		...(settings.transcodeCacheBudgetGiB === undefined
			? {}
			: { transcodeCacheBudgetGiB: settings.transcodeCacheBudgetGiB }),
		...(settings.defaultTranscodeProfileId === undefined
			? {}
			: { defaultTranscodeProfileId: settings.defaultTranscodeProfileId }),
	};
}
