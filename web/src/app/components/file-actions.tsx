import { Ellipsis } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilePreparations } from "../../features/media/public.js";
import { PreparationFileMenuItems } from "../../features/media/ui.js";
import {
	ExternalPlayerSubmenu,
	MediaLink,
} from "../../features/playback/ui.js";
import { CompatibilityStatus } from "../../features/resources/ui.js";
import type {
	CompatibilityResult,
	PreparationSummaryResponse,
} from "../../shared/api/contracts.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";

export function FileActions({
	fileId,
	summary,
	identification,
	identificationMenu,
	...compatibility
}: {
	fileId: string;
	identification?: ReactNode;
	identificationMenu?: ReactNode;
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
			{identification}
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
					{identificationMenu}
					<ExternalPlayerSubmenu fileId={fileId} />
					<MediaLink fileId={fileId} menuItem />
					<MediaLink fileId={fileId} menuItem download />
					<MediaLink fileId={fileId} menuItem playlist />
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
