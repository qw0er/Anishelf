// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { queryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
import { animeFixture } from "./fixtures/anime.js";
import { act, fireEvent, screen, waitFor, within } from "./query-test-utils.js";
import {
	appFixture,
	fetcher,
	file,
	json,
	mockAnime,
	playbackTitleFixture,
	renderApp,
	requiredFetch,
} from "./support/app-fixture.js";
import { trackingProvider } from "./tracking-fixture.js";

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

test("history displays saved progress and opens the player with its directory context", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/history")
			return Promise.resolve(
				json({
					availability: "checked",
					items: [
						{
							file: file.file,
							progress: {
								positionMs: 40000,
								durationMs: 100000,
								lastViewedAtMs: 1000,
								generation: 1,
								lastSequence: 1,
							},
						},
					],
				}),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/history");
	await screen.findByRole("heading", { name: "Playback history" });
	expect(screen.getByText("0:40 / 1:40")).toBeTruthy();
	fireEvent.click(screen.getByRole("link", { name: "Resume: Episode 01.mp4" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.getByTestId("location").textContent).toContain(
		"/files/file-1?directory=season-1",
	);
});

test.each(["checked", "unknown"])(
	"history explains its %s empty state",
	async (availability) => {
		const implementation = fetcher.getMockImplementation();
		fetcher.mockImplementation((input, init) => {
			if (String(input) === "/api/history")
				return Promise.resolve(json({ availability, items: [] }));
			if (!implementation) throw new Error("Missing mock");
			return implementation(input, init);
		});
		renderApp("/history");
		await screen.findByText(
			availability === "unknown"
				? "Scan your library to check which watched files are available."
				: "No playback history yet. Watch a file from your library to see it here.",
		);
	},
);

test("file rows offer a dropdown menu for copying without opening playback", async () => {
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp();
	await screen.findByRole("link", { name: "Season 1" });
	expect(screen.queryByRole("button", { name: "Copy media link" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Season 1" }));
	await screen.findByRole("button", {
		name: "This browser reports support for this file.",
	});
	const trigger = await screen.findByRole("button", { name: "File actions" });
	fireEvent.click(trigger);
	const button = await screen.findByRole("menuitem", {
		name: "Copy media link",
	});
	expect(button.closest("a")).toBeNull();
	fireEvent.click(button);
	await screen.findByText(/Link copied/);
	expect(copy).toHaveBeenCalledWith(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	expect(
		fetcher.mock.calls.some(([url]) => url === "/api/playback/sessions"),
	).toBe(false);
});

test("supported media shows compatibility information in a dialog below the player", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(
		screen.queryByText("This browser reports support for this file."),
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "More playback options" }),
	);
	const trigger = await screen.findByRole("menuitem", {
		name: "Playback compatibility info",
	});
	expect(
		video.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	fireEvent.click(trigger);
	const dialog = await screen.findByRole("dialog", {
		name: "Playback compatibility",
	});
	expect(
		within(dialog).getByRole("region", { name: "Current playback" }),
	).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("unsupported media displays a preparation hint without opening a modal or creating work", async () => {
	appFixture.compatibilityStatus = "unsupported";
	renderApp("/files/file-1");
	await screen.findByText(
		"No available version has confirmed playback support for the selected audio. Choose a version to try or prepare a copy.",
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	const call = fetcher.mock.calls.find(
		([path, init]) =>
			path === "/api/playback/selection" && init?.method === "POST",
	);
	expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
		sourceVersion: "version",
		evidence: [
			{ assetId: "file-1", descriptionId: "a".repeat(64), evidence: [] },
		],
	});
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				String(url).includes("/preparations") && init?.method === "POST",
		),
	).toBe(false);
});

test("unknown media keeps an explicit original attempt and manual compatibility details", async () => {
	appFixture.compatibilityStatus = "unknown";
	renderApp("/files/file-1");
	await screen.findByText(
		"No available version has confirmed playback support for the selected audio. Choose a version to try or prepare a copy.",
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try original file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	fireEvent.click(
		screen.getByRole("button", { name: "More playback options" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", {
			name: "Playback compatibility info",
		}),
	);
	await screen.findByRole("dialog", { name: "Playback compatibility" });
});

test("unavailable original inspection remains explicitly playable without manufactured codec facts", async () => {
	appFixture.inspectionAvailable = false;
	appFixture.compatibilityStatus = "unknown";
	renderApp("/files/file-1");
	await screen.findByRole("heading", { name: "Unable to play this video" });
	fireEvent.click(screen.getByRole("button", { name: "Try original file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
});

test("unsupported file uses a ready transcode automatically without a terminal task panel", async () => {
	appFixture.compatibilityStatus = "unsupported";
	appFixture.preparationTasks = [
		{
			id: "prepared-task",
			fileId: file.file.id,
			filename: file.file.name,
			sourceVersion: "version",
			profileId: "builtin:web",
			mode: "remux",
			reasons: { video: "copy", audio: "copy" },
			status: "ready",
			playbackAvailability: "ready",
			progress: null,
			failureReason: null,
			createdAtMs: 1,
			updatedAtMs: 1,
			artifactId: "artifact",
			resource: {
				delivery: "file" as const,
				url: "/api/prepared-media/artifact",
				mimeType: "video/mp4",
				timeline: {
					sourceOriginMs: 0,
					mediaOriginMs: 0,
					sourceDurationMs: null,
				},
			},
			sizeBytes: 100,
		},
	];
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await waitFor(() =>
		expect(video.getAttribute("src")).toBe("/api/prepared-media/artifact"),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(
		screen.queryByRole("complementary", { name: "Transcoding tasks" }),
	).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Files" }));
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(
		screen.queryByRole("complementary", { name: "Transcoding tasks" }),
	).toBeNull();
	expect(screen.queryByRole("link", { name: "Media preparation" })).toBeNull();
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				String(url).includes("/preparations") && init?.method === "POST",
		),
	).toBe(false);
});

test("file menu preserves manual copy fallback after closing", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
		new Error("Clipboard unavailable"),
	);
	renderApp("/directories/season-1");
	fireEvent.click(await screen.findByRole("button", { name: "File actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Copy media link" }),
	);
	const field = await screen.findByRole("textbox", { name: "Media link" });
	expect((field as HTMLInputElement).value).toBe(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.queryByRole("menu")).toBeNull();
});

test.each([
	["/files/file-1", "Local Frieren — Episode 1, Episode 2"],
	["/files/file-1?anime=work-1&episode=episode-2", "Local Frieren — Episode 2"],
])(
	"matched playback titles use work and mapped numbering: %s",
	async (path, title) => {
		const fallback = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (input, init) =>
			String(input) === "/api/catalog/sources/file-1"
				? json(playbackTitleFixture())
				: requiredFetch(fallback)(input, init),
		);
		renderApp(path);
		await screen.findByRole("heading", { name: title });
		await screen.findByLabelText(`Video: ${title}`);
	},
);

test("late title corrections update the existing video without restarting playback", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await act(async () => {
		queryClient.setQueriesData(
			{
				queryKey: ["catalog"],
				predicate: (query) => query.queryKey[2] === "source",
			},
			playbackTitleFixture(),
		);
	});
	await screen.findByRole("heading", {
		name: "Local Frieren — Episode 1, Episode 2",
	});
	expect(
		screen.getByLabelText("Video: Local Frieren — Episode 1, Episode 2"),
	).toBe(video);
});

test.each(["version-old", "unavailable"])(
	"unmatched or stale catalog data preserves filename: %s",
	async (status) => {
		const fallback = requiredFetch(fetcher.getMockImplementation());
		fetcher.mockImplementation(async (input, init) => {
			if (String(input) !== "/api/catalog/sources/file-1")
				return fallback(input, init);
			return status === "unavailable"
				? json(
						{ error: { code: "CATALOG_UNAVAILABLE", message: "Offline" } },
						503,
					)
				: json({ ...playbackTitleFixture(), sourceVersion: status });
		});
		renderApp("/files/file-1");
		await screen.findByLabelText("Video: Episode 01.mp4");
		expect(
			screen.getByRole("heading", { name: "Episode 01.mp4" }),
		).toBeTruthy();
	},
);

test.each([0, 2])(
	"local detail keeps progress in its header and only shows positive unwatched hints (progress %s)",
	async (progress) => {
		mockAnime(animeFixture());
		const fallback = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (input, init) => {
			const path = String(input);
			if (path === "/api/tracking/account")
				return json({
					provider: trackingProvider,
					generation: "header-viewing",
					account: { id: "anilist:7", name: "Fixture" },
					state: "connected",
					connectivity: "available",
					checkedAt: 0,
				});
			if (path.startsWith("/api/tracking/entries/anilist%3Aanime%3A154587?"))
				return json({
					provider: trackingProvider,
					accountId: "anilist:7",
					generation: "header-viewing",
					state: "connected",
					fetchedAt: 1000,
					stale: false,
					refreshing: false,
					error: null,
					entry: {
						id: 1,
						mediaId: 154587,
						progress,
						status: "watching",
						updatedAt: 1,
						titles: ["Frieren"],
						format: "TV",
						year: 2023,
						episodeCount: 3,
						coverUrl: null,
					},
				});
			return requiredFetch(fallback)(input, init);
		});
		renderApp("/anime/work-1");
		const title = await screen.findByRole("heading", {
			name: "Frieren",
			level: 1,
		});
		const header = title.parentElement;
		if (!header) throw new Error("Missing title header");
		const summary = await within(header).findByRole("region", {
			name: "the tracking service viewing state",
		});
		await within(summary).findByText(`${progress} / 3 episodes`);
		expect(screen.queryByText(/AniList progress: 2 watched/)).toBeNull();
		expect(screen.queryByText(/0 unwatched available/)).toBeNull();
		if (progress === 2) {
			expect(screen.getAllByText("Watched")).toHaveLength(2);
			expect(screen.getByText("Unwatched")).toBeTruthy();
			expect(
				screen.queryByRole("button", {
					name: "About available unwatched episodes",
				}),
			).toBeNull();
		} else {
			expect(screen.queryByText("Watched")).toBeNull();
			expect(screen.getAllByText("Unwatched")).toHaveLength(3);
			const hint = screen.getByRole("button", {
				name: "About available unwatched episodes",
			});
			expect(hint.textContent).toContain("1 unwatched available");
			fireEvent.click(hint);
			await screen.findByText(
				"Locally available episodes numbered after your cumulative the tracking service progress. Local playback history is separate.",
			);
		}
		expect(within(summary).getByText("Watching")).toBeTruthy();
		expect(within(summary).queryByRole("heading")).toBeNull();
		expect(
			within(summary).queryByText(/separate from local playback history/),
		).toBeNull();
		expect(
			screen.getAllByRole("region", {
				name: "the tracking service viewing state",
			}),
		).toHaveLength(1);
	},
);

test.each(["source-v1", "older-source"])(
	"anime details read prepared summaries before opening menus and isolate %s",
	async (sourceVersion) => {
		const detail = animeFixture();
		const episode = detail.episodes[0];
		if (!episode) throw Error("Missing episode");
		episode.versions = episode.versions.slice(0, 1);
		appFixture.compatibilityStatus = "unsupported";
		mockAnime(detail);
		const fallback = requiredFetch(fetcher.getMockImplementation());
		fetcher.mockImplementation(async (input, init) =>
			String(input) === "/api/preparations/summaries"
				? json({
						files: [
							{
								fileId: "file-1",
								versions: [
									{ sourceVersion, publishedCopies: 1, pendingTasks: 0 },
								],
							},
						],
					})
				: fallback(input, init),
		);
		renderApp("/anime/work-1");
		const label =
			sourceVersion === "source-v1"
				? "Pre-transcoded copy published."
				: "This file is not supported by this browser.";
		const status = await screen.findByRole("button", { name: label });
		const menu = screen.getByRole("button", { name: "File actions" });
		const play = screen.getByRole("link", { name: "Play: Episode 1" });
		expect(
			status.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			menu.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			fetcher.mock.calls.filter(
				([url]) => url === "/api/preparations/summaries",
			),
		).toHaveLength(1);
		expect(
			fetcher.mock.calls.some(
				([url]) =>
					String(url).startsWith("/api/preparations?") &&
					String(url).includes("fileId="),
			),
		).toBe(false);
		if (sourceVersion === "source-v1")
			expect(
				screen.queryByRole("button", {
					name: "This file is not supported by this browser.",
				}),
			).toBeNull();
	},
);
