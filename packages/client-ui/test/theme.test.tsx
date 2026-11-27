// @vitest-environment happy-dom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "../src/shared/components/theme-toggle.js";
import { watchSystemTheme } from "../src/shared/theme.js";

function mockColorScheme(initialDark: boolean) {
	let dark = initialDark;
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const media = {
		media: "(prefers-color-scheme: dark)",
		get matches() {
			return dark;
		},
		addEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "change" && typeof listener === "function") {
					listeners.add(listener as (event: MediaQueryListEvent) => void);
				}
			},
		),
		removeEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "change" && typeof listener === "function") {
					listeners.delete(listener as (event: MediaQueryListEvent) => void);
				}
			},
		),
	};
	vi.spyOn(window, "matchMedia").mockReturnValue(
		media as unknown as MediaQueryList,
	);
	return {
		media,
		setDark(next: boolean) {
			dark = next;
			const event = {
				matches: next,
				media: media.media,
			} as MediaQueryListEvent;
			for (const listener of listeners) listener(event);
		},
	};
}

describe("system theme tracking", () => {
	let themeColorMeta: HTMLMetaElement;

	beforeEach(() => {
		document.documentElement.classList.remove("dark");
		document.documentElement.style.colorScheme = "";
		document.documentElement.style.setProperty("--background", "#fafafa");
		themeColorMeta = document.createElement("meta");
		themeColorMeta.name = "theme-color";
		themeColorMeta.content = "#fafafa";
		document.head.appendChild(themeColorMeta);
	});

	afterEach(() => {
		cleanup();
		themeColorMeta.remove();
		document.documentElement.classList.remove("dark");
		document.documentElement.style.colorScheme = "";
		document.documentElement.style.removeProperty("--background");
		vi.restoreAllMocks();
	});

	it("follows live system theme changes even without ThemeToggle mounted", () => {
		const scheme = mockColorScheme(false);
		const controller = new AbortController();

		watchSystemTheme(controller.signal);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("light");

		document.documentElement.style.setProperty("--background", "#0f0f10");
		scheme.setDark(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(themeColorMeta.content).toBe("#0f0f10");

		controller.abort();
		expect(scheme.media.removeEventListener).toHaveBeenCalledTimes(1);

		scheme.setDark(false);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("keeps ThemeToggle in sync with both system changes and manual toggles", () => {
		const scheme = mockColorScheme(false);
		const controller = new AbortController();
		watchSystemTheme(controller.signal);

		render(<ThemeToggle />);
		const button = screen.getByRole("button");
		expect(button.getAttribute("aria-label")).toContain("dark");

		fireEvent.click(button);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(button.getAttribute("aria-label")).toContain("light");

		act(() => {
			scheme.setDark(false);
		});
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(button.getAttribute("aria-label")).toContain("dark");

		controller.abort();
	});
});
