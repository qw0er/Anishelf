/** Stop producers before consumers release shared resources; attempt all cleanup. */
export async function closeModules(owners: {
	anime: { quiesce(): Promise<void>; close(): Promise<void> };
	media: { quiesce(): Promise<void>; close(): Promise<void> };
	resources: { quiesce(): Promise<void>; close(): Promise<void> };
	playback: { close(): void | Promise<void> };
	database?: { close(): void } | undefined;
}): Promise<void> {
	const failures: unknown[] = [];
	for (const operation of [
		() => owners.playback.close(),
		() => owners.anime.quiesce(),
		() => owners.media.quiesce(),
		() => owners.resources.quiesce(),
		() => owners.anime.close(),
		() => owners.media.close(),
		() => owners.resources.close(),
		() => owners.database?.close(),
	])
		try {
			await operation();
		} catch (error) {
			failures.push(error);
		}
	if (failures.length)
		throw new AggregateError(failures, "Module shutdown failed.");
}
