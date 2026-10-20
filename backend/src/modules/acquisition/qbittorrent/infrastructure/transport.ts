import { AsyncLocalStorage } from "node:async_hooks";
import { Agent, type Dispatcher } from "undici";
import { QbittorrentError } from "../domain/model.js";

export interface RequestContext {
	signal: AbortSignal;
	writeSent: boolean;
	failure?: QbittorrentError;
}

/** Keep SDK transport inside one endpoint, with operation-local cancellation. */
export class QbittorrentTransport {
	readonly context = new AsyncLocalStorage<RequestContext>();
	private readonly agent: Agent;
	readonly dispatcher: Dispatcher;

	constructor(url: URL, maximumBytes: number) {
		this.agent = new Agent({ connections: 2, maxResponseSize: maximumBytes });
		this.dispatcher = this.agent.compose((dispatch) => (options, handler) => {
			const context = this.context.getStore();
			if (!context) throw new Error("Missing qBittorrent request context.");
			context.signal.throwIfAborted();
			if (String(options.origin) !== url.origin)
				throw new QbittorrentError("redirect", "not-sent");
			const isWrite =
				options.method === "POST" &&
				!options.path.split("?")[0]?.endsWith("/auth/login");
			let abort = (_error?: Error) => {};
			let controller: Dispatcher.DispatchController | undefined;
			let failed = false;
			const cancel = () => abort(new Error("qBittorrent request cancelled."));
			const finish = () => context.signal.removeEventListener("abort", cancel);
			const reportError = (error: Error) => {
				if (failed || !controller) return;
				failed = true;
				finish();
				handler.onResponseError?.(controller, error);
			};
			const fail = (
				code: "redirect" | "response-too-large" | "invalid-response",
			) => {
				context.failure = new QbittorrentError(
					code,
					context.writeSent ? "unknown" : "read",
				);
				reportError(context.failure);
				abort(context.failure);
			};
			const headers = Array.isArray(options.headers)
				? [...options.headers]
				: Object.entries(options.headers ?? {}).flatMap(([name, value]) => [
						name,
						String(value),
					]);
			const safeHeaders = [];
			for (let index = 0; index < headers.length; index += 2) {
				const name = headers[index];
				if (
					name &&
					!["referer", "accept-encoding"].includes(name.toLowerCase())
				)
					safeHeaders.push(name, headers[index + 1] ?? "");
			}
			return dispatch(
				{
					...options,
					headers: [
						...safeHeaders,
						"referer",
						url.href,
						"accept-encoding",
						"identity",
					],
				},
				{
					onRequestStart: (requestController, requestContext) => {
						controller = requestController;
						abort = (error) =>
							requestController.abort(error ?? new Error("Request aborted."));
						handler.onRequestStart?.(requestController, requestContext);
						context.signal.addEventListener("abort", cancel, { once: true });
						if (context.signal.aborted) {
							cancel();
							return;
						}
						if (isWrite) context.writeSent = true;
					},
					onResponseStart: (controller, status, headers, statusText) => {
						if (status >= 300 && status < 400) {
							fail("redirect");
							return;
						}
						if (
							headers["content-encoding"] &&
							headers["content-encoding"] !== "identity"
						) {
							fail("invalid-response");
							return;
						}
						if (Number(headers["content-length"]) > maximumBytes) {
							fail("response-too-large");
							return;
						}
						handler.onResponseStart?.(controller, status, headers, statusText);
					},
					onResponseData: (controller, chunk) => {
						handler.onResponseData?.(controller, chunk);
					},
					onResponseEnd: (controller, trailers) => {
						finish();
						if (!failed) handler.onResponseEnd?.(controller, trailers);
					},
					onResponseError: (controller, error) => {
						if (
							"code" in error &&
							error.code === "UND_ERR_RES_EXCEEDED_MAX_SIZE"
						)
							context.failure = new QbittorrentError(
								"response-too-large",
								context.writeSent ? "unknown" : "read",
							);
						if (!failed) {
							finish();
							failed = true;
							handler.onResponseError?.(controller, error);
						}
					},
				},
			);
		});
	}
	async close(): Promise<void> {
		await this.agent.destroy();
	}
}
