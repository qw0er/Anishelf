import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import { TrackingListError } from "../domain/list.js";
import type {
	TrackingAttempt,
	TrackingDesiredState,
	TrackingOperation,
	TrackingOperationCommand,
	TrackingRemoteState,
	TrackingUpdate,
} from "../domain/operation.js";
import type {
	TrackingListAccess,
	TrackingOperationStore,
	TrackingUpdateProvider,
} from "../ports.js";

interface Options {
	access: TrackingListAccess;
	store: TrackingOperationStore;
	provider: TrackingUpdateProvider;
	confirmed(
		accountId: number,
		mediaId: number,
		remote: TrackingRemoteState | null,
	): void;
	logger?: Logger;
	now?: () => number;
	random?: () => number;
}
const terminal = (op: TrackingOperation) =>
	op.state === "succeeded" || op.state === "cancelled";
function matches(
	remote: TrackingRemoteState | null,
	desired: TrackingDesiredState,
): boolean {
	return (
		remote !== null &&
		(desired.progress === undefined || remote.progress === desired.progress) &&
		(desired.status === undefined || remote.status === desired.status)
	);
}
function unchanged(
	remote: TrackingRemoteState | null,
	attempt: TrackingAttempt,
): boolean {
	const baseline = attempt.baseline;
	if (!remote || !baseline) return remote === baseline;
	return (
		remote.id === baseline.id &&
		(attempt.desired.progress === undefined ||
			remote.progress === baseline.progress) &&
		(attempt.desired.status === undefined || remote.status === baseline.status)
	);
}
/** Durable absolute intent; immutable attempts survive uncertain delivery and newer edits. */
export class TrackingUpdates {
	private readonly lifetime = new AbortController();
	private active: Promise<void> | undefined;
	private requested = false;
	private readonly timer: ReturnType<typeof setInterval>;
	constructor(private readonly options: Options) {
		this.timer = setInterval(() => this.wake(), 1000);
		this.timer.unref();
		this.wake();
	}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	private failure(
		code: "TRACKING_CONFLICT" | "INVALID_REQUEST" | "TRACKING_UNAVAILABLE",
		message: string,
	): never {
		throw new DomainError(code, message);
	}
	operations(generation: string): TrackingOperation[] {
		this.options.access.assertCurrent(generation);
		const status = this.options.access.status();
		return status.account ? this.options.store.list(status.account.id) : [];
	}
	update(mediaId: number, input: TrackingUpdate): TrackingOperation {
		const status = this.options.access.status();
		this.options.access.assertCurrent(input.generation);
		if (!status.account || status.state !== "connected")
			throw new DomainError(
				"TRACKING_AUTHORIZATION_REQUIRED",
				"Reconnect AniList before changing viewing state.",
			);
		if (this.lifetime.signal.aborted)
			this.failure("TRACKING_UNAVAILABLE", "Tracking stopped.");
		const desired = input.desired;
		if (
			!Number.isSafeInteger(mediaId) ||
			mediaId <= 0 ||
			mediaId > 2147483647 ||
			!Object.keys(desired).length ||
			(desired.progress !== undefined &&
				(!Number.isInteger(desired.progress) ||
					desired.progress < 0 ||
					desired.progress > 2147483647))
		)
			this.failure(
				"INVALID_REQUEST",
				"Enter a nonnegative progress or a tracking status.",
			);
		const operations = this.operations(input.generation);
		const previous = operations.find((op) => op.mediaId === mediaId);
		if ((previous?.revision ?? null) !== input.revision)
			this.failure(
				"TRACKING_CONFLICT",
				"Viewing operation changed; reload before editing.",
			);
		if (previous?.state === "conflict")
			this.failure("TRACKING_CONFLICT", "Resolve the remote conflict first.");
		if (!input.baseline && !desired.status && (!previous || terminal(previous)))
			this.failure(
				"INVALID_REQUEST",
				"Choose an initial status when adding to AniList.",
			);
		if (
			(!previous || terminal(previous)) &&
			operations.filter((op) => !terminal(op)).length >= 100
		)
			this.failure(
				"TRACKING_UNAVAILABLE",
				"Tracking pending operation capacity reached.",
			);
		if (!previous && operations.length >= 1000) {
			const oldest = operations
				.filter(terminal)
				.sort((a, b) => a.updatedAt - b.updatedAt)[0];
			if (!oldest)
				this.failure(
					"TRACKING_UNAVAILABLE",
					"Tracking operation capacity reached.",
				);
			this.options.store.remove(oldest.id);
		}
		const pending = previous && !terminal(previous);
		const operation: TrackingOperation = {
			id: previous?.id ?? randomUUID(),
			completion: input.completion ?? false,
			accountId: status.account.id,
			mediaId,
			revision: (previous?.revision ?? 0) + 1,
			baseline: pending ? previous.baseline : input.baseline,
			desired: { ...(pending ? previous.desired : {}), ...desired },
			state:
				previous?.state === "submitting" && this.active
					? "submitting"
					: "pending",
			remote: pending ? previous.remote : input.baseline,
			attempt: pending ? previous.attempt : null,
			attempts: 0,
			retryAt: null,
			error: null,
			updatedAt: this.now(),
		};
		this.persist(operation);
		this.wake();
		return operation;
	}
	private command(
		id: string,
		input: TrackingOperationCommand,
	): TrackingOperation {
		const operation = this.operations(input.generation).find(
			(op) => op.id === id,
		);
		if (!operation || operation.revision !== input.revision)
			this.failure(
				"TRACKING_CONFLICT",
				"Viewing operation changed. Reload and retry.",
			);
		return operation;
	}
	retryOperation(
		id: string,
		input: TrackingOperationCommand,
	): TrackingOperation {
		const op = this.command(id, input);
		if (op.state !== "failed" && op.state !== "authorization-required")
			this.failure("TRACKING_CONFLICT", "This operation cannot be retried.");
		if (this.options.access.status().state !== "connected")
			throw new DomainError(
				"TRACKING_AUTHORIZATION_REQUIRED",
				"Reconnect AniList first.",
			);
		const next: TrackingOperation = {
			...op,
			revision: op.revision + 1,
			state: "pending",
			attempts: 0,
			retryAt: null,
			error: null,
		};
		this.persist(next);
		this.wake();
		return next;
	}
	async resolveOperation(
		id: string,
		input: TrackingOperationCommand,
		keepRemote: boolean,
	): Promise<TrackingOperation> {
		const op = this.command(id, input);
		if (op.state !== "conflict")
			this.failure("TRACKING_CONFLICT", "No conflict to resolve.");
		const lease = await this.options.access.acquire();
		if (lease.generation !== input.generation)
			this.failure("TRACKING_CONFLICT", "Account changed.");
		const signal = AbortSignal.any([lease.signal, this.lifetime.signal]);
		const remote = await this.options.provider.get(lease, op.mediaId, signal);
		signal.throwIfAborted();
		this.command(id, input);
		if (!keepRemote && !remote && !op.desired.status)
			this.failure(
				"INVALID_REQUEST",
				"Remote entry was removed. Keep AniList value, then choose an initial status.",
			);
		const next: TrackingOperation = {
			...op,
			revision: op.revision + 1,
			baseline: remote,
			remote,
			attempt: null,
			state: keepRemote ? "cancelled" : "pending",
			attempts: 0,
			retryAt: null,
			error: null,
		};
		this.persist(next);
		this.options.confirmed(op.accountId, op.mediaId, remote);
		this.wake();
		return next;
	}
	private persist(op: TrackingOperation) {
		op.updatedAt = this.now();
		this.options.store.save(op);
		this.options.logger?.info(
			{
				event: "tracking.operation_state",
				operationId: op.id,
				accountId: op.accountId,
				mediaId: op.mediaId,
				revision: op.revision,
				state: op.state,
				code: op.error,
				retryAt: op.retryAt,
			},
			"AniList viewing operation persisted.",
		);
	}
	private wake() {
		if (this.lifetime.signal.aborted) return;
		this.requested = true;
		if (this.active) return;
		this.active = Promise.resolve()
			.then(async () => {
				while (this.requested && !this.lifetime.signal.aborted) {
					this.requested = false;
					await this.run();
				}
			})
			.catch(() => {
				this.options.logger?.error(
					{ event: "tracking.worker_failed" },
					"Tracking worker failed; durable operations retained.",
				);
			})
			.finally(() => {
				this.active = undefined;
				if (this.requested) this.wake();
			});
	}

	/** Exposed for deterministic fixture execution, also used by the scheduled worker. */
	async flush(): Promise<void> {
		this.wake();
		await this.active;
	}
	private async run() {
		const status = this.options.access.status();
		if (!status.account || status.state !== "connected") return;
		for (const op of this.options.store.list(status.account.id)) {
			if (
				this.lifetime.signal.aborted ||
				this.options.access.status().generation !== status.generation
			)
				return;
			if (
				op.state === "pending" ||
				op.state === "submitting" ||
				op.state === "authorization-required" ||
				(op.state === "failed" &&
					op.retryAt !== null &&
					op.retryAt <= this.now())
			)
				await this.deliver(op, status.generation);
		}
	}
	private async deliver(op: TrackingOperation, generation: string) {
		const attempt: TrackingAttempt = op.attempt ?? {
			revision: op.revision,
			baseline: op.baseline,
			desired: op.desired,
		};
		let signal: AbortSignal | undefined;
		try {
			const lease = await this.options.access.acquire();
			if (lease.generation !== generation) return;
			signal = AbortSignal.any([lease.signal, this.lifetime.signal]);
			let remote = await this.options.provider.get(lease, op.mediaId, signal);
			signal.throwIfAborted();
			this.options.access.assertCurrent(generation);
			if (!matches(remote, attempt.desired)) {
				if (!unchanged(remote, attempt)) {
					const latest = this.options.store
						.list(op.accountId)
						.find((item) => item.id === op.id);
					if (!latest) return;
					this.persist({
						...latest,
						state: "conflict",
						remote,
						retryAt: null,
						error: "remote-changed",
					});
					return;
				}
				// Persist the exact payload before dispatch; restart/cancellation must reconcile it.
				const latest = this.options.store
					.list(op.accountId)
					.find((item) => item.id === op.id);
				if (!latest) return;
				this.persist({ ...latest, attempt, remote, state: "submitting" });
				remote = await this.options.provider.save(
					lease,
					op.mediaId,
					remote?.id ?? null,
					attempt.desired,
					signal,
				);
				signal.throwIfAborted();
				this.options.access.assertCurrent(generation);
				if (!matches(remote, attempt.desired))
					throw new TrackingListError("invalid-response", null);
			}
			signal.throwIfAborted();
			this.options.access.assertCurrent(generation);
			const latest = this.options.store
				.list(op.accountId)
				.find((item) => item.id === op.id);
			if (!latest) return;
			const complete = matches(remote, latest.desired);
			this.persist({
				...latest,
				baseline: remote,
				remote,
				attempt: null,
				state: complete ? "succeeded" : "pending",
				attempts: 0,
				retryAt: null,
				error: null,
			});
			this.options.confirmed(op.accountId, op.mediaId, remote);
		} catch (error) {
			// The saved attempt remains uncertain on account changes and shutdown.
			if (
				this.lifetime.signal.aborted ||
				signal?.aborted ||
				this.options.access.status().generation !== generation
			)
				return;
			const latest = this.options.store
				.list(op.accountId)
				.find((item) => item.id === op.id);
			if (!latest) return;
			const code =
				error instanceof TrackingListError
					? error.code
					: error instanceof DomainError &&
							error.code === "TRACKING_AUTHORIZATION_REQUIRED"
						? "unauthorized"
						: "unavailable";
			const attempts = latest.attempts + 1;
			const transient = [
				"unavailable",
				"rate-limited",
				"busy",
				"invalid-response",
			].includes(code);
			const retryAt =
				transient && attempts < 5
					? Math.max(
							this.now() +
								Math.min(300_000, 2000 * 2 ** (attempts - 1)) *
									(1 + (this.options.random ?? Math.random)()),
							error instanceof TrackingListError ? (error.retryAt ?? 0) : 0,
						)
					: null;
			this.persist({
				...latest,
				state: code === "unauthorized" ? "authorization-required" : "failed",
				attempt: code === "invalid-request" ? null : latest.attempt,
				attempts,
				retryAt,
				error: code,
			});
			if (code === "unauthorized")
				this.options.access.authorizationFailed(generation);
		}
	}
	async close(): Promise<void> {
		clearInterval(this.timer);
		this.lifetime.abort();
		await this.active;
	}
}
