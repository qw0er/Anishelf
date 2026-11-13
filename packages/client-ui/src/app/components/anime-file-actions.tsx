import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { PreparationSummaryResponse } from "../../shared/api/contracts.js";
import { DropdownMenuItem } from "../../shared/components/ui/dropdown-menu.js";
import type { queryGate } from "../../shared/lib/query-gate.js";
import { FileActions } from "./file-actions.js";
/** Reuse Files commands without giving Anime dependencies on Media or Playback UI. */
export function AnimeFileActions({
	source,
	summary,
	identificationMenu,
}: {
	identificationMenu?: ReactNode;
	source: { fileId: string; sourceVersion: string };
	summary: PreparationSummaryResponse["files"][number] | undefined;
	summaryLoading: boolean;
	gate: ReturnType<typeof queryGate>;
}) {
	const { t } = useTranslation();
	return (
		<FileActions
			identificationMenu={
				<>
					<DropdownMenuItem
						render={
							<Link to={`/files/${encodeURIComponent(source.fileId)}/locate`} />
						}
						onClick={() =>
							console.debug("[AnimeFiles] Opening file in directory.", {
								fileId: source.fileId,
							})
						}
					>
						<FolderOpen className="size-4" aria-hidden="true" />
						{t("library.showInFiles")}
					</DropdownMenuItem>
					{identificationMenu}
				</>
			}
			fileId={source.fileId}
			sourceVersion={source.sourceVersion}
			summary={summary}
		/>
	);
}
