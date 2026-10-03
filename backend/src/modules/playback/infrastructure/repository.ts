import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
	mediaSources,
	playbackProgress,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { SourceRegistry } from "../../resource-access/public.js";
import type {
	ContinueWatchingCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	RegisteredSource,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "../domain/model.js";
import { type PlaybackPolicy, playbackPolicy } from "../domain/policy.js";

// Schema-derived records stay inside the database adapter.
type PlaybackProgressRow = typeof playbackProgress.$inferSelect;

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
		private readonly sources: SourceRegistry,
		private readonly policy: DeepReadonly<PlaybackPolicy> = playbackPolicy,
	) {}

	registerSource(
		identity: SourceIdentity,
		nowMs = Date.now(),
	): RegisteredSource {
		return this.sources.registerSource(identity, nowMs);
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
				source: {
					id: source.id,
					rootId: source.rootId,
					fileId: source.fileId,
					relativePath: source.relativePath,
					sourceVersion: source.sourceVersion,
					createdAtMs: source.createdAtMs,
				},
				progress: toPlaybackProgress(progress),
			}));
	}
}
