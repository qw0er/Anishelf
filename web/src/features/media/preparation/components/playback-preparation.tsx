import { useEffect, useRef } from "react";
import type { PreparationSource } from "../audio-tracks.js";
import { useFilePreparations } from "../use-file-preparations.js";
import { PreparationButton } from "./preparation-button.js";
export function PlaybackPreparation({
	fileId,
	source,
	showLabel,
	onRecheck,
	onAssetsChanged,
}: {
	fileId: string;
	source: PreparationSource | null;
	showLabel: boolean;
	onRecheck(): void;
	onAssetsChanged(): void;
}) {
	const prepared = useFilePreparations(fileId);
	const previous = useRef<Map<string, string> | null>(null);
	useEffect(() => {
		const before = previous.current;
		previous.current = new Map(
			prepared.tasks.map((task) => [task.id, task.status]),
		);
		if (
			before &&
			prepared.tasks.some(
				(task) => task.status === "ready" && before.get(task.id) !== "ready",
			)
		)
			onAssetsChanged();
	}, [prepared.tasks, onAssetsChanged]);
	return (
		<PreparationButton
			fileId={fileId}
			source={source}
			tasks={prepared.tasks}
			showLabel={showLabel}
			onRecheck={onRecheck}
			onPrepared={onAssetsChanged}
		/>
	);
}
