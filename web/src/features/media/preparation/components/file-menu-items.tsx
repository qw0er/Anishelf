import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "../../../../shared/components/ui/dropdown-menu.js";
import { deletePreparedMedia } from "../api.js";
import { usePreparationContext } from "../context.js";
import { preparationSourceQuery } from "../queries.js";
import { usePreparationAction } from "../use-preparations.js";
import { PreparationButton } from "./preparation-button.js";

export function PreparationFileMenuItems({
	fileId,
	sourceVersion,
	enabled = true,
	list,
}: {
	fileId: string;
	sourceVersion?: string | undefined;
	enabled?: boolean;
	list: ReturnType<
		typeof import("../use-file-preparations.js").useFilePreparations
	>;
}) {
	const source = useQuery({
		...preparationSourceQuery(fileId, sourceVersion),
		enabled,
	});
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const tasks = list.tasks;
	const artifacts = [
		...new Map(
			tasks
				.filter((task) => task.artifactId && task.status === "ready")
				.map((task) => [task.artifactId, task]),
		).values(),
	];
	return (
		<>
			<PreparationButton
				fileId={fileId}
				source={source.data ?? null}
				onRecheck={() => void source.refetch()}
				menuItem
				tasks={tasks}
			/>
			{list.error !== null && (
				<DropdownMenuItem onClick={list.refresh}>
					<RefreshCw className="size-4" aria-hidden="true" />
					{t("preparation.refresh")}
				</DropdownMenuItem>
			)}
			{artifacts.map((task) => (
				<DropdownMenuItem
					closeOnClick={false}
					key={task.artifactId}
					disabled={action.busy}
					className="text-destructive"
					onClick={() =>
						void action.run(async (signal) => {
							if (task.artifactId)
								await deletePreparedMedia(task.artifactId, { signal });
						})
					}
				>
					<Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
					{t("preparation.delete")}
					{artifacts.length > 1 && (
						<span className="max-w-32 truncate text-muted-foreground">
							{task.audioStreamIndices !== undefined &&
								(task.audioStreamIndices.length
									? `${t("audioTracks.retained", { count: task.audioStreamIndices.length })} · `
									: `${t("audioTracks.none")} · `)}
							{preparation.catalog?.profiles.find(
								(profile) => profile.id === task.profileId,
							)?.name ?? t("preparation.profile")}
						</span>
					)}
				</DropdownMenuItem>
			))}
		</>
	);
}
