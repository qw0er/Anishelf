// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import {
	detectClientPlatform,
	externalPlayerPolicy,
	presetsForPlatform,
} from "../src/config/external-player-policy.js";
import { PlaybackActionsMenu } from "../src/features/playback/components/external-player-menu.js";
import { ExternalPlayerSettings } from "../src/features/playback/components/external-player-settings.js";
import {
	buildPlayerUrl,
	readCustomPlayers,
	validPlayerTemplate,
} from "../src/features/playback/external-players.js";
import { useExternalPlayers } from "../src/features/playback/hooks/use-external-players.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/i18n.js";

const file = {
	file: {
		kind: "file" as const,
		id: "file_123",
		parentId: "root",
		name: "Episode.mp4",
		sizeBytes: 10,
		modifiedAt: "date",
		mimeType: "video/mp4",
	},
	originalMediaUrl: "/api/media/file_123",
};
beforeEach(() => {
	localStorage.clear();
	vi.spyOn(api, "getFile").mockResolvedValue(file);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
	vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

test.each([
	[
		{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 },
		"macos",
		["IINA", "Infuse", "mpv"],
	],
	[{ userAgent: "Linux X11" }, "linux", ["mpv"]],
	[{ userAgent: "Windows NT 10.0" }, "windows", ["mpv"]],
	[
		{ userAgent: "Linux Android" },
		"android",
		["VLC", "MX Player", "mpv-android"],
	],
	[{ userAgent: "iPhone" }, "ios", ["Infuse", "VLC", "Outplayer"]],
	[
		{ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
		"ios",
		["Infuse", "VLC", "Outplayer"],
	],
	[{ userAgent: "unrecognized" }, "unknown", []],
] as const)(
	"detects platform and filters presets for %j",
	(client, platform, names) => {
		expect(detectClientPlatform(client)).toBe(platform);
		expect(presetsForPlatform(platform).map((p) => p.name)).toEqual(names);
	},
);

test("all presets are valid and Android receives the original URL and media type", () => {
	for (const preset of externalPlayerPolicy.presets)
		expect(validPlayerTemplate(preset.template)).toBe(true);
	const template =
		presetsForPlatform("android").find((p) => p.id === "mpv-android")
			?.template ?? "";
	expect(
		buildPlayerUrl(
			template,
			"https://example.test/api/media/file_123",
			"video/x-matroska",
		),
	).toBe(
		"intent:https://example.test/api/media/file_123#Intent;action=android.intent.action.VIEW;package=is.xyz.mpv;type=video/x-matroska;end",
	);
});

test("substitution preserves reserved characters without recursively expanding the URL", () => {
	const media = "https://example.test/api/media/id?a=1&b=%25";
	const result = buildPlayerUrl(
		"infuse://x-callback-url/play?url={urlEncoded}",
		media,
		"video/mp4",
	);
	expect(new URL(result).searchParams.get("url")).toBe(media);
	expect(buildPlayerUrl("mpv://{url}", media, "video/mp4")).toBe(
		`mpv://${media}`,
	);
	expect(
		buildPlayerUrl(
			"intent:{url}#Intent;type={mimeType};end",
			media,
			"video/mp4;evil",
		),
	).toContain("type=video/*;end");
});

test.each([
	"javascript:{url}",
	"data:{url}",
	"file://{url}",
	"https://example.test/{url}",
	"custom://constant",
	"custom://{unknown}",
	"custom://{url}\nnext",
	"custom://{urlEncoded}{oops}",
])("rejects unsafe or malformed template %s", (template) => {
	expect(validPlayerTemplate(template)).toBe(false);
});

test("rejects malformed and duplicate persisted entries without overwriting them", () => {
	const raw = JSON.stringify([
		{ id: "custom:1", name: "Bad", template: "javascript:{url}" },
	]);
	localStorage.setItem(externalPlayerPolicy.storageKey, raw);
	expect(() => readCustomPlayers(localStorage)).toThrow();
	expect(localStorage.getItem(externalPlayerPolicy.storageKey)).toBe(raw);
	const entry = { id: "custom:1", name: "Test", template: "test://{url}" };
	localStorage.setItem(
		externalPlayerPolicy.storageKey,
		JSON.stringify([entry, entry]),
	);
	expect(() => readCustomPlayers(localStorage)).toThrow();
});

test("Settings adds and deletes persistent custom players, updating mounted consumers", async () => {
	const consumer = renderHook(useExternalPlayers);
	const view = render(<ExternalPlayerSettings />);
	fireEvent.change(screen.getByLabelText("Player name"), {
		target: { value: "My player" },
	});
	fireEvent.change(screen.getByLabelText("URL template"), {
		target: { value: "myplayer://open?url={urlEncoded}" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Add player" }));
	await screen.findByText("My player");
	expect(consumer.result.current.players).toHaveLength(1);
	expect(readCustomPlayers(localStorage)[0]?.name).toBe("My player");
	view.unmount();
	render(<ExternalPlayerSettings />);
	expect(screen.getByText("My player")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Delete My player" }));
	await waitFor(() => expect(consumer.result.current.players).toHaveLength(0));
	expect(readCustomPlayers(localStorage)).toEqual([]);
});

test("storage events refresh consumers and failed writes keep the existing data", () => {
	const consumer = renderHook(useExternalPlayers);
	const entry = { id: "custom:1", name: "Test", template: "test://{url}" };
	localStorage.setItem(
		externalPlayerPolicy.storageKey,
		JSON.stringify([entry]),
	);
	act(() =>
		window.dispatchEvent(
			new StorageEvent("storage", { key: externalPlayerPolicy.storageKey }),
		),
	);
	expect(consumer.result.current.players).toEqual([entry]);
	const storage = window.localStorage;
	vi.spyOn(window, "localStorage", "get").mockReturnValue({
		getItem: storage.getItem.bind(storage),
		length: storage.length,
		clear: storage.clear.bind(storage),
		key: storage.key.bind(storage),
		removeItem: storage.removeItem.bind(storage),
		setItem: () => {
			throw new Error("Quota");
		},
	} as Storage);
	expect(() => consumer.result.current.remove(entry.id)).toThrow();
	expect(consumer.result.current.players).toEqual([entry]);
});

test("menu prepares native anchors for detected presets and custom players without progress writes", async () => {
	localStorage.setItem(
		externalPlayerPolicy.storageKey,
		JSON.stringify([
			{ id: "custom:1", name: "My player", template: "custom://{urlEncoded}" },
		]),
	);
	const open = vi.spyOn(api, "openPlaybackSession");
	const save = vi.spyOn(api, "savePlaybackProgress");
	render(<PlaybackActionsMenu fileId="file_123" />);
	expect(api.getFile).not.toHaveBeenCalled();
	fireEvent.click(
		screen.getByRole("button", { name: "More playback options" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Open in external player" }),
	);
	const item = await screen.findByRole("menuitem", { name: "IINA" });
	await waitFor(() =>
		expect(item.getAttribute("href")).toBe(
			`iina://open?url=${encodeURIComponent(`${window.location.origin}/api/media/file_123`)}`,
		),
	);
	expect(
		screen.getByRole("menuitem", { name: "My player" }).getAttribute("href"),
	).toBe(
		`custom://${encodeURIComponent(`${window.location.origin}/api/media/file_123`)}`,
	);
	expect(screen.queryByRole("menuitem", { name: "MX Player" })).toBeNull();
	expect(open).not.toHaveBeenCalled();
	expect(save).not.toHaveBeenCalled();
});

test("failed media validation disables handoff and retry rechecks access", async () => {
	vi.mocked(api.getFile).mockResolvedValue({
		...file,
		originalMediaUrl: "https://evil.test/media",
	});
	render(<PlaybackActionsMenu fileId="file_123" />);
	fireEvent.click(
		screen.getByRole("button", { name: "More playback options" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Open in external player" }),
	);
	await screen.findByRole("menuitem", { name: "Retry" });
	expect(
		screen.getByRole("menuitem", { name: "IINA" }).getAttribute("href"),
	).toBeNull();
	vi.mocked(api.getFile).mockResolvedValue(file);
	fireEvent.click(screen.getByRole("menuitem", { name: "Retry" }));
	await waitFor(() =>
		expect(
			screen.getByRole("menuitem", { name: "IINA" }).getAttribute("href"),
		).toContain("iina://"),
	);
});
