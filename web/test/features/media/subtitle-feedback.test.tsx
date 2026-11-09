import "../../../src/shared/i18n.js";
// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { SubtitleTracks } from "../../../src/features/media/subtitles/components/subtitle-tracks.js";
import type { PreparationFeedback } from "../../../src/features/media/subtitles/controller.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { act, cleanup, render } from "../../support/query-test-utils.js";

const fixture = vi.hoisted(() => ({
	feedback: null as ((feedback: PreparationFeedback) => void) | null,
	player: { textTracks: {}, textRenderers: { add: vi.fn(), remove: vi.fn() } },
	discovery: { tracks: [], sourceVersion: "version" },
}));
vi.mock("@vidstack/react", () => ({ useMediaPlayer: () => fixture.player }));
vi.mock(
	"../../../src/features/media/subtitles/hooks/use-subtitle-discovery.js",
	() => ({ useSubtitleDiscovery: () => fixture.discovery }),
);
vi.mock("../../../src/features/media/subtitles/controller.js", () => ({
	SubtitleController: class {
		constructor(
			_tracks: unknown,
			_descriptors: unknown,
			_prepare: unknown,
			feedback: (value: PreparationFeedback) => void,
		) {
			fixture.feedback = feedback;
		}
		dispose() {}
		retry() {}
	},
}));
vi.mock("../../../src/features/media/subtitles/renderer.js", () => ({
	StyledSubtitleRenderer: class {},
}));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("subtitle preparation uses the CC busy callback, and only results use scoped persistent toasts", () => {
	const busy = vi.fn();
	const add = vi
		.spyOn(toast, "add")
		.mockReturnValue("subtitle-preparation:file");
	const close = vi.spyOn(toast, "close");
	const view = render(
		<SubtitleTracks
			fileId="file"
			policy={{
				formats: ["vtt"],
				initializationTimeoutMs: 1000,
				memoryMaximumBytes: 1024,
				maximumBytes: 1024,
			}}
			onPreparingChange={busy}
		/>,
	);
	act(() => fixture.feedback?.({ status: "preparing", name: "English" }));
	expect(busy).toHaveBeenLastCalledWith(expect.stringContaining("English"));
	expect(add).not.toHaveBeenCalled();
	act(() =>
		fixture.feedback?.({
			status: "warning",
			name: "English",
			errorCode: "FONT_FALLBACK",
		}),
	);
	expect(busy).toHaveBeenLastCalledWith(null);
	expect(add).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ type: "warning", timeout: 0 }),
	);
	act(() => fixture.feedback?.(null));
	expect(close).toHaveBeenCalledWith("subtitle-preparation:file");
	view.unmount();
	expect(close).toHaveBeenCalledWith("subtitle-preparation:file");
});
