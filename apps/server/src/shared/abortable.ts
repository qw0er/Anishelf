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
