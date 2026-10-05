import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { CompatibilityCheckRequest } from "../../../contracts/http.js";
import { DomainError } from "../../../shared/errors.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import {
	type HlsPolicy,
	hlsPolicy,
	validateHlsPolicy,
} from "../../hls/policy.js";
import type { MediaCompatibilityApi } from "../../media-compatibility/public.js";
import {
	resolveExecutionPlan,
	resolveHlsExecutionPlan,
} from "../../media-processing/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import { resourceRootId } from "../../resource-access/public.js";
import type {
	ContinueWatchingItem,
	ContinueWatchingResult,
	PlaybackSession,
	ResolvedSource,
	SavePlaybackProgress,
	SavePlaybackProgressResult,
	SourceIdentity,
} from "../domain/model.js";
import {
	directPlaybackPlan,
	type PlaybackPlanningResult,
} from "../domain/plan.js";
import { type PlaybackPolicy, playbackPolicy } from "../domain/policy.js";
import type { PlaybackRepository } from "../infrastructure/repository.js";
import type { PlaybackApi } from "../public.js";

interface PlaybackSessionState {
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
	private readonly logger: Logger;
	private readonly policy: DeepReadonly<PlaybackPolicy>;
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			compatibility?: MediaCompatibilityApi;
			repository?: PlaybackRepository;
			logger: Logger;
			now?: () => number;
			policy?: DeepReadonly<PlaybackPolicy>;
			hlsPolicy?: DeepReadonly<HlsPolicy>;
		},
	) {
		this.policy = options.policy ?? playbackPolicy;
		validateHlsPolicy(options.hlsPolicy ?? hlsPolicy);
		this.logger = options.logger.child({ module: "playback" });
	}

	/** Checks client evidence and proposes work without creating history or acquiring output. */
	async plan(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<PlaybackPlanningResult>> {
		input = structuredClone(input);
		if (this.closed || !this.options.compatibility)
			throw new DomainError(
				"PLAYBACK_UNAVAILABLE",
				"Playback planning is unavailable.",
			);
		const source = await this.options.sources.resolveSource(
			input.fileId,
			input.sourceVersion,
		);
		const checked = await this.options.compatibility.check(input);
		if (
			checked.canonicalRoot !== source.identity.canonicalRoot ||
			checked.fileId !== source.identity.fileId ||
			checked.sourceVersion !== source.identity.sourceVersion
		)
			this.conflict();
		if (checked.output?.target === "hls") {
			const resolved = resolveHlsExecutionPlan(
				checked,
				(this.options.hlsPolicy ?? hlsPolicy).targetSegmentDurationMs,
			);
			await this.options.sources.revalidateSource(source);
			this.options.sources.assertRootEpoch(source.rootEpoch);
			if (this.closed)
				throw new DomainError(
					"PLAYBACK_UNAVAILABLE",
					"Playback planning is closed.",
				);
			if (resolved.kind === "blocked")
				return freeze({
					kind: "blocked",
					plan: { mode: "blocked", reason: resolved.reason },
				});
			return freeze({
				kind: "hls-required",
				identity: {
					rootId: resourceRootId(source.identity.canonicalRoot),
					fileId: source.identity.fileId,
					sourceVersion: source.identity.sourceVersion,
					profileFingerprint: resolved.profileFingerprint,
					executionPlanId: resolved.request.plan.id,
					videoStreamIndex: resolved.request.plan.videoStreamIndex,
					audioStreamIndices: resolved.request.plan.audioTracks.map(
						(track) => track.sourceStreamIndex,
					),
				},
				execution: resolved.request,
			});
		}
		const resolved = resolveExecutionPlan(checked);
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertRootEpoch(source.rootEpoch);
		if (this.closed)
			throw new DomainError(
				"PLAYBACK_UNAVAILABLE",
				"Playback planning is closed.",
			);
		if (resolved.kind === "direct")
			return freeze({
				kind: "playable",
				plan: directPlaybackPlan(input.fileId, source.file.mimeType),
			});
		if (resolved.kind === "blocked")
			return freeze({
				kind: "blocked",
				plan: { mode: "blocked", reason: resolved.reason },
			});
		const output = checked.output;
		if (!output || output.target === "hls") this.conflict();
		return freeze({
			kind: "processing-required",
			target: output.target,
			mode: resolved.mode,
			reasons: resolved.reasons,
			identity: {
				rootId: resourceRootId(source.identity.canonicalRoot),
				fileId: source.identity.fileId,
				sourceVersion: source.identity.sourceVersion,
				profileFingerprint: resolved.profileFingerprint,
				executionPlanId: resolved.request.plan.id,
				videoStreamIndex: resolved.request.videoStreamIndex,
				audioStreamIndices: resolved.request.audioStreamIndices,
			},
			execution: resolved.request,
		});
	}

	async open(fileId: string): Promise<PlaybackSession> {
		const started = Date.now();
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
		const token = randomUUID();
		for (const [otherToken, session] of this.sessions) {
			if (session.sourceId === progress.sourceId)
				this.sessions.delete(otherToken);
		}
		this.sessions.set(token, {
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
			generation: progress.generation,
			sourceVersion: source.identity.sourceVersion,
			file: source.file,
			plan: directPlaybackPlan(fileId, source.file.mimeType),
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
		const result = this.persist(() =>
			this.repository().save(
				{
					sourceId: session.sourceId,
					generation: input.generation,
					sequence: input.sequence,
					positionMs: input.positionMs,
					durationMs: input.durationMs,
				},
				this.now(),
			),
		);
		if (result.status === "stale") this.conflict();
		session.touchedAtMs = this.now();
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

	async continueWatching(
		limit = this.policy.continueWatchingLimit,
	): Promise<ContinueWatchingResult> {
		return this.history(limit, "continue");
	}

	async history(
		limit = this.policy.historyLimit,
		view: "continue" | "recent" = "recent",
	): Promise<ContinueWatchingResult> {
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
		const items: ContinueWatchingItem[] = [];
		for (
			let offset = 0;
			items.length < limit;
			offset += this.policy.candidateBatchSize
		) {
			this.assertEpoch(epoch);
			const candidates = this.persist(() =>
				repository.listContinueWatching(
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
	close(): void {
		this.closed = true;
		this.sessions.clear();
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}
	private repository(): PlaybackRepository {
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
