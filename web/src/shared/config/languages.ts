export const defaultLanguage = "en";

export interface LanguageOption {
	code: string;
	label: string;
	shortLabel: string;
}

/** Register a locale here after adding its translation resource. */
export const supportedLanguages = [
	{ code: "en", label: "English", shortLabel: "EN" },
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

/** Read the saved interface language, falling back to English. */
export function readStoredLanguage(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): LanguageCode {
	if (!storage) return defaultLanguage;
	try {
		const value = storage.getItem(languageStorageKey);
		return isSupportedLanguage(value) ? value : defaultLanguage;
	} catch (error) {
		console.warn("[i18n] Could not read the saved interface language.", error);
		return defaultLanguage;
	}
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
