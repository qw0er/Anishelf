import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getClientRuntime } from "./api/connection.js";
import {
	defaultLanguage,
	type LanguageCode,
	readStoredLanguage,
	storeLanguage,
} from "./config/languages.js";
import en from "./locales/en.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };
import type { ClientPlatform } from "./platform.js";

function syncDocumentLanguage(language: string | undefined): void {
	if (typeof document === "undefined" || !language) return;
	document.documentElement.lang = language;
}

export async function initializeLanguage(platform: ClientPlatform) {
	const language = readStoredLanguage(
		platform.preferences,
		platform.preferredLanguages(),
	);
	if (i18n.isInitialized) {
		await i18n.changeLanguage(language);
		return;
	}
	i18n.on("languageChanged", syncDocumentLanguage);
	await i18n.use(initReactI18next).init({
		resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
		lng: language,
		fallbackLng: defaultLanguage,
		interpolation: { escapeValue: false },
	});
	syncDocumentLanguage(i18n.resolvedLanguage);
}

/** Switch the interface language and remember it on this client. */
export async function setLanguage(language: LanguageCode): Promise<void> {
	if (i18n.resolvedLanguage === language) {
		storeLanguage(language, getClientRuntime().platform.preferences);
		return;
	}
	await i18n.changeLanguage(language);
	storeLanguage(language, getClientRuntime().platform.preferences);
	console.debug(`[i18n] Interface language changed to ${language}.`);
}

export default i18n;
