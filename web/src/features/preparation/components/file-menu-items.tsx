import { RefreshCw, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cancelPreparation, deletePreparedMedia } from "../../../api/client.js";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { DropdownMenuItem } from "../../../components/ui/dropdown-menu.js";
import { usePreparationContext } from "../context.js";
import { usePreparationAction } from "../use-preparations.js";
import { PreparationButton } from "./preparation-button.js";

export function PreparationFileMenuItems({
	fileId,
	list,
	...compatibility
}: {
	fileId: string;
	list: ReturnType<
		typeof import("../use-file-preparations.js").useFilePreparations
	>;
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
	onRecheck(): void;
}) {
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
	function refresh() {
		list.refresh();
		preparation.refresh();
	}
	return (
		<>
			{!list.loading && (
				<PreparationButton
					fileId={fileId}
					{...compatibility}
					menuItem
					tasks={tasks}
				/>
			)}
			{list.error !== null && (
				<DropdownMenuItem onClick={list.refresh}>
					<RefreshCw className="size-4" aria-hidden="true" />
					{t("preparation.refresh")}
				</DropdownMenuItem>
			)}
			{tasks
				.filter(
					(task) =>
						task.status === "queued" ||
						task.status === "processing" ||
						task.status === "cancelling",
				)
				.map((task) => (
					<DropdownMenuItem
						key={task.id}
						disabled={action.busy}
						onClick={() =>
							void action.run(async (signal) => {
								await cancelPreparation(task.id, { signal });
								refresh();
							})
						}
					>
						<X className="size-4" aria-hidden="true" />
						{t("preparation.cancel")}
					</DropdownMenuItem>
				))}
			{artifacts.map((task) => (
				<DropdownMenuItem
					key={task.artifactId}
					disabled={action.busy}
					className="text-destructive"
					onClick={() =>
						void action.run(async (signal) => {
							if (task.artifactId)
								await deletePreparedMedia(task.artifactId, { signal });
							refresh();
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
