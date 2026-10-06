import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CompatibilityResult,
	PreparationSummaryResponse,
} from "../../../api/contracts.js";
import { Button } from "../../../components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { MediaLink } from "../../playback/public.js";
import {
	PreparationFileMenuItems,
	useFilePreparations,
} from "../../preparation/public.js";

import { CompatibilityStatus } from "./compatibility-status.js";

export function FileActions({
	fileId,
	summary,
	...compatibility
}: {
	fileId: string;
	summary?: PreparationSummaryResponse["files"][number] | undefined;
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
	onRecheck(): void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const list = useFilePreparations(fileId, open);
	const prepared =
		summary?.versions.some(
			(version) =>
				version.sourceVersion === compatibility.result?.sourceVersion &&
				version.publishedCopies > 0,
		) ||
		list.tasks.some(
			(task) =>
				task.status === "ready" &&
				task.artifactId &&
				task.playbackAvailability === "ready" &&
				task.sourceVersion === compatibility.result?.sourceVersion,
		);
	return (
		<>
			<CompatibilityStatus
				{...compatibility}
				loading={compatibility.loading}
				prepared={prepared}
			/>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<Tooltip content={t("library.fileActions")}>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								className="size-9 shrink-0 p-0"
								aria-label={t("library.fileActions")}
							/>
						}
					>
						<Ellipsis className="size-4" aria-hidden="true" />
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent>
					<MediaLink fileId={fileId} menuItem />
					<PreparationFileMenuItems
						fileId={fileId}
						list={list}
						{...compatibility}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
