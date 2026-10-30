// @vitest-environment happy-dom

import { expect, test, vi } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, file, json, requiredFetch } from "../support/state.js";

setupAppTest();

test("single-version anime rows reuse Files commands without leaving detail or opening playback", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing fixture episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp("/anime/work-1?library=%2F%3Fquery%3DFrieren");
	const play = await screen.findByRole("link", { name: "Play: Episode 1" });
	expect(play.getAttribute("href")).toContain("version=source-v1");
	expect(play.getAttribute("href")).toContain("episode=ep-1");
	expect(play.getAttribute("href")).toContain("library=%2F%3Fquery%3DFrieren");
	await screen.findByRole("button", {
		name: "This browser reports support for this file.",
	});
	fireEvent.click(screen.getByRole("button", { name: "File actions" }));
	for (const name of [
		"Copy media link",
		"Download video",
		"Download playlist (.m3u)",
		"Pre-transcode",
	]) {
		expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
	}
	expect(
		screen.getByRole("menuitem", { name: /Open in external player/ }),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("menuitem", { name: "Copy media link" }));
	await screen.findByText(/Link copied/);
	expect(copy).toHaveBeenCalledWith(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.getByTestId("location").textContent).toContain("/anime/work-1");
	expect(
		fetcher.mock.calls.some(([url]) => url === "/api/playback/sessions"),
	).toBe(false);
	expect(
		fetcher.mock.calls.some(([url]) =>
			String(url).includes("compatibility?sourceVersion=source-v1"),
		),
	).toBe(true);
});

test("multi-version menus act on the chosen file and omit unavailable file actions", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	const first = episode?.versions[0];
	if (!episode || !first) throw Error("Missing versions");
	episode.versions = [
		first,
		{
			...first,
			sourceId: "source-2",
			fileId: "file-2",
			sourceVersion: "source-v2",
			relativePath: "release-two/episode.mkv",
		},
		{ ...first, sourceId: "source-3", fileId: "file-3", available: false },
	];
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/files/file-2/compatibility")) {
			const response = await fallback(path.replace("file-2", "file-1"), init);
			return json({ ...(await response.json()), fileId: "file-2" });
		}
		if (path === "/api/files/file-2")
			return json({
				...file,
				file: { ...file.file, id: "file-2" },
				originalMediaUrl: "/api/media/file-2",
			});
		if (path === "/api/media/file-2/access-link")
			return json({
				url: "/api/media/file-2?access_token=second-token",
				expiresAt: Date.now() + 86400000,
			});
		return fallback(input, init);
	});
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp("/anime/work-1");
	fireEvent.click(
		await screen.findByRole("button", { name: "Play: Episode 1" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: /Choose a file version/,
	});
	const chosen = within(dialog)
		.getByText("release-two/episode.mkv")
		.closest("li");
	if (!chosen) throw Error("Missing chosen version row");
	expect(
		within(dialog).getAllByRole("button", { name: "File actions" }),
	).toHaveLength(2);
	expect(
		within(chosen).getByRole("link", { name: "Play" }).getAttribute("href"),
	).toContain("version=source-v2");
	await waitFor(() =>
		expect(
			within(chosen).getByRole("button", {
				name: "This browser reports support for this file.",
			}),
		).toBeTruthy(),
	);
	fireEvent.click(within(chosen).getByRole("button", { name: "File actions" }));
	expect(
		(
			await screen.findByRole("menuitem", { name: "Show in Files" })
		).getAttribute("href"),
	).toBe("/files/file-2/locate");
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Copy media link" }),
	);
	await waitFor(() =>
		expect(copy).toHaveBeenCalledWith(
			`${window.location.origin}/api/media/file-2?access_token=second-token`,
		),
	);
	expect(
		fetcher.mock.calls.some(([url]) =>
			String(url).includes("file-3/compatibility"),
		),
	).toBe(false);
});

test("a changed Catalog source disables its file menu while preserving the version-pinned Web link", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) =>
		String(input).includes("compatibility?sourceVersion=source-v1")
			? json(
					{
						error: {
							code: "PLAYBACK_CONFLICT",
							message: "Source changed",
							requestId: "fixture",
						},
					},
					409,
				)
			: fallback(input, init),
	);
	renderApp("/anime/work-1");
	await screen.findByRole("button", {
		name: "Compatibility could not be checked. You can retry or try the original file.",
	});
	expect(
		screen.getByRole<HTMLButtonElement>("button", { name: "File actions" })
			.disabled,
	).toBe(true);
	expect(
		screen.getByRole("link", { name: "Play: Episode 1" }).getAttribute("href"),
	).toContain("version=source-v1");
});

test("anime file actions locate and focus the file in its parent directory without starting playback", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	renderApp("/anime/work-1");
	fireEvent.click(await screen.findByRole("button", { name: "File actions" }));
	const action = await screen.findByRole("menuitem", { name: "Show in Files" });
	expect(action.getAttribute("href")).toBe("/files/file-1/locate");
	fireEvent.click(action);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/season-1",
		),
	);
	const row = (
		await screen.findByRole("link", { name: "Episode 01.mp4" })
	).closest("li");
	expect(row?.id).toBe("file-file-1");
	expect(document.activeElement).toBe(row);
	expect(
		fetcher.mock.calls.some(
			([url]) => String(url) === "/api/playback/sessions",
		),
	).toBe(false);
});
