import { expect, test, vi } from "vitest";
import type { DesktopBridge } from "../src/ipc/desktop.js";
import { createDesktopExternalPlayers } from "../src/renderer/platform/external-players.js";

type CatalogResponse = Awaited<
	ReturnType<DesktopBridge["listExternalPlayers"]>
>;
test("reloads the catalog after removing a player and notifies current subscribers", async () => {
	const empty: CatalogResponse = { players: [], presets: [], error: false };
	const player = {
		id: "player:test",
		name: "Test",
		executable: "mpv",
		args: ["{url}"],
	};
	const listExternalPlayers = vi
		.fn(async () => empty)
		.mockResolvedValueOnce({ ...empty, players: [player] });
	const removeExternalPlayer = vi.fn(async () => {});
	const host = await createDesktopExternalPlayers({
		listExternalPlayers,
		addExternalPlayer: vi.fn(),
		removeExternalPlayer,
		launchExternalPlayer: vi.fn(),
	});
	expect(host.list().custom).toEqual([{ ...player, kind: "command" }]);
	const listener = vi.fn();
	const unsubscribe = host.subscribe(listener);
	const remove = host.remove;
	await remove(player.id);

	expect(removeExternalPlayer).toHaveBeenCalledWith(player.id);
	expect(host.list().custom).toEqual([]);
	expect(listener).toHaveBeenCalledTimes(1);
	unsubscribe();
	await remove(player.id);
	expect(listener).toHaveBeenCalledTimes(1);
});
