import type { SubtitlePreparationError } from "./model.js";
/** Machine-readable failure independent of diagnostics or localized messages. */
export class SubtitlePreparationFailure extends Error {
	constructor(readonly code: SubtitlePreparationError) {
		super("Subtitle preparation failed.");
		this.name = "SubtitlePreparationFailure";
	}
}
