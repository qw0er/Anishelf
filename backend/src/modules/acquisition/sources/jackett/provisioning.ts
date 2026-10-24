import { SourceError } from "../domain/model.js";

/** Management cookies never escape this bundled-only operation. */
export async function provisionPublicSite(options: {
	url: string;
	signal: AbortSignal;
	guard: () => void;
	beforeWrite: () => Promise<void>;
	request?: typeof fetch;
}) {
	const request = options.request ?? fetch;
	const signal = () =>
		AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]);
	options.guard();
	const login = await request(
		new URL("UI/Login?cookiesChecked=1", options.url),
		{ redirect: "manual", signal: signal() },
	);
	const cookie = login.headers
		.getSetCookie()
		.filter((value) => value.startsWith("Jackett="))
		.map((value) => value.split(";")[0])
		.join("; ");
	await login.body?.cancel();
	if (login.status !== 302 || !cookie)
		throw new SourceError(
			login.status >= 500
				? "source_unavailable"
				: "bundled_management_required",
		);
	const call = async (path: string, method = "GET", body?: unknown) => {
		options.guard();
		const response = await request(new URL(path, options.url), {
			method,
			redirect: "error",
			signal: signal(),
			headers: {
				Cookie: cookie,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new SourceError("source_unavailable");
		}
		if (response.status === 204) return null;
		// Bound the response before buffering it; management errors must not expose payloads.
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of response.body ?? []) {
			size += chunk.byteLength;
			if (size > 2 * 1024 * 1024) throw new SourceError("invalid_response");
			chunks.push(chunk);
		}
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return value;
	};
	const configured = await call("api/v2.0/indexers?configured=true");
	if (!Array.isArray(configured)) throw new SourceError("invalid_response");
	if (configured.some((row) => row && row.id === "nyaasi" && row.configured))
		return;
	const configuration = await call("api/v2.0/indexers/nyaasi/config");
	if (!Array.isArray(configuration)) throw new SourceError("invalid_response");
	options.guard();
	// Journal before dispatch; recovery queries configured sites before retrying.
	await options.beforeWrite();
	options.guard();
	await call("api/v2.0/indexers/nyaasi/config", "POST", configuration);
	options.guard();
	const verified = await call("api/v2.0/indexers?configured=true");
	if (
		!Array.isArray(verified) ||
		!verified.some((row) => row && row.id === "nyaasi" && row.configured)
	)
		throw new SourceError("source_unavailable");
}
