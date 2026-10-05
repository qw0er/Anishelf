import { usePreparationContext } from "./context.js";
import { usePreparations } from "./use-preparations.js";

/** Include older outputs beyond the global recent-task window. */
export function useFilePreparations(fileId: string) {
	const preparation = usePreparationContext();
	const list = usePreparations(fileId);
	return {
		...list,
		tasks: [
			...new Map(
				[
					...preparation.tasks.filter((task) => task.fileId === fileId),
					...list.tasks,
				].map((task) => [task.id, task]),
			).values(),
		],
	};
}
