export type DesktopLocale = "en" | "zh-CN";

/** Normalize a system or UI locale string to a supported desktop menu locale. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
	return locale.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
