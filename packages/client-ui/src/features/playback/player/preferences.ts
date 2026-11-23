import type { LibmediaPlaybackPreferences } from "libmedia-react-player";
import type { ClientStorage } from "../../../shared/platform.js";

const rateKey = "anishelf:playback-rate";
const subtitleKey = "anishelf:playback-subtitles";

export function readPlaybackPreferences(
	storage: ClientStorage,
	asset: string,
): LibmediaPlaybackPreferences {
	const preferences: LibmediaPlaybackPreferences = {};
	try {
		const rate = Number(storage.getItem(rateKey));
		if (rate >= 0.5 && rate <= 2) preferences.playbackRate = rate;

		const raw = storage.getItem(subtitleKey);
		if (raw === null) return preferences;
		const saved: unknown = JSON.parse(raw);
		if (!saved || typeof saved !== "object" || !("enabled" in saved))
			return preferences;

		if (saved.enabled === false) preferences.subtitles = { enabled: false };
		if (saved.enabled === true) {
			const subtitles: NonNullable<LibmediaPlaybackPreferences["subtitles"]> = {
				enabled: true,
			};
			if ("language" in saved && typeof saved.language === "string")
				subtitles.language = saved.language;
			if ("asset" in saved && saved.asset === asset) {
				if (
					"externalSubtitleId" in saved &&
					typeof saved.externalSubtitleId === "string"
				)
					subtitles.externalSubtitleId = saved.externalSubtitleId;
				if (
					"streamIndex" in saved &&
					typeof saved.streamIndex === "number" &&
					Number.isSafeInteger(saved.streamIndex) &&
					saved.streamIndex >= 0
				)
					subtitles.streamIndex = saved.streamIndex;
			}
			preferences.subtitles = subtitles;
		}
	} catch {
		console.warn("[playback] Could not read saved playback preferences.");
	}
	return preferences;
}

export function savePlaybackPreferences(
	storage: ClientStorage,
	asset: string,
	{ playbackRate, subtitles }: LibmediaPlaybackPreferences,
): void {
	try {
		if (playbackRate !== undefined)
			storage.setItem(rateKey, String(playbackRate));
		if (subtitles !== undefined)
			storage.setItem(subtitleKey, JSON.stringify({ ...subtitles, asset }));
	} catch {
		console.warn("[playback] Could not save playback preferences.");
	}
}
