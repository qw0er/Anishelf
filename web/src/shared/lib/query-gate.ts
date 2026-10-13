/** Limit expensive browser/server negotiations, including queued cancellation. */
export function queryGate(limit: number) {
	let active = 0;
	const queue: Array<() => void> = [];
	return async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
		signal.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			const start = () => {
				signal.removeEventListener("abort", abort);
				active++;
				resolve();
			};
			const abort = () => {
				const index = queue.indexOf(start);
				if (index >= 0) queue.splice(index, 1);
				reject(signal.reason);
			};
			if (active < limit) start();
			else {
				queue.push(start);
				signal.addEventListener("abort", abort, { once: true });
			}
		});
		try {
			signal.throwIfAborted();
			return await work();
		} finally {
			active--;
			queue.shift()?.();
		}
	};
}
