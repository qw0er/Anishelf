import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Store } from "./index.js";
import { mediaSources, playbackProgress, resourceRoots } from "./schema.js";

export type Progress = typeof playbackProgress.$inferSelect;
export interface SourceIdentity {
	canonicalRoot: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
}
export interface ProgressUpdate {
	sourceId: string;
	generation: number;
	sequence: number;
	positionMs: number;
	durationMs: number | null;
}
export type SaveResult =
	| { status: "saved" | "duplicate"; progress: Progress }
	| { status: "stale" };

function key(...parts: string[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}
export function resourceRootId(canonicalRoot: string): string {
	return key("root", canonicalRoot);
}

function integer(value: number, minimum: number): void {
	if (!Number.isSafeInteger(value) || value < minimum)
		throw new RangeError(
			"Expected a nonnegative safe integer within the supported range.",
		);
}

/** Synchronous, short transactions. Filesystem checks belong to the caller. */
export class PlaybackRepository {
	constructor(private readonly store: Store) {}

	registerSource(identity: SourceIdentity, nowMs = Date.now()) {
		integer(nowMs, 0);
		if (
			!isAbsolute(identity.canonicalRoot) ||
			identity.canonicalRoot.includes("\0") ||
			!identity.fileId ||
			!identity.sourceVersion ||
			!identity.relativePath ||
			isAbsolute(identity.relativePath) ||
			identity.relativePath.includes("\0") ||
			identity.relativePath.split(/[\\/]/).includes("..")
		) {
			throw new Error(
				"A canonical root and confined source identity are required.",
			);
		}
		const rootId = resourceRootId(identity.canonicalRoot);
		const id = key("source", rootId, identity.fileId, identity.sourceVersion);
		return this.store.transaction(
			(tx) => {
				tx.insert(resourceRoots)
					.values({
						id: rootId,
						canonicalPath: identity.canonicalRoot,
						createdAtMs: nowMs,
					})
					.onConflictDoNothing()
					.run();
				tx.insert(mediaSources)
					.values({
						id,
						rootId,
						fileId: identity.fileId,
						relativePath: identity.relativePath,
						sourceVersion: identity.sourceVersion,
						createdAtMs: nowMs,
					})
					.onConflictDoNothing()
					.run();
				const source = tx
					.select()
					.from(mediaSources)
					.where(eq(mediaSources.id, id))
					.get();
				if (!source) throw new Error("Source registration failed.");
				return source;
			},
			{ behavior: "immediate" },
		);
	}

	get(sourceId: string): Progress | undefined {
		return this.store
			.select()
			.from(playbackProgress)
			.where(eq(playbackProgress.sourceId, sourceId))
			.get();
	}

	openGeneration(sourceId: string): Progress {
		return this.store.transaction(
			(tx) => {
				tx.insert(playbackProgress)
					.values({ sourceId })
					.onConflictDoUpdate({
						target: playbackProgress.sourceId,
						set: {
							generation: sql`${playbackProgress.generation} + 1`,
							lastSequence: 0,
						},
					})
					.run();
				const row = tx
					.select()
					.from(playbackProgress)
					.where(eq(playbackProgress.sourceId, sourceId))
					.get();
				if (!row) throw new Error("Progress initialization failed.");
				return row;
			},
			{ behavior: "immediate" },
		);
	}

	save(update: ProgressUpdate, nowMs = Date.now()): SaveResult {
		integer(nowMs, 0);
		integer(update.generation, 1);
		integer(update.sequence, 1);
		integer(update.positionMs, 0);
		if (update.durationMs !== null) integer(update.durationMs, 1);
		const positionMs =
			update.durationMs === null
				? update.positionMs
				: Math.min(update.positionMs, update.durationMs);
		return this.store.transaction(
			(tx) => {
				const current = tx
					.select()
					.from(playbackProgress)
					.where(eq(playbackProgress.sourceId, update.sourceId))
					.get();
				if (
					!current ||
					current.generation !== update.generation ||
					update.sequence < current.lastSequence
				)
					return { status: "stale" };
				if (update.sequence === current.lastSequence) {
					return current.positionMs === positionMs &&
						current.durationMs === update.durationMs
						? { status: "duplicate", progress: current }
						: { status: "stale" };
				}
				const progress = tx
					.update(playbackProgress)
					.set({
						positionMs,
						durationMs: update.durationMs,
						lastViewedAtMs: nowMs,
						revision: current.revision + 1,
						lastSequence: update.sequence,
					})
					.where(eq(playbackProgress.sourceId, update.sourceId))
					.returning()
					.get();
				if (!progress) throw new Error("Progress save failed.");
				return { status: "saved", progress };
			},
			{ behavior: "immediate" },
		);
	}

	startOver(
		sourceId: string,
		generation: number,
		nowMs = Date.now(),
	): Progress | undefined {
		integer(generation, 1);
		integer(nowMs, 0);
		return this.store
			.update(playbackProgress)
			.set({
				positionMs: 0,
				generation: sql`${playbackProgress.generation} + 1`,
				lastSequence: 0,
				revision: sql`${playbackProgress.revision} + 1`,
				lastViewedAtMs: nowMs,
			})
			.where(
				and(
					eq(playbackProgress.sourceId, sourceId),
					eq(playbackProgress.generation, generation),
				),
			)
			.returning()
			.get();
	}

	/** Ordered database candidates only; callers must filter live availability. */
	listContinueWatching(rootId: string, limit = 20, offset = 0) {
		integer(limit, 1);
		integer(offset, 0);
		if (limit > 100)
			throw new RangeError("Candidate batch size must not exceed 100.");
		return this.store
			.select({ source: mediaSources, progress: playbackProgress })
			.from(playbackProgress)
			.innerJoin(mediaSources, eq(mediaSources.id, playbackProgress.sourceId))
			.where(
				and(
					eq(mediaSources.rootId, rootId),
					gt(playbackProgress.positionMs, 0),
					isNotNull(playbackProgress.lastViewedAtMs),
					sql`(${playbackProgress.durationMs} IS NULL OR ${playbackProgress.durationMs} - ${playbackProgress.positionMs} > min(30000, ${playbackProgress.durationMs} * 0.05))`,
				),
			)
			.orderBy(
				desc(playbackProgress.lastViewedAtMs),
				asc(playbackProgress.sourceId),
			)
			.limit(limit)
			.offset(offset)
			.all();
	}
}
