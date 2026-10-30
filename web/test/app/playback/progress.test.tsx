// @vitest-environment happy-dom

import { expect, test, vi } from "vitest";
import { toast } from "../../../src/shared/components/ui/toast.js";
import {
	act,
	fireEvent,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, file, json } from "../support/state.js";

setupAppTest();

test("StrictMode opens one session, restores server history, saves seeks including zero with the same generation", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/playback/sessions")
			return Promise.resolve(
				json(
					{
						token: "session-token",
						generation: 1,
						sourceVersion: "version",
						file: file.file,
						plan: {
							mode: "direct",
							resource: {
								delivery: "file" as const,
								url: file.originalMediaUrl,
								mimeType: "video/mp4",
								timeline: {
									sourceOriginMs: 0,
									mediaOriginMs: 0,
									sourceDurationMs: null,
								},
							},
						},
						progress: {
							positionMs: 40000,
							durationMs: 100000,
							lastViewedAtMs: 1,
							generation: 1,
							lastSequence: 0,
						},
					},
					201,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1", true);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([path]) => path === "/api/playback/sessions"),
		).toBe(true),
	);
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	expect(video.currentTime).toBe(40);
	expect(
		fetcher.mock.calls.filter(([path]) => path === "/api/playback/sessions"),
	).toHaveLength(1);
	expect(
		fetcher.mock.calls.filter(([path]) => String(path).endsWith("/progress")),
	).toHaveLength(0);
	video.currentTime = 10;
	fireEvent.seeked(video);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					String(path).endsWith("/progress") &&
					JSON.parse(String(init?.body)).positionMs === 10000,
			),
		).toBe(true),
	);
	video.currentTime = 0;
	fireEvent.seeked(video);
	video.currentTime = 2;
	fireEvent.seeked(video);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					String(path).endsWith("/progress") &&
					JSON.parse(String(init?.body)).generation === 1 &&
					JSON.parse(String(init?.body)).positionMs === 2000,
			),
		).toBe(true),
	);
});

test("normal navigation saves in the background, then releases the session", async () => {
	const implementation = fetcher.getMockImplementation();
	let resolveSave: ((value: Response) => void) | undefined;
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress"))
			return new Promise<Response>((resolve) => {
				resolveSave = resolve;
			});
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.click(screen.getByRole("link", { name: "Back to files" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	await waitFor(() => expect(resolveSave).toBeDefined());
	await act(async () =>
		resolveSave?.(
			json({
				status: "saved",
				progress: {
					positionMs: 15000,
					durationMs: 100000,
					generation: 1,
					lastSequence: 1,
					lastViewedAtMs: 1,
				},
			}),
		),
	);
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					path === "/api/playback/sessions/session-token" &&
					init?.method === "DELETE",
			),
		).toBe(true),
	);
});

test("playback session errors show a Toast and retry without unloading the video", async () => {
	const implementation = fetcher.getMockImplementation();
	const notify = vi.spyOn(toast, "add");
	let rejectSession = true;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/playback/sessions" && rejectSession)
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_UNAVAILABLE",
							message: "Unavailable",
							requestId: "id",
						},
					},
					503,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1", true);
	await screen.findByText(
		"Playback progress is unavailable. You can keep watching and retry later.",
		{ selector: "[data-slot=toast-title]" },
	);
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(notify).toHaveBeenCalledTimes(1);
	rejectSession = false;
	const retry = screen.getByText("Retry", {
		selector: "[data-slot=toast-action]",
	});
	act(() => retry.focus());
	fireEvent.click(retry);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) => url === "/api/playback/sessions"),
		).toHaveLength(2),
	);
	await waitFor(() =>
		expect(
			screen.queryByText(
				"Playback progress is unavailable. You can keep watching and retry later.",
				{ selector: "[data-slot=toast-title]" },
			),
		).toBeNull(),
	);
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
});

test("progress save failures notify once across online and manual retries until recovery", async () => {
	const implementation = fetcher.getMockImplementation();
	const notify = vi.spyOn(toast, "add");
	let rejectSave = true;
	let networkFailure = false;
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress") && rejectSave && networkFailure)
			return Promise.reject(new TypeError("Lost connection"));
		if (String(input).endsWith("/progress") && rejectSave)
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_PERSISTENCE_FAILED",
							message: "Failed",
							requestId: "id",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.seeked(video);
	await screen.findByText(
		"Playback progress has not synced. Retrying automatically.",
		{ selector: "[data-slot=toast-title]" },
	);
	expect(notify).toHaveBeenCalledTimes(1);
	fireEvent.pause(video);
	await act(async () => {});
	expect(notify).toHaveBeenCalledTimes(1);
	networkFailure = true;
	fireEvent(window, new Event("online"));
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) => String(url).endsWith("/progress")),
		).toHaveLength(2),
	);
	await act(async () => {});
	expect(notify).toHaveBeenCalledTimes(1);
	rejectSave = false;
	const retry = screen.getByText("Retry", {
		selector: "[data-slot=toast-action]",
	});
	act(() => retry.focus());
	fireEvent.click(retry);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) => String(url).endsWith("/progress")),
		).toHaveLength(3),
	);
	const writes = fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/progress"),
	);
	expect(JSON.parse(String(writes[1]?.[1]?.body))).toEqual(
		JSON.parse(String(writes[0]?.[1]?.body)),
	);
	await waitFor(() =>
		expect(
			screen.queryByText(
				"Playback progress has not synced. Retrying automatically.",
				{ selector: "[data-slot=toast-title]" },
			),
		).toBeNull(),
	);
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
});

test("hiding the page flushes current progress with keepalive without replacing the video", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 22;
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	fireEvent(document, new Event("visibilitychange"));
	await waitFor(() => {
		const write = fetcher.mock.calls.find(([url]) =>
			String(url).endsWith("/progress"),
		);
		expect(write?.[1]?.keepalive).toBe(true);
		expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
			positionMs: 22000,
		});
	});
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
});

test("failed final saves do not show session messages or block navigation", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress"))
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_PERSISTENCE_FAILED",
							message: "Failed",
							requestId: "id",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.click(screen.getByRole("link", { name: "Back to files" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(
		screen.queryByText(
			"Playback progress has not synced. Retrying automatically.",
		),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
});
