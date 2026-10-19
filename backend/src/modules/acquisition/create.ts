import httpProxy from "@fastify/http-proxy";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Logger } from "pino";
import { QbittorrentWebUiSchema } from "../../contracts/schemas/qbittorrent.js";
import type { HttpInstance } from "../../transport/instance.js";
import type { PersistentSettings } from "../system/public.js";

const proxyPath = "/integrations/qbittorrent";

export function createAcquisitionModule(options: {
	settings: () => Pick<Readonly<PersistentSettings>, "qbittorrentWebUiUrl">;
	upstream?: string | undefined;
	secure: boolean;
	logger: Logger;
}) {
	const logger = options.logger.child({ module: "acquisition" });
	const snapshot = () => ({
		url: options.settings().qbittorrentWebUiUrl ?? `${proxyPath}/`,
		proxyConfigured: !!options.upstream,
	});
	return {
		registerHttp(app: HttpInstance) {
			app.register(async (plugin) => {
				const scope = plugin.withTypeProvider<TypeBoxTypeProvider>();
				scope.get(
					"/api/integrations/qbittorrent",
					{ schema: { response: { 200: QbittorrentWebUiSchema } } },
					async () => snapshot(),
				);
				if (!options.upstream) {
					scope.all(proxyPath, async (_request, reply) =>
						reply
							.code(503)
							.type("text/plain")
							.send(
								"Configure ANISHELF_QBITTORRENT_URL and restart Anishelf to enable the qBittorrent proxy.",
							),
					);
					scope.all(`${proxyPath}/*`, async (_request, reply) =>
						reply
							.code(503)
							.type("text/plain")
							.send(
								"Configure ANISHELF_QBITTORRENT_URL and restart Anishelf to enable the qBittorrent proxy.",
							),
					);
					return;
				}
				const upstream = new URL(options.upstream);
				const rejectedRedirects = new WeakSet<object>();
				await scope.register(httpProxy, {
					upstream: upstream.origin,
					prefix: proxyPath,
					rewritePrefix: "",
					websocket: false,
					internalRewriteLocationHeader: false,
					disableRequestLogging: true,
					preHandler: async (request, reply) => {
						if (
							new URL(request.url, "http://localhost").pathname === proxyPath
						) {
							if (request.method === "GET" || request.method === "HEAD")
								return reply.code(308).redirect(`${proxyPath}/`);
							return reply
								.code(400)
								.send("Use the qBittorrent URL with a trailing slash.");
						}
					},
					replyOptions: {
						retriesCount: 0,
						timeout: 30_000,
						rewriteRequestHeaders(request, headers) {
							const result = { ...headers };
							for (const key of Object.keys(result)) {
								if (
									key === "cookie" ||
									key === "authorization" ||
									key === "forwarded" ||
									key === "x-csrf-token" ||
									key.startsWith("x-forwarded-")
								)
									delete result[key];
							}
							result.host = upstream.host;
							const sid = request.cookies.anishelf_qbt_sid;
							if (sid && /^[a-zA-Z0-9_-]+$/.test(sid))
								result.cookie = `SID=${sid}`;
							if (request.headers.origin) result.origin = upstream.origin;
							if (request.headers.referer) {
								try {
									const source = new URL(request.headers.referer);
									result.referer = new URL(
										source.pathname.startsWith(`${proxyPath}/`)
											? source.pathname.slice(proxyPath.length)
											: "/",
										upstream,
									).href;
								} catch {
									// Unsafe requests were already rejected by the origin hook.
									delete result.referer;
								}
							}
							return result;
						},
						rewriteHeaders(headers, request) {
							const result = { ...headers, "cache-control": "no-store" };
							delete result["set-cookie"];
							const cookies = headers["set-cookie"] ?? [];
							const mapped = cookies
								.filter((cookie) => cookie.startsWith("SID="))
								.map((cookie) => {
									const [pair, ...attributes] = cookie.split(";");
									const retained = attributes.filter(
										(attribute) =>
											!/^\s*(domain|path|secure|samesite)(=|\s*$)/i.test(
												attribute,
											),
									);
									return [
										`anishelf_qbt_sid=${pair?.slice(4)}`,
										...retained,
										` Path=${proxyPath}/`,
										" SameSite=Strict",
										...(options.secure ? [" Secure"] : []),
									].join(";");
								});
							if (mapped.length) result["set-cookie"] = mapped;
							if (headers.location) {
								delete result.location;
								try {
									const target = new URL(
										headers.location,
										new URL(
											request?.url.slice(proxyPath.length) || "/",
											upstream,
										),
									);
									if (target.origin === upstream.origin)
										result.location = `${proxyPath}${target.pathname}${target.search}${target.hash}`;
								} catch {
									/* Invalid redirects are rejected below. */
								}
							}
							if (headers.location && !result.location && request)
								rejectedRedirects.add(request);
							return result;
						},
						onResponse(request, reply, response) {
							if (rejectedRedirects.delete(request)) {
								response.stream.destroy();
								reply.removeHeader("content-length");
								reply.removeHeader("content-encoding");
								reply.removeHeader("set-cookie");
								logger.warn(
									{ event: "qbittorrent.proxy_redirect_rejected" },
									"Rejected an unexpected qBittorrent redirect.",
								);
								void reply
									.code(502)
									.type("text/plain")
									.send("qBittorrent returned an unexpected redirect.");
								return;
							}
							void reply.send(response.stream);
						},
						onError(reply) {
							logger.warn(
								{ event: "qbittorrent.proxy_unavailable" },
								"qBittorrent WebUI could not be reached.",
							);
							void reply
								.code(502)
								.type("text/plain")
								.send(
									"qBittorrent WebUI is unavailable. Check the configured endpoint and connectivity.",
								);
						},
					},
				});
				logger.info(
					{ event: "qbittorrent.proxy_registered" },
					"Authenticated qBittorrent WebUI proxy enabled.",
				);
			});
		},
	};
}
