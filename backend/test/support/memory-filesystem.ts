import { tmpdir } from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { beforeEach } from "vitest";

const volume = new Volume();
export const memoryFs = createFsFromVolume(volume);

// Opt in per suite with vi.mock("node:fs/promises"). Native filesystem and
// migration reads remain real; never use this helper for native watchers/tools.
beforeEach(() => {
	volume.reset();
	memoryFs.mkdirSync(tmpdir(), { recursive: true });
});
