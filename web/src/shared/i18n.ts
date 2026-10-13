import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { defaultLanguage } from "./config/interaction-policy.js";
import en from "./locales/en.json" with { type: "json" };

void i18n.use(initReactI18next).init({
	resources: { en: { translation: en } },
	lng: defaultLanguage,
	fallbackLng: defaultLanguage,
	interpolation: { escapeValue: false },
});

export default i18n;
