import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { FileDto } from "../contracts/api.js";
import {
	type PlaybackRepository,
	type Progress,
	resourceRootId,
	type SaveResult,
	type SourceIdentity,
} from "../database/playback-repository.js";
import { DomainError } from "../errors.js";
import type { LibraryApplication } from "./library.js";

export interface PlaybackSession {
	token: string;
	generation: number;
	sourceVersion: string;
	file: FileDto;
	plan: { mode: "direct"; playbackUrl: string };
	progress: Progress;
}
export interface SavePlaybackProgress {
	token: string;
	generation: number;
	sourceVersion: string;
	sequence: number;
	positionMs: number;
	durationMs: number | null;
}
interface Session {
	sourceId: string;
	identity: SourceIdentity;
	rootEpoch: number;
	generation: number;
	touchedAt: number;
	reset?: { requestId: string; generation: number; progress: Progress };
}
const sessionIdleMs = 30 * 60 * 1000;
const maximumSessions = 1000;

/** Coordinates filesystem identity, session authorization and durable progress. */
export class PlaybackApplication {
	private readonly sessions = new Map<string, Session>();
	private closed = false;
	private readonly logger: Logger;
	constructor(
		private readonly options: {
			library: LibraryApplication;
			repository?: PlaybackRepository;
			logger: Logger;
			now?: () => number;
		},
	) {
		this.logger = options.logger.child({ module: "playback" });
	}

	async open(fileId: string): Promise<PlaybackSession> {
		this.prune();
		if (this.sessions.size >= maximumSessions)
			throw new DomainError(
				"PLAYBACK_UNAVAILABLE",
				"Too many active playback sessions.",
			);
		const source = await this.options.library.resolvePlaybackSource(fileId);
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
			touchedAt: this.now(),
		});
		return {
			token,
			generation: progress.generation,
			sourceVersion: source.identity.sourceVersion,
			file: source.file,
			plan: {
				mode: "direct",
				playbackUrl: `/api/media/${encodeURIComponent(fileId)}`,
			},
			progress,
		};
	}

	async save(input: SavePlaybackProgress): Promise<SaveResult> {
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
		session.touchedAt = this.now();
		return result;
	}

	async startOver(input: {
		token: string;
		generation: number;
		requestId: string;
	}): Promise<Progress> {
		if (
			!Number.isSafeInteger(input.generation) ||
			input.generation < 1 ||
			!input.requestId ||
			input.requestId.length > 128
		)
			throw new DomainError("INVALID_REQUEST", "Invalid start-over request.");
		const session = this.session(input.token);
		await this.revalidate(input.token, session);
		if (session.reset?.requestId === input.requestId) {
			if (session.reset.generation !== input.generation) this.conflict();
			session.touchedAt = this.now();
			return { ...session.reset.progress };
		}
		if (session.generation !== input.generation) this.conflict();
		const progress = this.persist(() =>
			this.repository().startOver(
				session.sourceId,
				input.generation,
				this.now(),
			),
		);
		if (!progress) this.conflict();
		session.generation = progress.generation;
		session.touchedAt = this.now();
		session.reset = {
			requestId: input.requestId,
			generation: input.generation,
			progress,
		};
		return { ...progress };
	}

	async continueWatching(limit = 20): Promise<{
		availability: "unknown" | "checked";
		items: { file: FileDto; progress: Progress }[];
	}> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
			throw new DomainError("INVALID_REQUEST", "Invalid list limit.");
		const repository = this.repository();
		if (!this.options.library.hasSnapshot)
			return { availability: "unknown", items: [] };
		const epoch = this.options.library.resourceRootEpoch;
		const rootId = resourceRootId(
			await this.options.library.resolvePlaybackRoot(),
		);
		const items: { file: FileDto; progress: Progress }[] = [];
		for (let offset = 0; items.length < limit; offset += 100) {
			this.assertEpoch(epoch);
			const candidates = this.persist(() =>
				repository.listContinueWatching(rootId, 100, offset),
			);
			for (const candidate of candidates) {
				let source: Awaited<
					ReturnType<LibraryApplication["resolvePlaybackSource"]>
				>;
				try {
					source = await this.options.library.resolvePlaybackSource(
						candidate.source.fileId,
					);
				} catch (error) {
					if (
						error instanceof DomainError &&
						[
							"RESOURCE_NOT_FOUND",
							"RESOURCE_MISSING",
							"RESOURCE_UNREADABLE",
							"RESOURCE_ACCESS_DENIED",
						].includes(error.code)
					)
						continue;
					throw error;
				}
				this.assertEpoch(epoch);
				if (
					source.identity.sourceVersion !== candidate.source.sourceVersion ||
					resourceRootId(source.identity.canonicalRoot) !== rootId
				)
					continue;
				items.push({ file: source.file, progress: candidate.progress });
				if (items.length === limit) break;
			}
			if (candidates.length < 100) break;
		}
		this.assertEpoch(epoch);
		return { availability: "checked", items };
	}

	release(token: string): void {
		this.sessions.delete(token);
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
		if (epoch !== this.options.library.resourceRootEpoch) this.conflict();
	}
	private prune(): void {
		this.repository();
		for (const [token, session] of this.sessions) {
			if (
				this.now() - session.touchedAt >= sessionIdleMs ||
				session.rootEpoch !== this.options.library.resourceRootEpoch
			)
				this.sessions.delete(token);
		}
	}
	private session(token: string): Session {
		this.prune();
		const session = this.sessions.get(token);
		if (!session) this.conflict();
		return session;
	}
	private async revalidate(token: string, session: Session): Promise<void> {
		const source = await this.options.library.resolvePlaybackSource(
			session.identity.fileId,
		);
		// Check again after awaiting filesystem access: another open/reset/root change may have intervened.
		if (
			this.session(token) !== session ||
			source.rootEpoch !== session.rootEpoch ||
			source.identity.canonicalRoot !== session.identity.canonicalRoot ||
			source.identity.sourceVersion !== session.identity.sourceVersion
		) {
			this.sessions.delete(token);
			this.conflict();
		}
	}
	private conflict(): never {
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
