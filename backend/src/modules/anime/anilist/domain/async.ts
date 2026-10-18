import { setTimeout as delay } from "node:timers/promises";

export { abortable } from "../../../../shared/abortable.js";
export async function pause(ms: number, signal: AbortSignal): Promise<void> {
	const until = Date.now() + Math.max(0, ms);
	while (Date.now() < until)
		await delay(Math.min(until - Date.now(), 60000), undefined, { signal });
	signal.throwIfAborted();
}
