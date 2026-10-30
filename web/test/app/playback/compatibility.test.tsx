// @vitest-environment happy-dom

import { expect, test } from "vitest";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { appFixture, fetcher, file } from "../support/state.js";

setupAppTest();

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
