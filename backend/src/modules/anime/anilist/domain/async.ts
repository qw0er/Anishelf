import { setTimeout as delay } from "node:timers/promises";
/** Detach one subscriber without canceling another subscriber's operation. */
export async function abortable<T>(
	task: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	signal.throwIfAborted();
	let listener = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		listener = () => reject(signal.reason);
		signal.addEventListener("abort", listener, { once: true });
	});
	try {
		return await Promise.race([task, aborted]);
	} finally {
		signal.removeEventListener("abort", listener);
	}
}
export async function pause(ms: number, signal: AbortSignal): Promise<void> {
	const until = Date.now() + Math.max(0, ms);
	while (Date.now() < until)
		await delay(Math.min(until - Date.now(), 60000), undefined, { signal });
	signal.throwIfAborted();
}
