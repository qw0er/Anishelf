import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher, request } from "undici";
import { RssError } from "../domain/model.js";
import { discoveryPolicy as policy } from "../policy.js";
import type { FeedTransport } from "../ports.js";

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
		throw new RssError("invalid_url");
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
	constructor(dispatcher?: Dispatcher) {
		this.agent =
			dispatcher ??
			new Agent({
				connections: 2,
				connect: { lookup: publicLookup },
				maxResponseSize: policy.maximumBodyBytes,
			});
	}
	async fetch(
		input: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
	) {
		const combined = AbortSignal.any([
			signal,
			this.shutdown.signal,
			AbortSignal.timeout(policy.timeoutMs),
		]);
		let url = rssUrl(input);
		const origin = new URL(url).origin;
		try {
			for (let redirects = 0; redirects <= 3; redirects++) {
				const response = await request(url, {
					dispatcher: this.agent,
					signal: combined,
					headers: {
						accept: "application/rss+xml, application/xml, text/xml",
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
					response.body.destroy();
					if (redirects === 3 || typeof response.headers.location !== "string")
						throw new RssError("redirect_failed");
					const next = rssUrl(new URL(response.headers.location, url).href);
					if (
						new URL(url).protocol === "https:" &&
						new URL(next).protocol !== "https:"
					)
						throw new RssError("redirect_failed");
					url = next;
					continue;
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
					response.body.destroy();
					return {
						xml: null,
						etag: etag ?? validators.etag,
						lastModified: lastModified ?? validators.lastModified,
					};
				}
				if (
					response.statusCode !== 200 ||
					(response.headers["content-encoding"] &&
						response.headers["content-encoding"] !== "identity")
				) {
					response.body.destroy();
					throw new RssError("http_failed");
				}
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of response.body) {
					size += chunk.length;
					if (size > policy.maximumBodyBytes) {
						response.body.destroy();
						throw new RssError("feed_too_large");
					}
					chunks.push(Buffer.from(chunk));
				}
				const xml = Buffer.concat(chunks).toString("utf8");
				return { xml, etag, lastModified };
			}
			throw new RssError("redirect_failed");
		} catch (error) {
			if (error instanceof RssError) throw error;
			throw new RssError(
				combined.aborted ? "request_cancelled" : "fetch_failed",
			);
		}
	}
	async close() {
		this.shutdown.abort();
		await this.agent.close();
	}
}
