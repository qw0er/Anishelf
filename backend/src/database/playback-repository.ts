import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type {
	ContinueWatchingCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	PlaybackSourceIdentity,
	RegisteredPlaybackSource,
	SavePlaybackProgressResult,
} from "../playback/model.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../public/policy.js";
import type { Store } from "./index.js";
import { mediaSources, playbackProgress, resourceRoots } from "./schema.js";

// Schema-derived records stay inside the database adapter.
type PlaybackProgressRow = typeof playbackProgress.$inferSelect;
type MediaSourceRow = typeof mediaSources.$inferSelect;

function toPlaybackProgress(row: PlaybackProgressRow): PlaybackProgress {
	return {
		sourceId: row.sourceId,
		positionMs: row.positionMs,
		durationMs: row.durationMs,
		lastViewedAtMs: row.lastViewedAtMs,
		generation: row.generation,
		lastSequence: row.lastSequence,
	};
}

function toRegisteredSource(row: MediaSourceRow): RegisteredPlaybackSource {
	return {
		id: row.id,
		rootId: row.rootId,
		fileId: row.fileId,
		relativePath: row.relativePath,
		sourceVersion: row.sourceVersion,
		createdAtMs: row.createdAtMs,
	};
}

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
	constructor(
		private readonly store: Store,
		private readonly policy: DeepReadonly<BuiltinPolicy>["playback"] = builtinPolicy.playback,
	) {}

	registerSource(
		identity: PlaybackSourceIdentity,
		nowMs = Date.now(),
	): RegisteredPlaybackSource {
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
				return toRegisteredSource(source);
			},
			{ behavior: "immediate" },
		);
	}

	get(sourceId: string): PlaybackProgress | undefined {
		const row = this.store
			.select()
			.from(playbackProgress)
			.where(eq(playbackProgress.sourceId, sourceId))
			.get();
		return row ? toPlaybackProgress(row) : undefined;
	}

	openGeneration(sourceId: string): PlaybackProgress {
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
				return toPlaybackProgress(row);
			},
			{ behavior: "immediate" },
		);
	}

	save(
		update: PlaybackProgressUpdate,
		nowMs = Date.now(),
	): SavePlaybackProgressResult {
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
						? { status: "duplicate", progress: toPlaybackProgress(current) }
						: { status: "stale" };
				}
				const progress = tx
					.update(playbackProgress)
					.set({
						positionMs,
						durationMs: update.durationMs,
						lastViewedAtMs: nowMs,
						lastSequence: update.sequence,
					})
					.where(eq(playbackProgress.sourceId, update.sourceId))
					.returning()
					.get();
				if (!progress) throw new Error("Progress save failed.");
				return { status: "saved", progress: toPlaybackProgress(progress) };
			},
			{ behavior: "immediate" },
		);
	}

	listContinueWatching(
		rootId: string,
		limit = Math.min(
			this.policy.continueWatchingLimit,
			this.policy.candidateBatchSize,
		),
		offset = 0,
		view: "continue" | "recent" = "continue",
	): ContinueWatchingCandidate[] {
		integer(limit, 1);
		integer(offset, 0);
		if (limit > this.policy.candidateBatchSize)
			throw new RangeError(
				`Candidate batch size must not exceed ${this.policy.candidateBatchSize}.`,
			);
		return this.store
			.select({ source: mediaSources, progress: playbackProgress })
			.from(playbackProgress)
			.innerJoin(mediaSources, eq(mediaSources.id, playbackProgress.sourceId))
			.where(
				and(
					eq(mediaSources.rootId, rootId),
					view === "continue" ? gt(playbackProgress.positionMs, 0) : undefined,
					isNotNull(playbackProgress.lastViewedAtMs),
					view === "continue"
						? sql`(${playbackProgress.durationMs} IS NULL OR ${playbackProgress.durationMs} - ${playbackProgress.positionMs} > min(${this.policy.nearEndMs}, ${playbackProgress.durationMs} * ${this.policy.nearEndRatio}))`
						: undefined,
				),
			)
			.orderBy(
				desc(playbackProgress.lastViewedAtMs),
				asc(playbackProgress.sourceId),
			)
			.limit(limit)
			.offset(offset)
			.all()
			.map(({ source, progress }) => ({
				source: toRegisteredSource(source),
				progress: toPlaybackProgress(progress),
			}));
	}
}
