import { QBittorrent } from "@ctrl/qbittorrent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { QbittorrentError } from "../domain/model.js";

const addResult = Type.Object({
	success_count: Type.Integer({ minimum: 0 }),
	pending_count: Type.Integer({ minimum: 0 }),
	failure_count: Type.Integer({ minimum: 0 }),
	added_torrent_ids: Type.Array(Type.String()),
});

/** The SDK accepts arbitrary add-response text; require a recognized receipt. */
export class ValidatedQbittorrentSdk extends QBittorrent {
	override async request<T>(
		...args: Parameters<QBittorrent["request"]>
	): Promise<T> {
		const result = await super.request<T>(...args);
		if (
			args[0] === "/torrents/add" &&
			result !== "Ok." &&
			result !== "Fails."
		) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(result));
			} catch {
				parsed = null;
			}
			if (
				!Check(addResult, parsed) ||
				parsed.success_count + parsed.pending_count + parsed.failure_count !== 1
			)
				throw new QbittorrentError("invalid-response", "unknown");
		}
		return result;
	}
}
