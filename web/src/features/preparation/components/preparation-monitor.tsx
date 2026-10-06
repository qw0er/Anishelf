import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "../../../components/ui/button.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { preparedWatchPath } from "../audio-tracks.js";
import { usePreparationContext } from "../context.js";
import { PreparationTaskCard } from "./task-card.js";
export function PreparationMonitor() {
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(false);

	const active = preparation.tasks.filter(
		(task) =>
			task.status === "queued" ||
			task.status === "processing" ||
			task.status === "cancelling",
	).length;
	if (active === 0) return null;
	return (
		<aside
			aria-label={t("preparation.monitor")}
			className="fixed right-4 bottom-4 z-40 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-xl border bg-card shadow-lg"
		>
			<div className="flex items-center justify-between gap-2 px-3 py-1">
				<Button
					variant="ghost"
					className="min-w-0 flex-1 justify-between px-0"
					aria-expanded={!collapsed}
					aria-controls="preparation-monitor-tasks"
					onClick={() => setCollapsed((value) => !value)}
				>
					<span className="truncate">
						{t("preparation.monitor")} ·{" "}
						{active
							? t("preparation.activeCount", { count: active })
							: t("preparation.totalCount", {
									count: preparation.tasks.length,
								})}
					</span>
					{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
				</Button>
				{!collapsed && (
					<Tooltip content={t("preparation.refresh")}>
						<Button
							variant="ghost"
							className="size-8 shrink-0 p-0"
							aria-label={t("preparation.refresh")}
							onClick={preparation.refresh}
						>
							<RefreshCw size={16} />
						</Button>
					</Tooltip>
				)}
			</div>
			{
				<div
					hidden={collapsed}
					id="preparation-monitor-tasks"
					className="max-h-[min(26rem,60dvh)] divide-y overflow-y-auto border-t"
				>
					{preparation.error !== null && (
						<p role="alert">
							{t(
								getErrorTranslationKey(preparation.error) ??
									"errors.requestFailed",
							)}
						</p>
					)}
					{preparation.tasks.map((task) => (
						<PreparationTaskCard
							key={task.id}
							task={task}
							profileName={
								preparation.catalog?.profiles.find(
									(profile) => profile.id === task.profileId,
								)?.name
							}
							onWatch={(task) => navigate(preparedWatchPath(task))}
						/>
					))}
				</div>
			}
		</aside>
	);
}
