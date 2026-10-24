import type { Dispatcher } from "undici";

/** Bytes drained from a body that will never be parsed before the connection is reset. */
const discardLimit = 64 * 1024;

/**
 * Releases a response body whose payload is not needed.
 *
 * `body.destroy()` is not a safe shortcut for "ignore this body": undici turns a
 * destroy of an unfinished body into a `RequestAbortedError` that it emits on
 * the next tick. A body that was never read has no `error` listener, so Node
 * treats that as an unhandled `error` event and terminates the process. Draining
 * through `dump()` keeps the internal listener, bounds how many bytes are read
 * and lets the connection return to the keep-alive pool.
 */
export async function discardBody(
	response: Dispatcher.ResponseData,
	limit = discardLimit,
): Promise<void> {
	try {
		await response.body.dump({ limit });
	} catch {
		// The body is already unusable; there is nothing left to release.
	}
}
