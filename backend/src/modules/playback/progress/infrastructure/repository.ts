import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import { mediaSources } from "../../../resources/persistence.js";
import type { SourceRegistry } from "../../../resources/public.js";
import {
	type CompletionRecord,
	type ManualCompletion,
	mergeCoverage,
} from "../domain/completion.js";
import type {
	HistoryCandidate,
	PlaybackProgress,
	PlaybackProgressUpdate,
	RegisteredSource,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "../domain/model.js";
import { type PlaybackPolicy, playbackPolicy } from "../policy.js";
import {
	playbackCompletions,
	playbackCoverage,
	playbackProgress,
} from "./schema.js";

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

/** Evidence and manual intent for one source/target pair share a single receipt. */
function completionId(sourceId: string, context: string): string {
	return createHash("sha256").update(sourceId).update(context).digest("hex");
}

/** Synchronous, short transactions. Filesystem checks belong to the caller. */
export class PlaybackRepository {
	constructor(
		private readonly store: Store,
		private readonly sources: SourceRegistry,
		private readonly policy: DeepReadonly<PlaybackPolicy> = playbackPolicy,
	) {}

	coverage(sourceId: string, durationMs: number): [number, number][] {
		const row = this.store
			.select()
			.from(playbackCoverage)
			.where(eq(playbackCoverage.sourceId, sourceId))
			.get();
		return row?.durationMs === durationMs ? row.intervals : [];
	}
	completions(
		sourceId?: string,
		pendingOnly = false,
		context?: string,
	): CompletionRecord[] {
		return this.store
			.select()
			.from(playbackCompletions)
			.where(
				and(
					sourceId ? eq(playbackCompletions.sourceId, sourceId) : undefined,
					context !== undefined
						? eq(playbackCompletions.context, context)
						: undefined,
					pendingOnly
						? sql`json_extract(${playbackCompletions.outcome}, '$.state') IN ('pending','unavailable')`
						: undefined,
				),
			)
			.orderBy(asc(playbackCompletions.attemptedAt))
			.limit(context !== undefined ? 1 : pendingOnly ? 100 : 1000)
			.all()
			.map((row) => ({ ...row, decision: row.decision ?? null }));
	}
	saveCompletion(record: CompletionRecord): void {
		this.store
			.insert(playbackCompletions)
			.values(record)
			.onConflictDoUpdate({
				target: playbackCompletions.id,
				set: {
					outcome: record.outcome,
					decision: record.decision,
					attemptedAt: Date.now(),
				},
			})
			.run();
	}
	recordCompletion(record: ManualCompletion): void {
		this.store
			.insert(playbackCompletions)
			.values({
				id: completionId(record.sourceId, record.context),
				sourceId: record.sourceId,
				context: record.context,
				capturedAt: record.capturedAt,
				outcome: { state: "pending", reason: "manual-marked" },
				decision: record.decision,
			})
			.onConflictDoNothing()
			.run();
	}
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
				const evidence = update.evidence;
				if (evidence?.durationMs && evidence.intervals.length) {
					const previous = tx
						.select()
						.from(playbackCoverage)
						.where(eq(playbackCoverage.sourceId, update.sourceId))
						.get();
					// A changed duration invalidates old evidence instead of mixing alternate timelines.
					const intervals = mergeCoverage([
						...(previous?.durationMs === evidence.durationMs
							? previous.intervals
							: []),
						...evidence.intervals.map(
							(i) => [i.startMs, i.endMs] as [number, number],
						),
					]);
					if (intervals.length <= 4096) {
						tx.insert(playbackCoverage)
							.values({
								sourceId: update.sourceId,
								durationMs: evidence.durationMs,
								intervals,
							})
							.onConflictDoUpdate({
								target: playbackCoverage.sourceId,
								set: { durationMs: evidence.durationMs, intervals },
							})
							.run();
						const covered = intervals.reduce(
							(sum, [start, end]) => sum + end - start,
							0,
						);
						if (covered / evidence.durationMs >= 0.85 && evidence.context) {
							const id = completionId(update.sourceId, evidence.context);
							tx.insert(playbackCompletions)
								.values({
									id,
									sourceId: update.sourceId,
									context: evidence.context,
									capturedAt: evidence.capturedAt,
									outcome: { state: "pending", reason: "completion-recorded" },
									decision: null,
								})
								.onConflictDoNothing()
								.run();
						}
					}
				}
				return { status: "saved", progress: toPlaybackProgress(progress) };
			},
			{ behavior: "immediate" },
		);
	}

	listHistory(
		rootId: string,
		limit = this.policy.candidateBatchSize,
		offset = 0,
		view: "continue" | "recent" = "recent",
	): HistoryCandidate[] {
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
