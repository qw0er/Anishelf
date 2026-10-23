import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import { releaseInfo } from "../detail-format.js";
import type { AnimeResourceActionSlot } from "../resource-actions.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
export function VersionSelector({
	controller,
	renderResourceActions,
}: {
	renderResourceActions: AnimeResourceActionSlot;
	controller: Pick<
		LocalWorkDetailController,
		"selected" | "playPath" | "closeVersions"
	>;
}) {
	const { t } = useTranslation();
	const { selected, playPath, closeVersions } = controller;
	return (
		<Dialog
			open={Boolean(selected)}
			onOpenChange={(open) => {
				if (!open) closeVersions();
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogTitle>
					{t("anime.chooseVersion")}: {selected?.label}
				</DialogTitle>
				<DialogDescription>{t("anime.versionHint")}</DialogDescription>
				{selected && (
					<ul className="space-y-4">
						{selected.versions.map((version) => (
							<li
								key={version.sourceId}
								className="min-w-0 space-y-2 rounded-md border p-3"
							>
								<p className="font-medium wrap-anywhere">
									{version.evidence.originalName}
								</p>
								<p className="text-sm text-muted-foreground wrap-anywhere">
									{version.relativePath}
								</p>
								<p className="text-sm wrap-anywhere">
									{t("anime.releaseInfo")}:{" "}
									{releaseInfo(version) || t("anime.unknown")}
								</p>
								{version.mapping.rawNumbers.length > 1 && (
									<p className="text-sm">{t("anime.multiEpisode")}</p>
								)}
								<Link
									className={buttonStyles("outline")}
									to={`/review?${new URLSearchParams({ item: version.reviewId, decision: "confirmed" })}`}
								>
									{t("review.correct")}
								</Link>
								{version.available ? (
									<div className="inline-flex items-center gap-1">
										{renderResourceActions(version)}
										<Link
											className={buttonStyles()}
											to={playPath(version, selected)}
										>
											{t("anime.play")}
										</Link>
									</div>
								) : (
									<p>{t("anime.unavailable")}</p>
								)}
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
