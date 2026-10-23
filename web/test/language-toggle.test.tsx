// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import LanguageToggle from "../src/shared/components/language-toggle.js";
import { languageStorageKey } from "../src/shared/config/languages.js";
import "../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
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
