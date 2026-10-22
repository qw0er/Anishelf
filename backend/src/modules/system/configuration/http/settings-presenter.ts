import type { SettingsResponse } from "../../../../contracts/http.js";
import type { PersistentSettings } from "../../public.js";

export function settingsResponse(
	settings: Readonly<PersistentSettings>,
): SettingsResponse {
	return {
		resourceRoots: settings.resourceRoots,
		...(settings.defaultAcquisitionProfileId === undefined
			? {}
			: { defaultAcquisitionProfileId: settings.defaultAcquisitionProfileId }),
		...(settings.rssRefreshIntervalMinutes === undefined
			? {}
			: { rssRefreshIntervalMinutes: settings.rssRefreshIntervalMinutes }),
		...(settings.qbittorrentWebUiUrl === undefined
			? {}
			: { qbittorrentWebUiUrl: settings.qbittorrentWebUiUrl }),
		...(settings.preparationMode === undefined
			? {}
			: { preparationMode: settings.preparationMode }),
		...(settings.transcodeCacheBudgetGiB === undefined
			? {}
			: { transcodeCacheBudgetGiB: settings.transcodeCacheBudgetGiB }),
		...(settings.defaultTranscodeProfileId === undefined
			? {}
			: { defaultTranscodeProfileId: settings.defaultTranscodeProfileId }),
	};
}
