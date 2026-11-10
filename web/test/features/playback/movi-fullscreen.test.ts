// @vitest-environment happy-dom

import type { MoviElement } from "movi-player/element";
import { afterEach, expect, test, vi } from "vitest";
import { bindFullscreen } from "../../../src/features/playback/player/fullscreen.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.restoreAllMocks();
	document.body.replaceChildren();
	document.body.style.overflow = "";
});

function fixture(nativeEnabled = true) {
	let fullscreen: Element | null = null;
	const originalFullscreen = Object.getOwnPropertyDescriptor(
		document,
		"fullscreenElement",
	);
	const originalEnabled = Object.getOwnPropertyDescriptor(
		document,
		"fullscreenEnabled",
	);
	const originalExit = Object.getOwnPropertyDescriptor(
		document,
		"exitFullscreen",
	);
	Object.defineProperty(document, "fullscreenElement", {
		configurable: true,
		get: () => fullscreen,
	});
	Object.defineProperty(document, "fullscreenEnabled", {
		configurable: true,
		get: () => nativeEnabled,
	});
	const player = Object.assign(document.createElement("div"), {
		setHostFullscreen: vi.fn<(active: boolean) => void>(),
	}) as unknown as MoviElement;
	const surface = document.createElement("section");
	surface.appendChild(player);
	document.body.appendChild(surface);
	const change = vi.fn<(active: boolean) => void>();
	const setFullscreen = (next: Element | null) => {
		fullscreen = next;
		document.dispatchEvent(new Event("fullscreenchange"));
	};
	const request = vi.fn<HTMLElement["requestFullscreen"]>(async () => {
		setFullscreen(surface);
	});
	const exit = vi.fn<Document["exitFullscreen"]>(async () => {
		setFullscreen(null);
	});
	Object.defineProperty(surface, "requestFullscreen", {
		configurable: true,
		value: request,
	});
	Object.defineProperty(document, "exitFullscreen", {
		configurable: true,
		value: exit,
	});
	const dispose = bindFullscreen(player, surface, change);
	cleanups.push(() => {
		dispose();
		for (const [name, descriptor] of [
			["fullscreenElement", originalFullscreen],
			["fullscreenEnabled", originalEnabled],
			["exitFullscreen", originalExit],
		] as const) {
			if (descriptor) Object.defineProperty(document, name, descriptor);
			else Reflect.deleteProperty(document, name);
		}
	});
	const toggle = () => {
		const event = new Event("movi-fullscreen-request", { cancelable: true });
		player.dispatchEvent(event);
		return event;
	};
	return {
		player,
		surface,
		change,
		request,
		exit,
		dispose,
		toggle,
		setFullscreen,
	};
}

test("native fullscreen covers the app surface and synchronizes enter, exit and browser changes", async () => {
	const f = fixture();
	expect(f.toggle().defaultPrevented).toBe(true);
	await vi.waitFor(() => expect(f.change).toHaveBeenLastCalledWith(true));
	expect(f.request).toHaveBeenCalledTimes(1);
	expect(document.fullscreenElement).toBe(f.surface);
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(true);
	f.toggle();
	await vi.waitFor(() => expect(f.change).toHaveBeenLastCalledWith(false));
	expect(f.exit).toHaveBeenCalledTimes(1);
	f.setFullscreen(document.createElement("aside"));
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(false);
	f.setFullscreen(f.surface);
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(true);
	f.setFullscreen(null);
	expect(f.change).toHaveBeenLastCalledWith(false);
});

test("viewport fallback preserves page overflow and exits with Escape or the fullscreen button", () => {
	document.body.style.overflow = "clip";
	const f = fixture(false);
	f.toggle();
	expect(f.request).not.toHaveBeenCalled();
	expect(f.surface.hasAttribute("data-viewport-fullscreen")).toBe(true);
	expect(document.body.style.overflow).toBe("hidden");
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(true);
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	expect(f.surface.hasAttribute("data-viewport-fullscreen")).toBe(false);
	expect(document.body.style.overflow).toBe("clip");
	expect(f.change).toHaveBeenLastCalledWith(false);
	f.toggle();
	f.toggle();
	expect(document.body.style.overflow).toBe("clip");
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(false);
});

test("a rejected native request falls back to the viewport without leaving a dead control", async () => {
	const f = fixture();
	f.request.mockRejectedValueOnce(
		new DOMException("Fullscreen denied", "NotAllowedError"),
	);
	f.toggle();
	await vi.waitFor(() =>
		expect(f.surface.hasAttribute("data-viewport-fullscreen")).toBe(true),
	);
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(true);
	f.dispose();
	expect(f.surface.hasAttribute("data-viewport-fullscreen")).toBe(false);
	expect(document.body.style.overflow).toBe("");
	expect(f.change).toHaveBeenLastCalledWith(false);
});

test("disposing exits only the owned native surface, detaches listeners and is idempotent", async () => {
	const f = fixture();
	f.setFullscreen(f.surface);
	f.dispose();
	f.dispose();
	expect(f.exit).toHaveBeenCalledTimes(1);
	expect(f.change).toHaveBeenLastCalledWith(false);
	const changes = f.change.mock.calls.length;
	f.toggle();
	f.setFullscreen(f.surface);
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	await Promise.resolve();
	expect(f.request).not.toHaveBeenCalled();
	expect(f.change).toHaveBeenCalledTimes(changes);
});

test("a native request completing after disposal immediately leaves its old surface", async () => {
	const f = fixture();
	let complete!: () => void;
	f.request.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				complete = () => {
					f.setFullscreen(f.surface);
					resolve();
				};
			}),
	);
	f.toggle();
	// A second click while the first request is pending does not create a second entry.
	f.toggle();
	expect(f.request).toHaveBeenCalledTimes(1);
	f.dispose();
	const changes = f.change.mock.calls.length;
	complete();
	await vi.waitFor(() => expect(f.exit).toHaveBeenCalledTimes(1));
	expect(document.fullscreenElement).toBeNull();
	expect(f.change).toHaveBeenCalledTimes(changes);
	expect(f.player.setHostFullscreen).toHaveBeenLastCalledWith(false);
});

test("a late rejected native request cannot activate viewport fullscreen after disposal", async () => {
	const f = fixture();
	let reject!: (error: Error) => void;
	f.request.mockImplementationOnce(
		() =>
			new Promise<void>((_resolve, fail) => {
				reject = fail;
			}),
	);
	f.toggle();
	f.dispose();
	const changes = f.change.mock.calls.length;
	reject(new Error("request failed after departure"));
	await Promise.resolve();
	await Promise.resolve();
	expect(f.surface.hasAttribute("data-viewport-fullscreen")).toBe(false);
	expect(document.body.style.overflow).toBe("");
	expect(f.change).toHaveBeenCalledTimes(changes);
});

test("disposal never exits another component's fullscreen surface", () => {
	const f = fixture();
	f.setFullscreen(document.createElement("aside"));
	f.dispose();
	expect(f.exit).not.toHaveBeenCalled();
});
