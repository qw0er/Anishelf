import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import {
	type CacheRecord,
	OfflineCacheStore,
} from "../src/main/offline-cache/store.js";

test("opens an existing offline cache index and preserves media and resume data", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-cache-index-test-"));
	try {
		const path = join(directory, "index.sqlite");
		const record: CacheRecord = {
			entry: {
				id: "cache-1",
				server: "local",
				fileId: "video",
				sourceVersion: "v1",
				name: "第一集.mkv",
				status: "ready",
				percent: 100,
				sizeBytes: 110,
				episodes: [
					{ workId: "work", workTitle: "作品", number: "1", label: "第一集" },
				],
				failure: null,
			},
			positionMs: 42000,
			manifest: {
				format: "mkv",
				video: {
					name: "video.mkv",
					size: 100,
					modifiedAt: 1234,
					mime: "video/x-matroska",
				},
				subtitles: [
					{
						id: "subtitle",
						format: "srt",
						label: "简体中文",
						language: "zh",
						file: {
							name: "subtitle-0.srt",
							size: 10,
							modifiedAt: 1234,
							mime: "text/plain",
						},
					},
				],
			},
		};
		const legacy = new DatabaseSync(path);
		try {
			legacy.exec(`
				CREATE TABLE entries (
					id TEXT PRIMARY KEY,
					server TEXT NOT NULL,
					file_id TEXT NOT NULL,
					source_version TEXT,
					data TEXT NOT NULL,
					UNIQUE(server, file_id, source_version)
				) STRICT
			`);
			legacy
				.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?)")
				.run(
					record.entry.id,
					record.entry.server,
					record.entry.fileId,
					record.entry.sourceVersion,
					JSON.stringify(record),
				);
		} finally {
			legacy.close();
		}

		const store = new OfflineCacheStore(path);
		const updated = { ...record, positionMs: 61000 };
		try {
			expect(store.list()).toEqual([record]);
			store.save(updated);
			expect(() =>
				store.save({
					...record,
					entry: { ...record.entry, id: "duplicate" },
				}),
			).toThrow(/UNIQUE constraint/);
		} finally {
			store.close();
		}

		const reopened = new OfflineCacheStore(path);
		try {
			expect(reopened.list()).toEqual([updated]);
			reopened.remove(record.entry.id);
			expect(reopened.list()).toEqual([]);
		} finally {
			reopened.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
