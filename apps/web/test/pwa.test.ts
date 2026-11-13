// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { registerPwa } from "../src/pwa.js";

function serviceWorkerFixture(controlled: boolean) {
	const listeners = new Map<string, () => void>();
	const registration = { update: vi.fn(async () => {}) };
	const container = {
		controller: controlled ? {} : null,
		addEventListener: vi.fn((type: string, listener: () => void) => {
			listeners.set(type, listener);
		}),
		removeEventListener: vi.fn(),
		register: vi.fn(async () => registration),
	};
	return {
		container: container as unknown as ServiceWorkerContainer,
		registration,
		listeners,
	};
}

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

test("does nothing outside production", () => {
	const { container } = serviceWorkerFixture(false);
	cleanup = registerPwa({ production: false, serviceWorker: container });
	window.dispatchEvent(new Event("load"));
	expect(container.register).not.toHaveBeenCalled();
});

test("reloads when an updated service worker takes control", () => {
	const { container, listeners } = serviceWorkerFixture(true);
	const reload = vi.fn();
	cleanup = registerPwa({ production: true, serviceWorker: container, reload });
	listeners.get("controllerchange")?.();
	expect(reload).toHaveBeenCalledOnce();
});

test("registers on load and checks for updates while visible", async () => {
	const { container, registration } = serviceWorkerFixture(false);
	cleanup = registerPwa({ production: true, serviceWorker: container });
	window.dispatchEvent(new Event("load"));
	await vi.waitFor(() =>
		expect(container.register).toHaveBeenCalledWith("/sw.js"),
	);
	await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
	const calls = registration.update.mock.calls.length;
	document.dispatchEvent(new Event("visibilitychange"));
	await vi.waitFor(() =>
		expect(registration.update.mock.calls.length).toBeGreaterThan(calls),
	);
});
