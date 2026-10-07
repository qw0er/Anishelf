import type { SettingsResponse } from "../../contracts/http.js";
import type { PersistentSettings } from "../../modules/configuration/public.js";

export function settingsResponse(
	settings: Readonly<PersistentSettings>,
): SettingsResponse {
	return {
		resourceRoot: settings.resourceRoot,
		...(settings.preparationMode === undefined
			? {}
			: { preparationMode: settings.preparationMode }),
		...(settings.transcodeCacheBudgetGiB === undefined
			? {}
			: { transcodeCacheBudgetGiB: settings.transcodeCacheBudgetGiB }),
		...(settings.defaultTranscodeProfileId === undefined
			? {}
			: { defaultTranscodeProfileId: settings.defaultTranscodeProfileId }),
		...(settings.scanIntervalMinutes === undefined
			? {}
			: { scanIntervalMinutes: settings.scanIntervalMinutes }),
	};
}
