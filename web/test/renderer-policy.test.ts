// @vitest-environment happy-dom
import { waitFor } from "@testing-library/react";
import { TextTrack } from "@vidstack/react";
import { afterEach, expect, test, vi } from "vitest";
import { StyledSubtitleRenderer } from "../src/subtitles/renderer.js";
import { clientConfig } from "./client-config.js";

const options = vi.hoisted(() => [] as { libassMemoryLimit: number }[]);
vi.mock("jassub", () => ({
	default: class {
		ready = Promise.resolve();
		constructor(value: { libassMemoryLimit: number }) {
			options.push(value);
		}
		async destroy() {}
		async manualRender() {}
	},
}));
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	options.length = 0;
});
const track = () => {
	const subtitle = new TextTrack({
		label: "ASS",
		kind: "subtitles",
		type: "ass",
		src: "/subtitle",
	});
	subtitle.mode = "showing";
	return subtitle;
};
test("uses injected initialization timeout to cancel an unfinished subtitle request", async () => {
	vi.useFakeTimers();
	let signal: AbortSignal | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn((_url, init: RequestInit) => {
			signal = init.signal ?? undefined;
			return new Promise(() => {});
		}),
	);
	const renderer = new StyledSubtitleRenderer({
		...clientConfig.subtitles,
		initializationTimeoutMs: 20,
	});
	const subtitle = track();
	renderer.attach(document.createElement("video"));
	renderer.changeTrack(subtitle);
	await vi.advanceTimersByTimeAsync(19);
	expect(signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect(signal?.aborted).toBe(true);
	expect(subtitle.mode).toBe("disabled");
	renderer.detach();
});
test("passes the injected memory budget to JASSUB", async () => {
	const original = Object.getOwnPropertyDescriptor(
		HTMLCanvasElement.prototype,
		"transferControlToOffscreen",
	);
	Object.defineProperty(
		HTMLCanvasElement.prototype,
		"transferControlToOffscreen",
		{ configurable: true, value: () => ({}) },
	);
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(new Response("[Events]\nDialogue: example")),
	);
	const renderer = new StyledSubtitleRenderer({
		...clientConfig.subtitles,
		memoryMaximumBytes: 123456,
	});
	try {
		renderer.attach(document.createElement("video"));
		renderer.changeTrack(track());
		await waitFor(() => expect(options[0]?.libassMemoryLimit).toBe(123456));
	} finally {
		renderer.detach();
		if (original)
			Object.defineProperty(
				HTMLCanvasElement.prototype,
				"transferControlToOffscreen",
				original,
			);
		else
			Reflect.deleteProperty(
				HTMLCanvasElement.prototype,
				"transferControlToOffscreen",
			);
	}
});
