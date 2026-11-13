export const defaultLanguage = "en";

export interface LanguageOption {
	code: string;
	label: string;
	shortLabel: string;
}

/** Register a locale here after adding its translation resource. */
export const supportedLanguages = [
	{ code: "en", label: "English", shortLabel: "EN" },
	{ code: "zh-CN", label: "简体中文", shortLabel: "中文" },
] as const satisfies readonly LanguageOption[];

export type LanguageCode = (typeof supportedLanguages)[number]["code"];

export const languageStorageKey = "anishelf:language";

export function isSupportedLanguage(
	value: string | null | undefined,
): value is LanguageCode {
	return supportedLanguages.some((language) => language.code === value);
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** Use a saved preference first, then the browser's preferred languages. */
export function readStoredLanguage(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
	preferredLanguages: readonly string[] = typeof navigator === "undefined"
		? []
		: navigator.languages?.length
			? navigator.languages
			: [navigator.language],
): LanguageCode {
	try {
		const value = storage?.getItem(languageStorageKey);
		if (isSupportedLanguage(value)) return value;
	} catch (error) {
		console.warn("[i18n] Could not read the saved interface language.", error);
	}
	for (const language of preferredLanguages) {
		const normalized = language.toLowerCase();
		if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
		if (normalized === "en" || normalized.startsWith("en-")) return "en";
	}
	return defaultLanguage;
}

export function storeLanguage(
	language: LanguageCode,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (!storage) return;
	try {
		storage.setItem(languageStorageKey, language);
	} catch (error) {
		console.warn("[i18n] Could not save the interface language.", error);
	}
}
