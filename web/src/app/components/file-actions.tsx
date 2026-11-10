import { Ellipsis, Film } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilePreparations } from "../../features/media/public.js";
import { PreparationFileMenuItems } from "../../features/media/ui.js";
import { FileLinkMenuItems } from "../../features/playback/ui.js";

import type { PreparationSummaryResponse } from "../../shared/api/contracts.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";

export function FileActions({
	fileId,
	sourceVersion,
	summary,
	identification,
	identificationMenu,
	managementMenu,
	disabled = false,
}: {
	fileId: string;
	sourceVersion?: string;
	disabled?: boolean;
	identification?: ReactNode;
	identificationMenu?: ReactNode;
	managementMenu?: ReactNode;
	summary?: PreparationSummaryResponse["files"][number] | undefined;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const list = useFilePreparations(fileId, open && !disabled);
	const published =
		sourceVersion !== undefined &&
		summary?.versions.some(
			(v) => v.sourceVersion === sourceVersion && v.publishedCopies > 0,
		);
	return (
		<>
			{identification}
			{published && (
				<Tooltip content={t("preparation.published")}>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("preparation.published")}
						onClick={() => setOpen(true)}
					>
						<Film className="size-4" aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			<DropdownMenu open={open && !disabled} onOpenChange={setOpen}>
				<Tooltip content={t("library.fileActions")}>
					<DropdownMenuTrigger
						disabled={disabled}
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
					<FileLinkMenuItems fileId={fileId} />
					<PreparationFileMenuItems
						fileId={fileId}
						list={list}
						sourceVersion={sourceVersion}
						enabled={open && !disabled}
					/>
					{managementMenu}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
