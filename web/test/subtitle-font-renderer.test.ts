// @vitest-environment happy-dom
import { TextTrack } from "@vidstack/react";
import { afterEach, expect, test, vi } from "vitest";
import { subtitlePolicy } from "../src/config/media-policy.js";
import { trackFonts } from "../src/features/subtitles/fonts.js";
import { StyledSubtitleRenderer } from "../src/features/subtitles/renderer.js";

const renderer = vi.hoisted(() => ({
	create: vi.fn(),
	destroy: vi.fn(async () => {}),
	manualRender: vi.fn(async () => {}),
}));
vi.mock("jassub", () => ({
	default: class {
		ready = Promise.resolve();
		destroy = renderer.destroy;
		manualRender = renderer.manualRender;
		constructor(options: unknown) {
			renderer.create(options);
		}
	},
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	renderer.create.mockClear();
	renderer.destroy.mockClear();
});
function setup() {
	const video = document.createElement("video");
	Object.defineProperty(video, "videoWidth", { value: 640 });
	Object.defineProperty(video, "videoHeight", { value: 360 });
	vi.spyOn(
		HTMLCanvasElement.prototype,
		"transferControlToOffscreen",
	).mockImplementation(() => ({}) as OffscreenCanvas);
	const track = new TextTrack({
		id: "ass",
		label: "ASS",
		type: "ass",
		src: "/ass",
		kind: "subtitles",
	});
	track.mode = "showing";
	trackFonts.set(track, {
		id: "set",
		status: "ready",
		statusUrl: "/status",
		warnings: [],
		assets: [
			{
				id: "font",
				format: "ttf",
				family: "Fixture",
				sizeBytes: 4,
				contentUrl: "/font",
			},
		],
	});
	const fallback = vi.fn();
	const instance = new StyledSubtitleRenderer(subtitlePolicy, fallback);
	instance.attach(video);
	return { instance, track, fallback };
}
const ass =
	"[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,你好 A";

test("passes downloaded attachments to JASSUB and destroys the instance on subtitle off", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async (url: string) =>
				new Response(url === "/ass" ? ass : new Uint8Array([1, 2, 3, 4])),
		),
	);
	const { instance, track, fallback } = setup();
	instance.changeTrack(track);
	await vi.waitFor(() => expect(renderer.create).toHaveBeenCalled());
	expect(renderer.create.mock.calls[0]?.[0]).toMatchObject({
		fonts: [new Uint8Array([1, 2, 3, 4]), expect.any(String)],
		queryFonts: false,
	});
	expect(fallback).not.toHaveBeenCalled();
	instance.changeTrack(null);
	expect(renderer.destroy).toHaveBeenCalledTimes(1);
	instance.detach();
});

test("font download failure still initializes styled subtitles with the fallback font", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url === "/ass"
				? new Response(ass)
				: new Response("missing", { status: 404 }),
		),
	);
	const { instance, track, fallback } = setup();
	instance.changeTrack(track);
	await vi.waitFor(() => expect(renderer.create).toHaveBeenCalled());
	expect(renderer.create.mock.calls[0]?.[0]).toMatchObject({
		fonts: [expect.any(String)],
	});
	expect(fallback).toHaveBeenCalledWith(track);
	expect(track.mode).not.toBe("disabled");
	instance.detach();
});

test("switching off while a font downloads prevents creation of a stale renderer", async () => {
	let release: (() => void) | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url === "/ass") return new Response(ass);
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return new Response(new Uint8Array([1, 2, 3, 4]));
		}),
	);
	const { instance, track, fallback } = setup();
	instance.changeTrack(track);
	await vi.waitFor(() => expect(release).toBeDefined());
	instance.changeTrack(null);
	release?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(renderer.create).not.toHaveBeenCalled();
	expect(fallback).not.toHaveBeenCalled();
	instance.detach();
});
