import type { Logger } from "pino";
import type { LibraryChange } from "../domain/model.js";

export class LibraryPublication {
	private readonly listeners = new Set<(change: LibraryChange) => void>();

	constructor(private readonly logger: Logger) {}

	subscribe(listener: (change: LibraryChange) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	notify(change: LibraryChange): void {
		for (const listener of this.listeners)
			try {
				listener(change);
			} catch (err) {
				this.logger.warn(
					{ event: "scan.listener_failed", err },
					"Library snapshot listener failed.",
				);
			}
	}
	close(): void {
		this.listeners.clear();
	}
}
