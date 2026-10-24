import { SourceError } from "../domain/model.js";
import type { SourceRequestGate } from "../infrastructure/request-gate.js";
import {
	jackettConnectionKey,
	sourceOriginKey,
} from "../infrastructure/request-keys.js";
import { sourceRetryAt } from "../infrastructure/retry-after.js";
import { jackettUrl } from "./validation.js";

/** Management cookies never escape this bundled-only operation. */
export async function provisionPublicSite(options: {
	url: string;
	signal: AbortSignal;
	guard: () => void;
	beforeWrite: () => Promise<void>;
	request?: typeof fetch;
	gate?: SourceRequestGate;
}) {
	const request = options.request ?? fetch;
	const base = jackettUrl(options.url);
	const keys = [sourceOriginKey(base), jackettConnectionKey(base)];
	const signal = () =>
		AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]);
	const admitted = <T>(operation: () => Promise<T>) => {
		const exchange = () => {
			// Configuration can change while this request waits for admission.
			options.guard();
			return operation();
		};
		return options.gate
			? options.gate.runMany(keys, options.signal, exchange)
			: exchange();
	};
	const throttled = async (response: Response) => {
		if (response.status !== 429 && response.status !== 503) return;
		await response.body?.cancel();
		throw new SourceError(
			"rate_limited",
			sourceRetryAt(response.headers.get("retry-after")),
		);
	};
	const cookie = await admitted(async () => {
		const login = await request(new URL("UI/Login?cookiesChecked=1", base), {
			redirect: "manual",
			signal: signal(),
		});
		await throttled(login);
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
		return cookie;
	});
	const call = (path: string, method = "GET", body?: unknown) =>
		admitted(async () => {
			const response = await request(new URL(path, base), {
				method,
				redirect: "error",
				signal: signal(),
				headers: {
					Cookie: cookie,
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			await throttled(response);
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
		});
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
