// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import {
	AutomaticContinuationSetting,
	PlaybackPreferencesSettings,
} from "../../../src/features/settings/components/playback-preferences.js";
import "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "../../support/query-test-utils.js";

const key = "anishelf.autoContinue";
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

test("Settings and player options immediately share one persisted browser preference", () => {
	const view = render(
		<>
			<PlaybackPreferencesSettings />
			<AutomaticContinuationSetting />
		</>,
	);
	const controls = [
		screen.getByRole("switch", { name: "Continue automatically" }),
		screen.getByRole("checkbox", { name: "Continue automatically" }),
	];
	for (const control of controls)
		expect(control.getAttribute("aria-checked")).toBe("false");
	fireEvent.click(controls[0] as HTMLElement);
	for (const control of controls)
		expect(control.getAttribute("aria-checked")).toBe("true");
	expect(localStorage.getItem(key)).toBe("true");
	fireEvent.click(controls[1] as HTMLElement);
	for (const control of controls)
		expect(control.getAttribute("aria-checked")).toBe("false");
	expect(localStorage.getItem(key)).toBe("false");
	fireEvent.click(controls[1] as HTMLElement);
	view.unmount();
	render(<AutomaticContinuationSetting />);
	expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
		"true",
	);
});

test("changes from another browser tab and storage clearing update mounted controls", () => {
	localStorage.setItem(key, "true");
	render(<AutomaticContinuationSetting />);
	const control = screen.getByRole("checkbox");
	expect(control.getAttribute("aria-checked")).toBe("true");
	localStorage.setItem(key, "false");
	fireEvent(window, new StorageEvent("storage", { key, newValue: "false" }));
	expect(control.getAttribute("aria-checked")).toBe("false");
	localStorage.setItem(key, "true");
	fireEvent(window, new StorageEvent("storage", { key, newValue: "true" }));
	expect(control.getAttribute("aria-checked")).toBe("true");
	localStorage.clear();
	fireEvent(window, new StorageEvent("storage", { key: null }));
	expect(control.getAttribute("aria-checked")).toBe("false");
});

test("a failed storage write retains the saved choice and offers visible recovery information", () => {
	localStorage.setItem(key, "true");
	const storage = window.localStorage;
	vi.spyOn(window, "localStorage", "get").mockReturnValue({
		getItem: storage.getItem.bind(storage),
		length: storage.length,
		clear: storage.clear.bind(storage),
		key: storage.key.bind(storage),
		removeItem: storage.removeItem.bind(storage),
		setItem: () => {
			throw new DOMException("Storage denied", "SecurityError");
		},
	} as Storage);
	vi.spyOn(console, "warn").mockImplementation(() => {});
	render(<AutomaticContinuationSetting />);
	const control = screen.getByRole("checkbox");
	fireEvent.click(control);
	expect(control.getAttribute("aria-checked")).toBe("true");
	expect(localStorage.getItem(key)).toBe("true");
	expect(screen.getByRole("alert").textContent).toContain(
		"could not be read or saved",
	);
});
