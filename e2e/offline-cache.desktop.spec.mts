import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import { offlineCue, repository, sampleName, test } from "./fixtures.mts";
import {
	player,
	position,
	seek,
	selectSubtitle,
	startPlayback,
	waitForPlayer,
} from "./playback-helpers.mts";

test.use({ media: "offline", hostWeb: false });

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
		await window.getByLabel("Password", { exact: true }).fill(backend.password);
		await window.getByRole("button", { name: "Sign in", exact: true }).click();
		await window
			.getByRole("navigation", { name: "Primary navigation" })
			.getByRole("link", { name: "Files", exact: true })
			.click();
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
		await window.goto(new URL("#/offline-cache", window.url()).href);
		await expect(window.getByText(sampleName, { exact: true })).toBeVisible();
		await window.getByRole("link", { name: "Play", exact: true }).click();
		await startPlayback(window);
		await selectSubtitle(window, /external/i);
		await expect(
			player(window).getByText(offlineCue, { exact: true }),
		).toBeVisible();
		const transport = player(window).locator(".lmp-transport");
		await transport.click();
		await expect(transport).toHaveAttribute("aria-label", "Play");
		await seek(window, 0.5);
		await expect
			.poll(async () => Number(await position(window).inputValue()))
			.toBeGreaterThan(10_000);
		await expect(transport).toBeEnabled();
		savedPosition = Number(await position(window).inputValue());
		cachedUrl = window.url();
		await window
			.getByRole("link", { name: "Back to offline cache", exact: true })
			.click();
		await expect(
			window.getByRole("link", { name: "Play", exact: true }),
		).toBeVisible();
	} finally {
		await offline.close();
	}

	const resumed = await launch();
	try {
		const window = await resumed.firstWindow();
		await window.goto(cachedUrl);
		await waitForPlayer(window);
		await expect
			.poll(async () =>
				Math.abs(Number(await position(window).inputValue()) - savedPosition),
			)
			.toBeLessThanOrEqual(500);
	} finally {
		await resumed.close();
	}
});
