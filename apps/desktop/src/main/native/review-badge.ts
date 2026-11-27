import { normalizeBadgeCount } from "./quick-navigation.js";

const defaultPollIntervalMs = 30_000;
const defaultRequestTimeoutMs = 10_000;
const reviewSummaryPath = "/api/catalog/reviews/summary";
const reviewMutationPattern =
	/^\/api\/catalog\/reviews\/[^/]+\/(?:reject|remove|reidentify)$/;

interface DesktopBadgeOptions {
	platform: NodeJS.Platform;
	setBadgeCount(count: number): boolean;
}

export interface ReviewBadgeServer {
	origin: string;
	authorization(): string | undefined;
}

export interface ReviewBadgeMonitorOptions {
	server(): ReviewBadgeServer;
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	onCountChange(count: number): void;
	pollIntervalMs?: number;
	requestTimeoutMs?: number;
}

/** Match HTTP catalog routes that change pending review counts. */
export function isReviewMutationPath(pathname: string): boolean {
	return (
		pathname === "/api/catalog/confirmations" ||
		reviewMutationPattern.test(pathname)
	);
}

/** Manages the native application badge count on supported desktop platforms. */
export class DesktopBadge {
	private readonly supported: boolean;
	private count = 0;
	private loggedUnsupported = false;
	private disposed = false;

	constructor(private readonly options: DesktopBadgeOptions) {
		this.supported =
			options.platform === "darwin" || options.platform === "linux";
		if (!this.supported) {
			console.debug("desktop.badge_unsupported_platform", {
				platform: options.platform,
			});
		}
	}

	setCount(count: number): void {
		if (this.disposed || !this.supported) return;
		const next = normalizeBadgeCount(count);
		if (next === this.count) return;
		this.count = next;
		this.apply(next);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.supported && this.count > 0) {
			this.count = 0;
			this.apply(0);
		}
	}

	private apply(count: number): void {
		try {
			const applied = this.options.setBadgeCount(count);
			if (applied) {
				console.debug("desktop.badge_updated", { count });
			} else if (!this.loggedUnsupported) {
				this.loggedUnsupported = true;
				console.debug("desktop.badge_update_unsupported", {
					count,
					platform: this.options.platform,
				});
			}
		} catch (error) {
			console.warn("desktop.badge_update_failed", { count, error });
		}
	}
}

/** Polls the connected server for pending review counts so badges stay fresh in the tray or Dock. */
export class ReviewBadgeMonitor {
	private readonly pollIntervalMs: number;
	private readonly requestTimeoutMs: number;
	private count = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private inFlight: AbortController | undefined;
	private pendingRefresh = false;
	private unsupportedOrigin: string | undefined;
	private failing = false;
	private disposed = false;

	constructor(private readonly options: ReviewBadgeMonitorOptions) {
		this.pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
		this.requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
	}

	start(): void {
		if (this.disposed || this.timer) return;
		this.timer = setInterval(() => this.refresh(), this.pollIntervalMs);
		this.timer.unref();
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		if (this.inFlight) {
			this.pendingRefresh = true;
			return;
		}
		void this.poll();
	}

	resetForServer(): void {
		if (this.disposed) return;
		this.unsupportedOrigin = undefined;
		this.failing = false;
		this.pendingRefresh = false;
		this.inFlight?.abort();
		this.inFlight = undefined;
		this.applyCount(0);
		this.refresh();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		clearInterval(this.timer);
		this.timer = undefined;
		this.pendingRefresh = false;
		this.inFlight?.abort();
		this.inFlight = undefined;
		this.applyCount(0);
	}

	private async poll(): Promise<void> {
		const { origin, authorization } = this.options.server();
		if (origin === this.unsupportedOrigin) {
			this.applyCount(0);
			return;
		}
		const auth = authorization();
		if (!auth) {
			this.failing = false;
			this.applyCount(0);
			return;
		}

		const controller = new AbortController();
		this.inFlight = controller;
		try {
			const response = await this.options.fetch(
				new URL(reviewSummaryPath, origin).href,
				{
					headers: { Authorization: auth },
					credentials: "omit",
					redirect: "error",
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(this.requestTimeoutMs),
					]),
				},
			);
			if (
				this.disposed ||
				controller.signal.aborted ||
				this.options.server().origin !== origin
			) {
				await response.body?.cancel();
				return;
			}

			if (response.status === 404) {
				await response.body?.cancel();
				this.unsupportedOrigin = origin;
				this.failing = false;
				console.info("desktop.review_badge_endpoint_unavailable", { origin });
				this.applyCount(0);
				return;
			}
			if (response.status === 401 || response.status === 403) {
				await response.body?.cancel();
				this.failing = false;
				console.debug("desktop.review_badge_unauthorized", {
					origin,
					status: response.status,
				});
				this.applyCount(0);
				return;
			}
			if (!response.ok) {
				await response.body?.cancel();
				const log = this.failing ? console.debug : console.warn;
				log("desktop.review_badge_poll_failed", {
					origin,
					status: response.status,
				});
				this.failing = true;
				return;
			}

			const body: unknown = await response.json();
			if (
				this.disposed ||
				controller.signal.aborted ||
				this.options.server().origin !== origin
			)
				return;

			if (
				!body ||
				typeof body !== "object" ||
				!("pending" in body) ||
				typeof body.pending !== "number" ||
				!Number.isSafeInteger(body.pending) ||
				body.pending < 0
			) {
				console.warn("desktop.review_badge_invalid_response");
				return;
			}
			this.failing = false;
			this.applyCount(body.pending);
		} catch (error) {
			if (this.disposed || controller.signal.aborted) return;
			const log = this.failing ? console.debug : console.warn;
			log("desktop.review_badge_poll_error", { origin, error });
			this.failing = true;
		} finally {
			if (this.inFlight === controller) {
				this.inFlight = undefined;
				if (this.pendingRefresh && !this.disposed) {
					this.pendingRefresh = false;
					void this.poll();
				}
			}
		}
	}

	private applyCount(count: number): void {
		const next = normalizeBadgeCount(count);
		if (next === this.count) return;
		this.count = next;
		this.options.onCountChange(next);
	}
}
