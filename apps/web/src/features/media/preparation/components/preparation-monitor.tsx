import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { PreparationTaskResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { RefreshButton } from "../../../../shared/components/ui/refresh-button.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { preparedWatchPath } from "../audio-tracks.js";
import { usePreparationContext } from "../context.js";
import { PreparationTaskCard } from "./task-card.js";

function isActive(task: PreparationTaskResponse): boolean {
	return (
		task.status === "queued" ||
		task.status === "processing" ||
		task.status === "cancelling"
	);
}
export function PreparationMonitor() {
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia?.("(max-width: 639px)").matches,
	);
	const activeTasks = preparation.tasks.filter(isActive);
	const failed = preparation.tasks.filter(
		(task) => task.status === "failed",
	).length;
	const active = activeTasks.length;
	const profileName = (task: PreparationTaskResponse) =>
		preparation.catalog?.profiles.find(
			(profile) => profile.id === task.profileId,
		)?.name;
	function revealMore() {
		if (preparation.loadingMore) return;
		console.debug("[PreparationMonitor] More tasks requested.", {
			loaded: preparation.tasks.length,
			hasMore: preparation.hasMore,
		});
		preparation.loadMore();
	}
	if (active === 0 && failed === 0 && !preparation.error) return null;
	return (
		<aside
			aria-label={t("preparation.monitor")}
			className={`fixed right-4 bottom-4 z-40 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-card shadow-lg ${collapsed ? "w-fit sm:w-sm" : "w-[calc(100vw-2rem)] sm:w-sm"}`}
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
						{failed > 0 &&
							` · ${t("preparation.failedCount", { count: failed })}`}
						{preparation.error !== null &&
							` · ${t("preparation.monitorError")}`}
					</span>
					{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
				</Button>
				{!collapsed && (
					<RefreshButton
						label={t("preparation.refresh")}
						busy={preparation.refreshing}
						onClick={preparation.refresh}
					/>
				)}
			</div>
			{
				<div
					hidden={collapsed}
					id="preparation-monitor-tasks"
					className="max-h-[35dvh] divide-y overflow-y-auto border-t [scrollbar-gutter:stable] sm:max-h-[min(26rem,60dvh)]"
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
							profileName={profileName(task)}
							onWatch={(task) => navigate(preparedWatchPath(task))}
						/>
					))}
					{preparation.hasMore && (
						<div className="p-2">
							<Button
								variant="ghost"
								className="w-full"
								disabled={preparation.loadingMore}
								onClick={revealMore}
							>
								{t("preparation.more")}
							</Button>
						</div>
					)}
				</div>
			}
		</aside>
	);
}
