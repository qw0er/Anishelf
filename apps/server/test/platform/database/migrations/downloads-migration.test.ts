import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import {
	DownloadContext,
	DownloadExecution,
} from "../../../../src/modules/acquisition/downloads/application/context.js";
import { DownloadTransfers } from "../../../../src/modules/acquisition/downloads/transfers/application.js";
import type { TorrentClient } from "../../../../src/modules/acquisition/torrent-clients/public.js";
import { openMigrationDatabase } from "../../../support/migration-database.js";

test("one-off migration preserves accepted subscription tasks and retains episode/hash uniqueness", async () => {
	const base = await readFile(
		new URL(
			"../../../../migrations/0000_relational_schema.sql",
			import.meta.url,
		),
		"utf8",
	);
	const table = base.match(
		/CREATE TABLE `acquisition_intents` \([\s\S]*?\n\);/,
	)?.[0];
	if (!table) throw new Error("Missing original intent schema");
	const migration = await readFile(
		new URL(
			"../../../../migrations/0018_individual_episode_downloads.sql",
			import.meta.url,
		),
		"utf8",
	);
	const db = new Database(":memory:");
	try {
		db.exec(table);
		db.exec(`INSERT INTO acquisition_intents (
 id, revision, work_key, candidate_id, episode, title, hash, source,
 destination_revision, destination_scope_id, destination_path, destination_connection_generation,
 destination_validated, destination_visibility_verified, directory, subscription_revision,
 state, ingestion, progress, attempts, next_attempt_at, updated_at, created_at, source_identity_present, last_command_present
 ) VALUES ('accepted', 'revision', 'work', 'candidate', 3, 'Release', 'hash', 'opaque-source',
 'destination', 'root', '/downloads', 'client', 1, 1, 'Anime', 'subscription',
 'bound', 'not-ready', 0.42, 1, 0, 1000, 1000, 0, 0)`);
		db.exec(migration);
		expect(
			db
				.prepare(
					"SELECT origin, one_off, subscription_revision, state, progress, source FROM acquisition_intents",
				)
				.get(),
		).toEqual({
			origin: "subscription",
			one_off: null,
			subscription_revision: "subscription",
			state: "bound",
			progress: 0.42,
			source: "opaque-source",
		});
		expect(() =>
			db.exec("UPDATE acquisition_intents SET origin = 'unknown'"),
		).toThrow();
		expect(() =>
			db.exec("UPDATE acquisition_intents SET one_off = 'broken-json'"),
		).toThrow();
		db.exec(
			"UPDATE acquisition_intents SET origin = 'one-off', subscription_revision = NULL, state = 'discovering', one_off = '{}'",
		);
		expect(
			db
				.prepare("SELECT state, subscription_revision FROM acquisition_intents")
				.get(),
		).toEqual({ state: "discovering", subscription_revision: null });
		const indexes = db
			.prepare("PRAGMA index_list(acquisition_intents)")
			.all() as { name: string; unique: number }[];
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "acquisition_episode_reservation",
					unique: 1,
				}),
				expect.objectContaining({
					name: "acquisition_hash_reservation",
					unique: 1,
				}),
			]),
		);
	} finally {
		db.close();
	}
});

test("upgrades and reopens download claims, confirmed file evidence, command receipts and uncertain owners", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-claim-upgrade-"));
	const path = join(directory, "anishelf.sqlite");
	const episodes = [
		{
			id: "discover",
			state: "discovering",
			ingestion: "not-ready",
			oneOff: true,
		},
		{ id: "submitting", state: "submitting", ingestion: "not-ready" },
		{ id: "unknown", state: "unknown", ingestion: "not-ready", oneOff: true },
		{ id: "submitted", state: "bound", ingestion: "not-ready" },
		{
			id: "available",
			state: "available",
			ingestion: "available",
			relativePath: "Series/05.mkv",
		},
		{
			id: "review",
			state: "bound",
			ingestion: "review",
			relativePath: "Series/06.mkv",
		},
		{
			id: "unsafe-evidence",
			state: "missing",
			ingestion: "available",
			relativePath: "Series/../07.mkv",
		},
		{
			id: "windows-evidence",
			state: "available",
			ingestion: "available",
			destination: "D:\\downloads",
			relativePath: "Series\\season\\08.mkv",
		},
	];
	const work = "anilist:anime:1";
	const raw = openMigrationDatabase(directory, 26);
	let database: ApplicationDatabase | undefined;
	try {
		const insert = raw.prepare(`
			INSERT INTO acquisition_intents (
				id, revision, work_key, candidate_id, episode, title, hash, source,
				destination_revision, destination_scope_id, destination_path, destination_connection_generation,
				destination_validated, destination_visibility_verified, directory, origin, one_off, subscription_revision,
				state, ingestion, transfer, progress, attempts, next_attempt_at, observed_at, updated_at, created_at,
				source_identity_present, source_identity_scope_id, source_identity_file_id, source_identity_relative_path,
				source_identity_source_version, last_command_present, last_command_id, last_command_kind, accepted_target
			) VALUES (
				@id, 'old-revision', @work, @id, @episode, 'Release', @hash, @source,
				'destination', 'root', @destination, 'client', 1, 1, 'Series', @origin, @oneOff, @subscription,
				@state, @ingestion, @transfer, @progress, 1, 5, @observedAt, 10, 7,
				@sourcePresent, 'root', @id, @relativePath, 'version', 1, 'retry-receipt', 'acquisition', @accepted
			);
		`);
		const authorization = {
			profileId: "builtin:general",
			profileFingerprint: "profile",
			sourceGeneration: "sources",
			discovery: [],
			uncertainSubmission: true,
		};
		for (const [i, item] of episodes.entries()) {
			insert.run({
				id: item.id,
				work,
				episode: i + 1,
				hash: i === 0 ? "unresolved:discover" : String(i).repeat(40),
				source: i === 0 ? "" : `opaque-${i}`,
				destination: item.destination ?? "/downloads",
				origin: item.oneOff ? "one-off" : "subscription",
				oneOff: item.oneOff ? JSON.stringify(authorization) : null,
				subscription: item.oneOff ? null : "subscription",
				state: item.state,
				ingestion: item.ingestion,
				transfer: i >= 3 ? "seeding" : null,
				progress: i >= 3 ? 1 : null,
				observedAt: i >= 3 ? 9 : null,
				sourcePresent: item.relativePath ? 1 : 0,
				relativePath: item.relativePath ?? null,
				accepted: i
					? JSON.stringify({
							workKey: work,
							reference: { id: "1" },
							episode: i + 1,
							snapshotId: `snapshot-${i}`,
						})
					: null,
			});
		}
		raw.close();
		const logs: string[] = [];
		const logger = pino(
			{ level: "info" },
			{ write: (line) => logs.push(line) },
		);
		database = ApplicationDatabase.open(directory, undefined, logger);
		const repository = database.acquisitionDownloads;
		for (const [i, item] of episodes.entries())
			expect(repository.intent(item.id)).toMatchObject({
				state: item.state,
				ingestion: item.ingestion,
				revision: "old-revision",
				lastCommand: { id: "retry-receipt", kind: "acquisition" },
				acceptedTarget: i
					? { episode: i + 1, snapshotId: `snapshot-${i}` }
					: null,
			});
		expect(repository.episodeCommand("discover")).toMatchObject({
			state: "discovering",
			hash: "unresolved:discover",
		});
		expect(repository.episodeCommand("unknown")).toMatchObject({
			oneOff: authorization,
			ownerKey: "unknown",
		});
		expect(repository.episodeIntent(work, 5)).toBeNull();
		expect(repository.episodeIntent(work, 6)?.id).toBe("review");
		expect(repository.episodeIntent(work, 7)).toBeNull();
		expect(repository.hashOwner("4".repeat(40), "client", "other")).toBe(true);
		const inspected = new Database(path, { readonly: true });
		try {
			expect(inspected.pragma("foreign_key_check")).toEqual([]);
			expect(
				inspected
					.prepare(`
				SELECT file.path, file.file_index, file.size_bytes, file.ingestion, file.observed_selected, target.accepted_target
				FROM acquisition_transfer_files AS file
				JOIN acquisition_transfer_file_targets AS target ON target.file_id = file.id
				ORDER BY file.path
			`)
					.all(),
			).toMatchObject([
				{
					path: "05.mkv",
					file_index: null,
					size_bytes: null,
					ingestion: "available",
					observed_selected: null,
					accepted_target: expect.stringContaining("snapshot-4"),
				},
				{
					path: "06.mkv",
					file_index: null,
					size_bytes: null,
					ingestion: "review",
					observed_selected: null,
					accepted_target: expect.stringContaining("snapshot-5"),
				},
				{
					path: "season/08.mkv",
					file_index: null,
					size_bytes: null,
					ingestion: "available",
					observed_selected: null,
					accepted_target: expect.stringContaining("snapshot-7"),
				},
			]);
			expect(
				inspected
					.prepare("SELECT count(*) as total FROM acquisition_episode_claims")
					.get(),
			).toEqual({ total: 8 });
		} finally {
			inspected.close();
		}
		database.close();
		database = ApplicationDatabase.open(directory, undefined, logger);
		const add = vi.fn();
		const task = vi.fn(async () => null);
		const authorize = vi.fn();
		const read = vi.fn();
		const context = new DownloadContext({
			store: database.acquisitionDownloads,
			transport: { read, isCurrent: () => true, close: async () => {} },
			connectionGeneration: () => "client",
			withClient: async (_generation, operation) =>
				operation({ add, task } as unknown as TorrentClient),
			logger,
		});
		const transfers = new DownloadTransfers(context, { authorize });
		for (const id of ["submitting", "unknown"]) {
			const item = database.acquisitionDownloads.intent(id);
			if (!item) throw new Error("Missing migrated request.");
			await transfers.run(new DownloadExecution(context, item));
			expect(database.acquisitionDownloads.intent(id)).toMatchObject({
				ownerKey: id,
				state: "unknown",
			});
		}
		expect(add).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		expect(authorize).not.toHaveBeenCalled();
		expect(
			logs.filter((line) => line.includes("acquisition.claims_migrated")),
		).toHaveLength(1);
	} finally {
		if (raw.open) raw.close();
		database?.close();
		await rm(directory, { recursive: true, force: true });
	}
});
