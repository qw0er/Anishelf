import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
	defaultLanguage,
	type LanguageCode,
	readStoredLanguage,
	storeLanguage,
} from "./config/languages.js";
import en from "./locales/en.json" with { type: "json" };

function syncDocumentLanguage(language: string | undefined): void {
	if (typeof document === "undefined" || !language) return;
	document.documentElement.lang = language;
}

i18n.on("languageChanged", syncDocumentLanguage);

void i18n
	.use(initReactI18next)
	.init({
		resources: { en: { translation: en } },
		lng: readStoredLanguage(),
		fallbackLng: defaultLanguage,
		interpolation: { escapeValue: false },
	})
	.then(() => {
		syncDocumentLanguage(i18n.resolvedLanguage);
	});

/** Switch the interface language and remember it in this browser. */
export async function setLanguage(language: LanguageCode): Promise<void> {
	if (i18n.resolvedLanguage === language) {
		storeLanguage(language);
		return;
	}
	await i18n.changeLanguage(language);
	storeLanguage(language);
	console.debug(`[i18n] Interface language changed to ${language}.`);
}

export default i18n;
