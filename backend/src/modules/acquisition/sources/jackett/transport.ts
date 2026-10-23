import { Agent, type Dispatcher, request } from "undici";
import type { ReleaseDownload } from "../domain/download.js";
import { SourceError } from "../domain/model.js";
import { RssTransport, rssUrl } from "../rss/transport.js";
import type { TorrentRead } from "./model.js";
import { indexerId, jackettUrl } from "./validation.js";

export class JackettTransport {
	readonly base: string;
	private readonly agent: Dispatcher;
	private readonly publicTransport: RssTransport;
	private readonly shutdown = new AbortController();
	constructor(
		url: string,
		private readonly apiKey: string,
		readonly generation: string,
		dispatcher?: Dispatcher,
		publicTransport?: RssTransport,
	) {
		this.base = jackettUrl(url);
		this.agent =
			dispatcher ??
			new Agent({ connections: 2, maxResponseSize: 10 * 1024 * 1024 });
		this.publicTransport = publicTransport ?? new RssTransport();
	}
	redact(value: string): string {
		return value
			.split(this.apiKey)
			.join("[redacted]")
			.split(encodeURIComponent(this.apiKey))
			.join("[redacted]");
	}
	async api(
		indexer: string | null,
		parameters: Record<string, string>,
		signal: AbortSignal,
	): Promise<string> {
		const id = indexer === null ? "all" : indexerId(indexer);
		if (
			indexer === null &&
			(parameters.t !== "indexers" || parameters.configured !== "true")
		)
			throw new SourceError("invalid_indexer");
		const url = new URL(
			`api/v2.0/indexers/${id}/results/torznab/api`,
			this.base,
		);
		for (const [key, value] of Object.entries(parameters)) {
			if (!["t", "q", "limit", "offset", "configured"].includes(key))
				throw new SourceError("invalid_query");
			url.searchParams.set(key, value);
		}
		url.searchParams.set("apikey", this.apiKey);
		const response = await this.body(url, 5 * 1024 * 1024, signal);
		if (response.redirect) throw new SourceError("redirect_rejected");
		return Buffer.from(response.bytes).toString("utf8");
	}
	download(input: string, indexer: string): ReleaseDownload {
		try {
			if (!input || input.length > 16384 || /[\r\n\0\\]/.test(input))
				throw new Error();
			const url = new URL(input, this.base);
			if (url.username || url.password || url.hash) throw new Error();
			if (url.protocol === "magnet:") {
				if (
					this.hasSecret(input) ||
					!url.searchParams
						.getAll("xt")
						.some((xt) => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt))
				)
					throw new Error();
				return { kind: "magnet", uri: url.href };
			}
			if (url.origin !== new URL(this.base).origin) {
				if (
					this.hasSecret(input) ||
					[...url.searchParams.keys()].some((key) =>
						/api.?key|passkey/i.test(key),
					)
				)
					throw new Error();
				return { kind: "public-torrent", url: rssUrl(url.href) };
			}
			const prefix = new URL(this.base).pathname;
			if (!url.pathname.startsWith(prefix)) throw new Error();
			const parts = url.pathname
				.slice(prefix.length)
				.replace(/\/$/, "")
				.split("/")
				.map(decodeURIComponent);
			if (parts[0] !== "dl" || parts[1] !== indexerId(indexer))
				throw new Error();
			let path: string, file: string;
			if (parts.length === 2) {
				if (
					[...url.searchParams.keys()].some(
						(key) =>
							!["jackett_apikey", "apikey", "path", "file"].includes(key),
					)
				)
					throw new Error();
				for (const key of url.searchParams.keys()) {
					if (url.searchParams.getAll(key).length !== 1) throw new Error();
					if (
						["apikey", "jackett_apikey"].includes(key) &&
						url.searchParams.get(key) !== this.apiKey
					)
						throw new Error();
				}
				path = url.searchParams.get("path") ?? "";
				file = url.searchParams.get("file") ?? "download";
			} else if (
				parts.length === 5 &&
				parts[2] === this.apiKey &&
				!url.search
			) {
				path = parts[3] ?? "";
				file = parts[4] ?? "download";
			} else throw new Error();
			if (
				!/^[A-Za-z0-9_-]{1,8192}$/.test(path) ||
				file.length > 4096 ||
				this.hasSecret(path) ||
				this.hasSecret(file)
			)
				throw new Error();
			return {
				kind: "jackett-torrent",
				generation: this.generation,
				indexerId: indexer,
				path,
				file,
			};
		} catch {
			throw new SourceError("invalid_download_locator");
		}
	}
	private hasSecret(value: string) {
		for (let depth = 0; depth < 3; depth++) {
			if (
				value.includes(this.apiKey) ||
				value.includes(encodeURIComponent(this.apiKey))
			)
				return true;
			try {
				const decoded = decodeURIComponent(value);
				if (decoded === value) break;
				value = decoded;
			} catch {
				break;
			}
		}
		return false;
	}
	async readTorrent(
		descriptor: ReleaseDownload,
		signal: AbortSignal,
	): Promise<TorrentRead> {
		const combined = AbortSignal.any([
			signal,
			this.shutdown.signal,
			AbortSignal.timeout(30000),
		]);
		let current = descriptor;
		for (let hop = 0; hop < 4; hop++) {
			if (current.kind === "magnet") {
				this.download(current.uri, "validation");
				return { kind: "magnet", uri: current.uri };
			}
			if (current.kind === "public-torrent") {
				if (this.hasSecret(current.url))
					throw new SourceError("invalid_download_locator");
				return {
					kind: "bytes",
					bytes: await this.publicTransport.read(current.url, combined),
				};
			}
			if (current.generation !== this.generation)
				throw new SourceError("source_conflict");
			const url = new URL(`dl/${indexerId(current.indexerId)}/`, this.base);
			url.search = new URLSearchParams({
				path: current.path,
				file: current.file,
				jackett_apikey: this.apiKey,
			}).toString();
			// Validate even descriptors supplied by an internal caller before reconstructing credentials.
			this.download(url.href, current.indexerId);
			const response = await this.body(url, 10 * 1024 * 1024, combined);
			if (!response.redirect) return { kind: "bytes", bytes: response.bytes };
			if (this.hasSecret(response.redirect))
				throw new SourceError("invalid_download_locator");
			const next = this.download(
				new URL(response.redirect, url).href,
				current.indexerId,
			);
			if (!next) throw new SourceError("invalid_download_locator");
			current = next;
		}
		throw new SourceError("redirect_rejected");
	}
	private async body(url: URL, maximumBytes: number, signal: AbortSignal) {
		const combined = AbortSignal.any([
			signal,
			this.shutdown.signal,
			AbortSignal.timeout(30000),
		]);
		try {
			const response = await request(url, {
				dispatcher: this.agent,
				signal: combined,
				headers: {
					"accept-encoding": "identity",
					accept: "application/xml, application/x-bittorrent",
				},
			});
			const status = response.statusCode;
			if ([301, 302, 303, 307, 308].includes(status)) {
				response.body.destroy();
				if (typeof response.headers.location !== "string")
					throw new SourceError("redirect_rejected");
				return { bytes: new Uint8Array(), redirect: response.headers.location };
			}
			if (status === 401 || status === 403) {
				response.body.destroy();
				throw new SourceError("authentication_failed");
			}
			if (status === 429) {
				response.body.destroy();
				const value = String(response.headers["retry-after"] ?? "60");
				const retryAt = /^\d+$/.test(value)
					? Date.now() + Number(value) * 1000
					: Date.parse(value);
				throw new SourceError(
					"rate_limited",
					Number.isFinite(retryAt)
						? Math.max(Date.now(), retryAt)
						: Date.now() + 60000,
				);
			}
			if (
				status !== 200 ||
				(response.headers["content-encoding"] &&
					response.headers["content-encoding"] !== "identity")
			) {
				response.body.destroy();
				throw new SourceError("upstream_failure");
			}
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of response.body) {
				size += chunk.length;
				if (size > maximumBytes) {
					response.body.destroy();
					throw new SourceError("response_too_large");
				}
				chunks.push(Buffer.from(chunk));
			}
			return { bytes: new Uint8Array(Buffer.concat(chunks)), redirect: null };
		} catch (error) {
			if (error instanceof SourceError) throw error;
			throw new SourceError(
				combined.aborted
					? signal.aborted || this.shutdown.signal.aborted
						? "request_cancelled"
						: "request_timeout"
					: "upstream_failure",
			);
		}
	}
	async close() {
		this.shutdown.abort();
		await Promise.allSettled([
			this.agent.close(),
			this.publicTransport.close(),
		]);
	}
}
