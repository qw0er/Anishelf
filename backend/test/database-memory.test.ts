import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { resourceRootId } from "../src/modules/resources/resource-access/domain/identity.js";

test("memory databases isolate connections and discard state when closed", () => {
	const first = ApplicationDatabase.openMemory();
	const second = ApplicationDatabase.openMemory();
	const identity = {
		scopeId: resourceRootId("/media"),
		fileId: "episode",
		relativePath: "episode.mkv",
		sourceVersion: "v1",
	};
	try {
		const source = first.playback.registerSource(identity, 1);
		first.playback.save(
			{
				sourceId: source.id,
				generation: first.playback.openGeneration(source.id).generation,
				sequence: 1,
				positionMs: 45000,
				durationMs: 100000,
			},
			10,
		);
		expect(first.playback.get(source.id)?.positionMs).toBe(45000);
		expect(second.playback.get(source.id)).toBeUndefined();
	} finally {
		first.close();
		second.close();
	}
	const fresh = ApplicationDatabase.openMemory();
	try {
		const source = fresh.playback.registerSource(identity, 1);
		expect(fresh.playback.get(source.id)).toBeUndefined();
	} finally {
		fresh.close();
	}
});
