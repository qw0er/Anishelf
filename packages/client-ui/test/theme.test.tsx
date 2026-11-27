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
import { initializeTheme, themeStorageKey } from "../src/shared/theme.js";
import { testPlatform } from "./setup.js";

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

describe("theme preference and system tracking", () => {
	let themeColorMeta: HTMLMetaElement;

	beforeEach(() => {
		window.localStorage.clear();
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
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
		document.documentElement.style.colorScheme = "";
		document.documentElement.style.removeProperty("--background");
		vi.restoreAllMocks();
	});

	it("follows live system theme changes by default even without ThemeToggle mounted", () => {
		const scheme = mockColorScheme(false);
		const controller = new AbortController();

		initializeTheme(testPlatform, controller.signal);
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

	it("restores a saved theme preference and ignores system changes while pinned", () => {
		window.localStorage.setItem(themeStorageKey, "dark");
		const scheme = mockColorScheme(false);
		const controller = new AbortController();

		initializeTheme(testPlatform, controller.signal);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe("dark");

		scheme.setDark(true);
		scheme.setDark(false);
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		controller.abort();
	});

	it("persists ThemeToggle selections and supports explicitly following the system", () => {
		const scheme = mockColorScheme(false);
		const controller = new AbortController();
		initializeTheme(testPlatform, controller.signal);

		render(<ThemeToggle />);
		const trigger = screen.getByRole("button", { name: "Change theme" });

		fireEvent.click(trigger);
		const systemOption = screen.getByRole("menuitem", {
			name: "Follow system",
		});
		const lightOption = screen.getByRole("menuitem", { name: "Light" });
		const darkOption = screen.getByRole("menuitem", { name: "Dark" });
		expect(systemOption.getAttribute("aria-current")).toBe("true");
		expect(lightOption.getAttribute("aria-current")).toBeNull();
		expect(darkOption.getAttribute("aria-current")).toBeNull();

		fireEvent.click(darkOption);
		expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		act(() => {
			scheme.setDark(false);
		});
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		fireEvent.click(trigger);
		expect(
			screen
				.getByRole("menuitem", { name: "Dark" })
				.getAttribute("aria-current"),
		).toBe("true");

		fireEvent.click(screen.getByRole("menuitem", { name: "Follow system" }));
		expect(window.localStorage.getItem(themeStorageKey)).toBe("system");
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		act(() => {
			scheme.setDark(true);
		});
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		controller.abort();
	});

	it("syncs theme changes coming from storage events", () => {
		mockColorScheme(false);
		const controller = new AbortController();
		initializeTheme(testPlatform, controller.signal);

		render(<ThemeToggle />);
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		act(() => {
			window.localStorage.setItem(themeStorageKey, "dark");
			window.dispatchEvent(
				new StorageEvent("storage", { key: themeStorageKey }),
			);
		});
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Change theme" }));
		expect(
			screen
				.getByRole("menuitem", { name: "Dark" })
				.getAttribute("aria-current"),
		).toBe("true");

		controller.abort();
	});
});
