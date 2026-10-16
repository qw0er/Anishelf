import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import { resourceRootId } from "../../../resources/public.js";
import type {
	CompletionDecision,
	CompletionOutcome,
	PlaybackCompletionObserver,
} from "../domain/completion.js";
import { mergeCoverage } from "../domain/completion.js";
import type {
	HistoryItem,
	HistoryResult,
	PlaybackSession,
	ResolvedSource,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "../domain/model.js";
import { type PlaybackPolicy, playbackPolicy } from "../policy.js";
import type { PlaybackStore } from "../ports.js";
import type { PlaybackApi } from "../public.js";
import { PlaybackCompletions } from "./completions.js";

interface PlaybackSessionState {
	completionContext: string | null;
	sourceDurationMs?: number | null;
	openedAt: number;
	evidenceAt: number;
	sourceId: string;
	identity: SourceIdentity;
	rootEpoch: number;
	generation: number;
	touchedAtMs: number;
}

/** Coordinates filesystem identity, session authorization and durable progress. */
export class PlaybackApplication implements PlaybackApi {
	private readonly sessions = new Map<string, PlaybackSessionState>();
	private closed = false;
	private readonly completionsWorker: PlaybackCompletions | undefined;
	private readonly logger: Logger;
	private readonly policy: DeepReadonly<PlaybackPolicy>;
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			sourceDuration?:
				| ((fileId: string, sourceVersion: string) => Promise<number | null>)
				| undefined;
			completionObserver?: PlaybackCompletionObserver | undefined;
			repository?: PlaybackStore;
			logger: Logger;
			now?: () => number;
			policy?: DeepReadonly<PlaybackPolicy>;
		},
	) {
		this.policy = options.policy ?? playbackPolicy;
		this.logger = options.logger.child({ module: "playback" });
		if (options.repository && options.completionObserver)
			this.completionsWorker = new PlaybackCompletions(
				options.repository,
				options.completionObserver,
				this.logger,
			);
	}

	async open(fileId: string): Promise<PlaybackSession> {
		const started = Date.now();
		const openedAt = this.now();
		this.logger.debug(
			{ event: "playback.open_started", fileId },
			"Opening playback session.",
		);
		this.prune();
		if (this.sessions.size >= this.policy.maximumSessions)
			throw new DomainError(
				"PLAYBACK_UNAVAILABLE",
				"Too many active playback sessions.",
			);
		const source = await this.options.sources.resolveSource(fileId);
		this.assertEpoch(source.rootEpoch);
		const repository = this.repository();
		const progress = this.persist(() => {
			const registered = repository.registerSource(source.identity, this.now());
			// A failed history read must never create a writable session.
			repository.get(registered.id);
			return repository.openGeneration(registered.id);
		});
		let completionContext: string | null = null;
		try {
			completionContext =
				(await this.options.completionObserver?.capture(
					fileId,
					source.identity.sourceVersion,
				)) ?? null;
		} catch {
			this.logger.warn(
				{ event: "playback.completion_capture_failed", fileId },
				"Tracking target unavailable; local playback remains usable.",
			);
		}
		this.assertEpoch(source.rootEpoch);
		const token = randomUUID();
		for (const [otherToken, session] of this.sessions) {
			if (session.sourceId === progress.sourceId)
				this.sessions.delete(otherToken);
		}
		this.sessions.set(token, {
			completionContext,
			openedAt,
			evidenceAt: this.now(),
			sourceId: progress.sourceId,
			identity: source.identity,
			rootEpoch: source.rootEpoch,
			generation: progress.generation,
			touchedAtMs: this.now(),
		});
		this.logger.info(
			{
				event: "playback.opened",
				fileId,
				sourceId: progress.sourceId,
				generation: progress.generation,
				durationMs: Date.now() - started,
			},
			"Playback session opened.",
		);
		return {
			token,
			completionEnabled: Boolean(completionContext),
			sourceVersion: source.identity.sourceVersion,
			file: source.file,
			progress,
		};
	}

	async save(input: SavePlaybackProgress): Promise<SavePlaybackProgressResult> {
		this.validateTimes(input);
		const session = this.session(input.token);
		await this.revalidate(input.token, session);
		if (
			input.generation !== session.generation ||
			input.sourceVersion !== session.identity.sourceVersion
		)
			this.conflict();
		if (input.intervals?.length && session.sourceDurationMs === undefined) {
			try {
				session.sourceDurationMs =
					(await this.options.sourceDuration?.(
						session.identity.fileId,
						session.identity.sourceVersion,
					)) ?? null;
			} catch {
				this.logger.warn(
					{
						event: "playback.evidence_duration_unavailable",
						sourceId: session.sourceId,
					},
					"Source duration unavailable; resume remains usable.",
				);
			}
			await this.revalidate(input.token, session);
		}
		const intervals = this.validEvidence(input, session);
		const result = this.persist(() =>
			this.repository().save(
				{
					sourceId: session.sourceId,
					generation: input.generation,
					sequence: input.sequence,
					positionMs: input.positionMs,
					durationMs: input.durationMs,
					evidence: {
						intervals,
						durationMs: session.sourceDurationMs ?? 0,
						context: session.completionContext,
						capturedAt: session.openedAt,
					},
				},
				this.now(),
			),
		);
		if (result.status === "stale") this.conflict();
		if (result.status === "saved") session.evidenceAt = this.now();
		session.touchedAtMs = this.now();
		void this.completionsWorker?.flush();
		this.logger.trace(
			{
				event: "playback.progress_saved",
				sourceId: session.sourceId,
				sequence: input.sequence,
				status: result.status,
			},
			"Playback progress saved.",
		);
		return result;
	}

	async history(
		limit = this.policy.historyLimit,
		view: "continue" | "recent" = "recent",
	): Promise<HistoryResult> {
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > this.policy.maximumListLimit
		)
			throw new DomainError("INVALID_REQUEST", "Invalid list limit.");
		const repository = this.repository();
		if (!this.options.sources.hasSnapshot)
			return { availability: "unknown", items: [] };
		const epoch = this.options.sources.resourceRootEpoch;
		const canonicalRoot = await this.options.sources.resolveRoot();
		const rootId = resourceRootId(canonicalRoot);
		const items: HistoryItem[] = [];
		for (
			let offset = 0;
			items.length < limit;
			offset += this.policy.candidateBatchSize
		) {
			this.assertEpoch(epoch);
			const candidates = this.persist(() =>
				repository.listHistory(
					rootId,
					this.policy.candidateBatchSize,
					offset,
					view,
				),
			);
			for (const candidate of candidates) {
				let source: ResolvedSource;
				try {
					source = await this.options.sources.revalidateSource({
						identity: { ...candidate.source, canonicalRoot },
						rootEpoch: epoch,
					});
				} catch (error) {
					this.assertEpoch(epoch);
					if (
						error instanceof DomainError &&
						[
							"RESOURCE_NOT_FOUND",
							"RESOURCE_MISSING",
							"RESOURCE_UNREADABLE",
							"RESOURCE_ACCESS_DENIED",
							"PLAYBACK_CONFLICT",
						].includes(error.code)
					)
						continue;
					throw error;
				}
				this.assertEpoch(epoch);
				items.push({ file: source.file, progress: candidate.progress });
				if (items.length === limit) break;
			}
			if (candidates.length < this.policy.candidateBatchSize) break;
		}
		this.assertEpoch(epoch);
		this.logger.debug(
			{ event: "playback.history_loaded", view, count: items.length },
			"Playback history loaded.",
		);
		return { availability: "checked", items };
	}

	release(token: string): void {
		const session = this.sessions.get(token);
		if (this.sessions.delete(token))
			this.logger.debug(
				{ event: "playback.released", sourceId: session?.sourceId },
				"Playback session released.",
			);
	}
	async completion(token: string): Promise<CompletionOutcome | null> {
		const session = this.session(token);
		await this.revalidate(token, session);
		const records = this.repository().completions(
			session.sourceId,
			false,
			session.completionContext ?? "",
		);
		return (
			records.find((record) => record.context === session.completionContext)
				?.outcome ?? null
		);
	}
	async decideCompletion(
		token: string,
		decision: CompletionDecision,
	): Promise<CompletionOutcome | null> {
		const session = this.session(token);
		await this.revalidate(token, session);
		const context = session.completionContext;
		const record = context
			? this.repository()
					.completions(session.sourceId, false, context)
					.find((r) => r.context === context)
			: undefined;
		if (record && this.completionsWorker)
			await this.completionsWorker.decide(record, decision);
		// Manual marking has no coverage receipt yet: record explicit intent through the same handoff.
		// Declining without a receipt records nothing, so later automatic evidence is never suppressed.
		else if (!record && context && decision.advance && this.completionsWorker) {
			this.logger.info(
				{
					event: "playback.completion_manual_recorded",
					sourceId: session.sourceId,
					decision,
				},
				"Manual playback completion recorded.",
			);
			await this.completionsWorker.mark(
				session.sourceId,
				context,
				this.now(),
				decision,
			);
		}
		return this.completion(token);
	}
	private validEvidence(
		input: SavePlaybackProgress,
		session: PlaybackSessionState,
	) {
		const intervals = input.intervals ?? [];
		if (
			!session.sourceDurationMs ||
			!input.durationMs ||
			Math.abs(session.sourceDurationMs - input.durationMs) > 1000
		)
			return [];
		let covered = this.repository().coverage(
			session.sourceId,
			session.sourceDurationMs,
		);
		let elapsed = 0;
		if (intervals.length > 128) return [];
		for (const i of intervals) {
			if (
				!input.durationMs ||
				!Number.isSafeInteger(i.startMs) ||
				!Number.isSafeInteger(i.endMs) ||
				i.startMs < 0 ||
				i.endMs <= i.startMs ||
				i.endMs > input.durationMs ||
				!Number.isFinite(i.elapsedMs) ||
				i.elapsedMs <= 0 ||
				!Number.isFinite(i.rate) ||
				i.rate < 0.25 ||
				i.rate > 16 ||
				i.endMs - i.startMs > i.elapsedMs * i.rate + 100
			)
				return [];
			const before = covered.reduce(
				(sum, [start, end]) => sum + end - start,
				0,
			);
			covered = mergeCoverage([
				...covered,
				[i.startMs, Math.min(i.endMs, session.sourceDurationMs)],
			]);
			const added =
				covered.reduce((sum, [start, end]) => sum + end - start, 0) - before;
			elapsed += (i.elapsedMs * added) / (i.endMs - i.startMs);
		}
		// Delivery delay grants no unbounded credit. Invalid telemetry never breaks resume saves.
		if (
			elapsed >
			Math.min(300000, Math.max(0, this.now() - session.evidenceAt) + 1000)
		) {
			this.logger.debug(
				{ event: "playback.evidence_rejected", sourceId: session.sourceId },
				"Playback evidence exceeded elapsed-time budget.",
			);
			return [];
		}
		return intervals
			.map((i) => ({
				...i,
				endMs: Math.min(i.endMs, session.sourceDurationMs ?? i.endMs),
			}))
			.filter((i) => i.endMs > i.startMs);
	}
	async close(): Promise<void> {
		this.closed = true;
		this.sessions.clear();
		await this.completionsWorker?.close();
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}
	private repository(): PlaybackStore {
		if (this.closed || !this.options.repository)
			throw new DomainError(
				"PLAYBACK_UNAVAILABLE",
				"Playback persistence is unavailable.",
			);
		return this.options.repository;
	}
	private persist<T>(operation: () => T): T {
		try {
			return operation();
		} catch (cause) {
			if (cause instanceof DomainError) throw cause;
			this.logger.error(
				{ event: "playback.persistence_failed", err: cause },
				"Playback persistence failed.",
			);
			throw new DomainError(
				"PLAYBACK_PERSISTENCE_FAILED",
				"Playback progress could not be loaded or saved.",
				{ cause },
			);
		}
	}
	private assertEpoch(epoch: number): void {
		this.repository();
		if (epoch !== this.options.sources.resourceRootEpoch) this.conflict();
	}
	private prune(): void {
		this.repository();
		for (const [token, session] of this.sessions) {
			if (
				this.now() - session.touchedAtMs >= this.policy.sessionIdleMs ||
				session.rootEpoch !== this.options.sources.resourceRootEpoch
			)
				this.sessions.delete(token);
		}
	}
	private session(token: string): PlaybackSessionState {
		this.prune();
		const session = this.sessions.get(token);
		if (!session) this.conflict();
		return session;
	}
	private async revalidate(
		token: string,
		session: PlaybackSessionState,
	): Promise<void> {
		try {
			await this.options.sources.revalidateSource(session);
		} catch (error) {
			if (error instanceof DomainError && error.code === "PLAYBACK_CONFLICT") {
				this.sessions.delete(token);
				this.conflict();
			}
			throw error;
		}
		// Check again after awaiting filesystem access: another open/reset/root change may have intervened.
		if (this.session(token) !== session) {
			this.sessions.delete(token);
			this.conflict();
		}
	}
	private conflict(): never {
		this.logger.debug(
			{ event: "playback.conflict" },
			"Playback session or source changed.",
		);
		throw new DomainError(
			"PLAYBACK_CONFLICT",
			"The playback session or source changed. Reopen playback.",
		);
	}
	private validateTimes(input: SavePlaybackProgress): void {
		const values = [input.generation, input.sequence, input.positionMs];
		if (
			values.some((value) => !Number.isSafeInteger(value)) ||
			input.generation < 1 ||
			input.sequence < 1 ||
			input.positionMs < 0 ||
			(input.durationMs !== null &&
				(!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0))
		)
			throw new DomainError("INVALID_REQUEST", "Invalid playback progress.");
	}
}
