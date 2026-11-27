import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
} from "@playwright/test";
import {
	animeDetailFixture,
	animeFixture,
} from "../packages/client-ui/test/fixtures/anime.js";
import { offlineCue, repository, sampleName, test } from "./fixtures.mts";
import {
	player,
	position,
	selectSubtitle,
	startPlayback,
	waitForPlayer,
} from "./playback-helpers.mts";

test.use({ media: "offline", hostWeb: false });

declare global {
	interface Window {
		mediaSessionProbe: {
			position: MediaPositionState | null;
			actions: Map<MediaSessionAction, MediaSessionActionHandler>;
		};
	}
}

function expectMediaSession(
	page: Page,
	state: MediaSessionPlaybackState,
	title: string | null,
) {
	return expect
		.poll(() =>
			page.evaluate(() => ({
				state: navigator.mediaSession.playbackState,
				title: navigator.mediaSession.metadata?.title ?? null,
			})),
		)
		.toEqual({ state, title });
}

async function stubAnimeArtwork(
	page: Page,
	origin: string,
	fileLink: string | null,
) {
	const id = /\/files\/([^/?]+)/.exec(fileLink ?? "")?.[1];
	if (!id) throw new Error("The playback fixture is missing its file ID.");
	const sourceUrl = new URL(`/api/catalog/sources/${id}`, origin).href;
	const source = await page.evaluate(async (url) => {
		const response = await fetch(url, { credentials: "omit" });
		if (!response.ok)
			throw new Error(`Catalog source failed with ${response.status}.`);
		return response.json();
	}, sourceUrl);
	const detail = animeFixture();
	const { work } = detail;
	const headers = { "access-control-allow-origin": "anishelf://desktop" };
	await page.route(sourceUrl, (route) =>
		route.fulfill({
			headers,
			json: {
				...source,
				associations: [
					{
						workId: work.id,
						workTitle: work.displayTitle,
						episodeId: "desktop-fixture-episode",
						kind: "special",
						number: "1",
						label: "Special 1",
					},
				],
			},
		}),
	);
	await page.route(`**/api/anime/details/local/${work.id}`, (route) =>
		route.fulfill({ headers, json: animeDetailFixture(detail) }),
	);
	await page.route(`**${work.coverUrl}`, (route) =>
		route.fulfill({
			headers,
			path: join(repository, "apps/web/public/icon-192.png"),
		}),
	);
	return `${work.displayTitle} — Special 1`;
}

function expectArtwork(page: Page, scheme: string, size: number) {
	return expect
		.poll(() =>
			page.evaluate(async (scheme) => {
				const artwork = navigator.mediaSession.metadata?.artwork[0];
				if (!artwork?.src.startsWith(scheme)) return null;
				const image = new Image();
				image.src = artwork.src;
				await image.decode();
				return { width: image.naturalWidth, height: image.naturalHeight };
			}, scheme),
		)
		.toEqual({ width: size, height: size });
}

function captureMediaSession(page: Page) {
	return page.evaluate(() => {
		const media = navigator.mediaSession;
		const setActionHandler = media.setActionHandler.bind(media);
		const setPositionState = media.setPositionState.bind(media);
		const probe: Window["mediaSessionProbe"] = {
			position: null,
			actions: new Map(),
		};
		window.mediaSessionProbe = probe;
		media.setActionHandler = (action, handler) => {
			setActionHandler(action, handler);
			if (handler) probe.actions.set(action, handler);
			else probe.actions.delete(action);
		};
		media.setPositionState = (position) => {
			setPositionState(position);
			probe.position = position ?? null;
		};
	});
}

function sendMediaAction(page: Page, detail: MediaSessionActionDetails) {
	return page.evaluate((detail) => {
		const handler = window.mediaSessionProbe.actions.get(detail.action);
		if (!handler) throw new Error(`Missing media action: ${detail.action}`);
		handler(detail);
	}, detail);
}

async function captureDisplayBlocker(app: ElectronApplication) {
	const probe = await app.evaluateHandle(({ powerSaveBlocker }) => {
		const start = powerSaveBlocker.start.bind(powerSaveBlocker);
		let blockerId: number | undefined;
		powerSaveBlocker.start = (type) => {
			const id = start(type);
			if (type === "prevent-display-sleep") blockerId = id;
			return id;
		};
		return () =>
			blockerId !== undefined && powerSaveBlocker.isStarted(blockerId);
	});
	return (active: boolean) =>
		expect.poll(() => probe.evaluate((isActive) => isActive())).toBe(active);
}

function emitPowerEvent(
	app: ElectronApplication,
	event: "suspend" | "lock-screen" | "resume",
) {
	return app.evaluate(
		({ powerMonitor }, event) => powerMonitor.emit(event),
		event,
	);
}

test("plays a cached video and sidecar after a restart with the server stopped", async ({
	backend,
}) => {
	test.setTimeout(90_000);
	const profile = join(backend.directory, "desktop");
	await mkdir(profile);
	await writeFile(join(profile, "server-origin"), backend.origin);
	const launch = () =>
		electron.launch({
			args: [
				join(repository, "apps/desktop"),
				`--user-data-dir=${profile}`,
				"--lang=en-US",
			],
			// Use the source build even when the caller has a desktop dev session.
			env: { ...process.env, ANISHELF_DESKTOP_DEV: "0" },
		});

	const online = await launch();
	try {
		const window = await online.firstWindow();
		const expectDisplayBlocker = await captureDisplayBlocker(online);
		await window.getByLabel("Password", { exact: true }).fill(backend.password);
		await window.getByRole("button", { name: "Sign in", exact: true }).click();
		const files = window
			.getByRole("navigation", { name: "Primary navigation" })
			.getByRole("link", { name: "Files", exact: true });
		await files.click();
		const sample = window.getByRole("link", { name: sampleName, exact: true });
		const animeTitle = await stubAnimeArtwork(
			window,
			backend.origin,
			await sample.getAttribute("href"),
		);
		await sample.click();
		await waitForPlayer(window, animeTitle);
		await expectMediaSession(window, "none", null);
		await expectDisplayBlocker(false);
		await player(window, animeTitle).press("Space");
		await expectMediaSession(window, "playing", animeTitle);
		await expectDisplayBlocker(true);
		await expectArtwork(window, "blob:", 192);
		await expect
			.poll(async () => Number(await position(window, animeTitle).inputValue()))
			.toBeGreaterThan(500);
		const [saved] = await Promise.all([
			window.waitForResponse(
				(response) =>
					response.request().method() === "PUT" &&
					/\/api\/playback\/sessions\/[^/]+\/progress$/.test(response.url()),
			),
			emitPowerEvent(online, "suspend"),
		]);
		expect(saved.ok()).toBe(true);
		expect(saved.request().postDataJSON().positionMs).toBeGreaterThan(500);
		await expectMediaSession(window, "paused", animeTitle);
		await expectDisplayBlocker(false);
		await player(window, animeTitle).press("Space");
		await expect(player(window, animeTitle)).toHaveAttribute(
			"data-status",
			"playing",
		);
		await expectDisplayBlocker(true);

		const subscriptions = window.getByRole("link", {
			name: "Subscriptions",
			exact: true,
		});
		const subscriptionList = "**/api/acquisition/subscriptions/list";
		await Promise.all([
			window.waitForResponse(subscriptionList),
			subscriptions.click(),
		]);
		await expectDisplayBlocker(false);
		const currentSession = "**/api/auth/device-sessions/current";
		await window.route(currentSession, (route) => route.abort(), { times: 1 });
		const [session, refreshed] = await Promise.all([
			window.waitForResponse(currentSession),
			window.waitForResponse(subscriptionList),
			emitPowerEvent(online, "resume"),
		]);
		expect(session.ok()).toBe(true);
		expect(refreshed.ok()).toBe(true);
		await files.click();
		await expectMediaSession(window, "none", null);
		await expectDisplayBlocker(false);
		await window
			.getByRole("button", { name: "File actions", exact: true })
			.click();
		await window
			.getByRole("menuitem", { name: "Cache video", exact: true })
			.click();
		await window
			.getByRole("link", { name: "Offline cache", exact: true })
			.click();
		await expect(
			window.getByRole("link", { name: "Play", exact: true }),
		).toBeVisible();
	} finally {
		await online.close();
	}

	await backend.close();

	const offline = await launch();
	let cachedUrl: string;
	let savedPosition: number;
	try {
		const window = await offline.firstWindow();
		const expectDisplayBlocker = await captureDisplayBlocker(offline);
		await window.goto(new URL("#/offline-cache", window.url()).href);
		await expect(window.getByText(sampleName, { exact: true })).toBeVisible();
		await captureMediaSession(window);
		await window.getByRole("link", { name: "Play", exact: true }).click();
		await startPlayback(window);
		await expectMediaSession(window, "playing", sampleName);
		await expectDisplayBlocker(true);
		await expectArtwork(window, "data:", 1024);
		await selectSubtitle(window, /external/i);
		await expect(
			player(window).getByText(offlineCue, { exact: true }),
		).toBeVisible();
		const transport = player(window).locator(".lmp-transport");
		await expect(transport).toBeEnabled();
		const nativeWindow = await offline.browserWindow(window);
		await nativeWindow.evaluate((window) => window.hide());
		await expectDisplayBlocker(false);
		await sendMediaAction(window, { action: "pause" });
		await expectMediaSession(window, "paused", sampleName);
		await expect(transport).toBeEnabled();
		await sendMediaAction(window, { action: "play" });
		await expectMediaSession(window, "playing", sampleName);
		await nativeWindow.evaluate((window) => window.show());
		await expectDisplayBlocker(true);
		await emitPowerEvent(offline, "lock-screen");
		await expectMediaSession(window, "paused", sampleName);
		await expectDisplayBlocker(false);
		await expect(transport).toHaveAttribute("aria-label", "Play");
		await expect(transport).toBeEnabled();
		await sendMediaAction(window, { action: "seekto", seekTime: 12 });
		await expect
			.poll(async () => Number(await position(window).inputValue()))
			.toBeGreaterThan(10_000);
		await expect(transport).toBeEnabled();
		savedPosition = Number(await position(window).inputValue());
		await expect
			.poll(() => window.evaluate(() => window.mediaSessionProbe.position))
			.toEqual({
				duration: 24,
				position: savedPosition / 1000,
				playbackRate: 1,
			});
		cachedUrl = window.url();
		await window
			.getByRole("link", { name: "Back to offline cache", exact: true })
			.click();
		await expectMediaSession(window, "none", null);
		expect(
			await window.evaluate(() => ({
				position: window.mediaSessionProbe.position,
				actions: [...window.mediaSessionProbe.actions.keys()],
			})),
		).toEqual({ position: null, actions: [] });
		await expect(
			window.getByRole("link", { name: "Play", exact: true }),
		).toBeVisible();
	} finally {
		await offline.close();
	}

	const resumed = await launch();
	try {
		const window = await resumed.firstWindow();
		const expectDisplayBlocker = await captureDisplayBlocker(resumed);
		await window.goto(cachedUrl);
		await captureMediaSession(window);
		await waitForPlayer(window);
		await expect
			.poll(async () =>
				Math.abs(Number(await position(window).inputValue()) - savedPosition),
			)
			.toBeLessThanOrEqual(500);
		await startPlayback(window);
		await expectDisplayBlocker(true);
		await sendMediaAction(window, { action: "seekto", seekTime: 22 });
		await expectMediaSession(window, "none", null);
		await expectDisplayBlocker(false);
	} finally {
		await resumed.close();
	}
});
