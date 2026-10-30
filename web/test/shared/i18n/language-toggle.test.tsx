// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import LanguageToggle from "../../../src/shared/components/language-toggle.js";
import {
	languageStorageKey,
	readStoredLanguage,
} from "../../../src/shared/config/languages.js";
import i18n from "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

afterEach(async () => {
	cleanup();
	window.localStorage.clear();
	await i18n.changeLanguage("en");
});

test("switches to Chinese and remembers the selection", async () => {
	render(<LanguageToggle />);
	fireEvent.click(screen.getByRole("button", { name: "Change language" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "简体中文" }));
	await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
	expect(window.localStorage.getItem(languageStorageKey)).toBe("zh-CN");
	expect(i18n.t("app.library")).toBe("媒体库");
});

test("uses browser language unless a supported preference is saved", () => {
	const storage = { getItem: () => null };
	expect(readStoredLanguage(storage, ["fr-FR", "zh-Hans-CN", "en-US"])).toBe(
		"zh-CN",
	);
	expect(readStoredLanguage(storage, ["en-US", "zh-CN"])).toBe("en");
	expect(readStoredLanguage(storage, ["fr-FR"])).toBe("en");
	expect(readStoredLanguage({ getItem: () => "en" }, ["zh-CN"])).toBe("en");
	expect(
		readStoredLanguage(
			{
				getItem: () => {
					throw new Error("unavailable");
				},
			},
			["zh-CN"],
		),
	).toBe("zh-CN");
});

test("offers the supported interface language and remembers the selection", async () => {
	render(<LanguageToggle />);
	fireEvent.click(screen.getByRole("button", { name: "Change language" }));
	const english = await screen.findByRole("menuitem", { name: "English" });
	expect(english.getAttribute("aria-current")).toBe("true");

	fireEvent.click(english);

	await waitFor(() =>
		expect(window.localStorage.getItem(languageStorageKey)).toBe("en"),
	);
	expect(document.documentElement.lang).toBe("en");
});
