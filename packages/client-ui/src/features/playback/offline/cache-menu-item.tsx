import {
	type OfflineCacheTarget,
	offlineCachePath,
} from "@anishelf/contracts/offline-cache";
import { Download, HardDriveDownload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DropdownMenuItem } from "../../../shared/components/ui/dropdown-menu.js";
import { Spinner } from "../../../shared/components/ui/spinner.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { pendingCache, useOfflineCache } from "./state.js";

export function CacheMenuItem({
	episode,
	...target
}: OfflineCacheTarget & { episode?: boolean }) {
	const { t } = useTranslation();
	const cache = useOfflineCache();
	const [starting, setStarting] = useState(false);
	if (!cache) return null;
	const entry =
		cache.entries.find(
			(item) =>
				item.fileId === target.fileId &&
				item.server === cache.server &&
				(item.sourceVersion === (target.sourceVersion ?? null) ||
					(item.sourceVersion === null && pendingCache(item.status))),
		) ??
		(target.sourceVersion
			? undefined
			: cache.entries.findLast(
					(item) =>
						item.fileId === target.fileId && item.server === cache.server,
				));
	if (entry?.status === "ready")
		return (
			<DropdownMenuItem render={<Link to={offlineCachePath} />}>
				<HardDriveDownload size={16} aria-hidden="true" />
				{t("offlineCache.status.ready")}
			</DropdownMenuItem>
		);
	if (starting || (entry && pendingCache(entry.status)))
		return (
			<DropdownMenuItem disabled>
				<Spinner />
				{entry?.status === "downloading" && entry.percent !== null
					? t("offlineCache.percent", { percent: entry.percent })
					: t(`offlineCache.status.${entry?.status ?? "preparing"}`)}
			</DropdownMenuItem>
		);
	return (
		<DropdownMenuItem
			onClick={() => {
				setStarting(true);
				void cache.host
					.start(target)
					.catch(() => {
						toast.add({ type: "error", title: t("offlineCache.actionFailed") });
					})
					.finally(() => setStarting(false));
			}}
		>
			<Download size={16} aria-hidden="true" />
			{t(episode ? "offlineCache.cacheEpisode" : "offlineCache.cacheVideo")}
		</DropdownMenuItem>
	);
}
