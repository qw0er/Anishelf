import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher, request } from "undici";
import { sourcePolicy as policy, SourceError } from "../domain/model.js";
import type { SourceRequestGate } from "../infrastructure/request-gate.js";
import { sourceOriginKey } from "../infrastructure/request-keys.js";
import { discardBody } from "../infrastructure/response-body.js";
import { sourceRetryAt } from "../infrastructure/retry-after.js";
import type { FeedTransport } from "./ports.js";

export function isPublicAddress(address: string): boolean {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}
export function rssUrl(input: string): string {
	try {
		if (!input || input.length > 4096 || /[\s\\]/.test(input))
			throw new Error();
		const url = new URL(input);
		const hostname = url.hostname.replace(/^\[|\]$/g, "");
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			(ipaddr.isValid(hostname) && !isPublicAddress(hostname)) ||
			(!hostname.includes(".") && !ipaddr.isValid(hostname)) ||
			/\.(?:local|localhost|internal)$/i.test(hostname) ||
			url.href.length > 4096
		)
			throw new Error();
		return url.href;
	} catch {
		throw new SourceError("invalid_url");
	}
}
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { all: true }, (error, addresses) => {
		if (error) {
			callback(error, "");
			return;
		}
		if (
			!addresses.length ||
			addresses.some((entry) => !isPublicAddress(entry.address))
		) {
			callback(new Error("RSS destination is unavailable."), "");
			return;
		}
		const filtered = addresses.filter(
			(entry) => !options.family || entry.family === options.family,
		);
		const first = filtered[0];
		if (!first) {
			callback(new Error("RSS address family is unavailable."), "");
			return;
		}
		callback(null, options.all ? filtered : first.address, first.family);
	});
};

/** DNS validation happens at connection time; redirects are checked independently. */
export class RssTransport implements FeedTransport {
	private readonly shutdown = new AbortController();
	private readonly agent: Dispatcher;
	constructor(
		dispatcher?: Dispatcher,
		readonly requestGate?: SourceRequestGate,
	) {
		this.agent =
			dispatcher ??
			new Agent({
				connections: 2,
				connect: { lookup: publicLookup },
				maxResponseSize: 10 * 1024 * 1024,
			});
	}
	async fetch(
		input: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
	) {
		const response = await this.body(
			input,
			validators,
			signal,
			policy.maximumBodyBytes,
		);
		return {
			xml:
				response.bytes === null
					? null
					: Buffer.from(response.bytes).toString("utf8"),
			etag: response.etag,
			lastModified: response.lastModified,
		};
	}
	async read(
		input: string,
		signal: AbortSignal,
		additionalKeys: readonly string[] = [],
		requestGate = this.requestGate,
	): Promise<Uint8Array<ArrayBuffer>> {
		const response = await this.body(
			input,
			{ etag: null, lastModified: null },
			signal,
			10 * 1024 * 1024,
			additionalKeys,
			requestGate,
		);
		if (response.bytes === null) throw new SourceError("http_failed");
		return response.bytes;
	}
	private async body(
		input: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
		maximumBytes: number,
		additionalKeys: readonly string[] = [],
		requestGate = this.requestGate,
	) {
		const combined = AbortSignal.any([signal, this.shutdown.signal]);
		let url = rssUrl(input);
		const origin = new URL(url).origin;
		try {
			for (let redirects = 0; redirects <= 3; redirects++) {
				const exchange = () =>
					this.exchange(url, origin, validators, combined, maximumBytes);
				const response = requestGate
					? await requestGate.runMany(
							[sourceOriginKey(url), ...additionalKeys],
							combined,
							exchange,
						)
					: await exchange();
				if (response.kind === "redirect") {
					if (redirects === 3) throw new SourceError("redirect_failed");
					const next = rssUrl(new URL(response.location, url).href);
					if (
						new URL(url).protocol === "https:" &&
						new URL(next).protocol !== "https:"
					)
						throw new SourceError("redirect_failed");
					url = next;
					continue;
				}
				return response;
			}
			throw new SourceError("redirect_failed");
		} catch (error) {
			if (error instanceof SourceError) throw error;
			throw new SourceError(
				combined.aborted ? "request_cancelled" : "fetch_failed",
			);
		}
	}
	private async exchange(
		url: string,
		origin: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
		maximumBytes: number,
	) {
		// Queue waits do not consume the individual HTTP request timeout.
		const combined = AbortSignal.any([
			signal,
			AbortSignal.timeout(policy.timeoutMs),
		]);
		try {
			const response = await request(url, {
				dispatcher: this.agent,
				signal: combined,
				headers: {
					accept:
						"application/rss+xml, application/xml, application/x-bittorrent, application/octet-stream, text/xml",
					"accept-encoding": "identity",
					...(new URL(url).origin === origin && validators.etag
						? { "if-none-match": validators.etag }
						: {}),
					...(new URL(url).origin === origin && validators.lastModified
						? { "if-modified-since": validators.lastModified }
						: {}),
				},
			});
			if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
				await discardBody(response);
				if (typeof response.headers.location !== "string")
					throw new SourceError("redirect_failed");
				return {
					kind: "redirect" as const,
					location: response.headers.location,
				};
			}
			if (response.statusCode === 429 || response.statusCode === 503) {
				await discardBody(response);
				throw new SourceError(
					"rate_limited",
					sourceRetryAt(response.headers["retry-after"]),
				);
			}
			const etag =
				typeof response.headers.etag === "string"
					? response.headers.etag.slice(0, 1024)
					: null;
			const lastModified =
				typeof response.headers["last-modified"] === "string"
					? response.headers["last-modified"].slice(0, 256)
					: null;
			if (response.statusCode === 304) {
				await discardBody(response);
				return {
					kind: "content" as const,
					bytes: null,
					etag: etag ?? validators.etag,
					lastModified: lastModified ?? validators.lastModified,
				};
			}
			if (
				response.statusCode !== 200 ||
				(response.headers["content-encoding"] &&
					response.headers["content-encoding"] !== "identity")
			) {
				await discardBody(response);
				throw new SourceError("http_failed");
			}
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of response.body) {
				size += chunk.length;
				if (size > maximumBytes) {
					response.body.destroy();
					throw new SourceError("feed_too_large");
				}
				chunks.push(Buffer.from(chunk));
			}
			const bytes = new Uint8Array(Buffer.concat(chunks));
			return { kind: "content" as const, bytes, etag, lastModified };
		} catch (error) {
			if (error instanceof SourceError) throw error;
			throw new SourceError(
				combined.aborted
					? signal.aborted
						? "request_cancelled"
						: "request_timeout"
					: "fetch_failed",
			);
		}
	}
	async close() {
		this.shutdown.abort();
		await this.agent.close();
	}
}
