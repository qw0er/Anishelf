import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../../shared/api/client.js";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../../shared/components/ui/dialog.js";
import { DropdownMenuItem } from "../../../../shared/components/ui/dropdown-menu.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { Spinner } from "../../../../shared/components/ui/spinner.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import {
	createMediaLink,
	createMediaPlaylist,
	resolveMediaLink,
} from "../media-link.js";

export default function MediaLink({
	fileId,
	iconOnly = false,
	menuItem = false,
	playlist = false,
	download = false,
}: {
	fileId: string;
	iconOnly?: boolean;
	menuItem?: boolean;
	playlist?: boolean;
	download?: boolean;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scope = useQueryScope();
	const mutation = useMutation({
		mutationFn: async (signal: AbortSignal) =>
			(download
				? resolveMediaLink
				: playlist
					? createMediaPlaylist
					: createMediaLink)(fileId, { signal }, client, scope),
	});
	const request = useRef<AbortController | null>(null);
	const [pending, setPending] = useState(false);
	const [link, setLink] = useState<string | null>(null);
	useEffect(() => () => request.current?.abort(), []);

	async function copyLink() {
		if (request.current) return;
		const controller = new AbortController();
		request.current = controller;
		setPending(true);
		setLink(null);
		const notificationId = `media-link:${fileId}`;
		toast.close(notificationId);
		try {
			const result = await mutation.mutateAsync(controller.signal);
			if (controller.signal.aborted) return;
			const { platform } = getClientRuntime();
			if (typeof result !== "string") {
				if ("url" in result) platform.downloadFile(result.url, result.name);
				else
					platform.downloadText(
						result.content,
						result.filename,
						"audio/x-mpegurl;charset=utf-8",
					);
				return;
			}
			const url = result;
			try {
				await platform.copyText(url);
				if (!controller.signal.aborted)
					toast.add({
						type: "success",
						title: t("player.mediaLinkCopied"),
						id: notificationId,
					});
			} catch {
				// The selectable field also works without clipboard permissions.
				if (!controller.signal.aborted) setLink(url);
			}
		} catch (cause) {
			if (!controller.signal.aborted && !isRequestCancelled(cause)) {
				toast.add({
					type: "error",
					priority: "high",
					title: t(getErrorTranslationKey(cause) ?? "player.mediaLinkError"),
					id: notificationId,
				});
			}
		} finally {
			if (!controller.signal.aborted) setPending(false);
			if (request.current === controller) request.current = null;
		}
	}

	const label = t(
		download
			? "player.downloadVideo"
			: playlist
				? "player.downloadPlaylist"
				: "player.copyMediaLink",
	);
	const ActionIcon = playlist || download ? Download : Copy;

	const trigger = (
		<DialogTrigger
			render={
				<Button
					type="button"
					variant={iconOnly || menuItem ? "ghost" : "outline"}
					className={
						menuItem
							? "w-full justify-start"
							: iconOnly
								? "size-9 shrink-0 p-0"
								: undefined
					}
					aria-label={iconOnly ? label : undefined}
					disabled={pending}
					focusableWhenDisabled={iconOnly}
					aria-busy={pending}
					onClick={() => void copyLink()}
				/>
			}
		>
			{pending && iconOnly ? (
				<Spinner />
			) : (
				<ActionIcon size={16} aria-hidden="true" />
			)}
			{!iconOnly && label}
		</DialogTrigger>
	);

	return (
		<Dialog
			open={link !== null}
			onOpenChange={(open) => {
				if (!open) setLink(null);
			}}
		>
			<div className={iconOnly ? "contents" : "flex min-w-0 flex-col gap-2"}>
				<div
					className={
						iconOnly
							? "col-start-2 row-start-1 flex items-center px-2"
							: "action-row"
					}
				>
					{menuItem ? (
						<DropdownMenuItem
							closeOnClick={false}
							nativeButton
							disabled={pending}
							render={trigger}
						/>
					) : iconOnly ? (
						<Tooltip content={label}>{trigger}</Tooltip>
					) : (
						trigger
					)}
				</div>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("player.mediaLinkLabel")}</DialogTitle>
						<DialogDescription role="status">
							{t("player.mediaLinkManual")}
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label={t("player.mediaLinkLabel")}
						readOnly
						value={link ?? ""}
						onFocus={(event) => event.currentTarget.select()}
					/>
					<DialogFooter>
						<DialogClose render={<Button type="button" variant="outline" />}>
							{t("actions.close")}
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</div>
		</Dialog>
	);
}
