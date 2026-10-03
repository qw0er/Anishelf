import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../api/client.js";
import { Button } from "../../../components/ui/button.js";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../components/ui/dialog.js";
import { Input } from "../../../components/ui/input.js";
import { toast } from "../../../components/ui/toast.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { createMediaLink } from "../media-link.js";

export default function MediaLink({
	fileId,
	iconOnly = false,
}: {
	fileId: string;
	iconOnly?: boolean;
}) {
	const { t } = useTranslation();
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
			const url = await createMediaLink(fileId, window.location.origin, {
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			try {
				await navigator.clipboard.writeText(url);
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
					<DialogTrigger
						render={
							<Button
								type="button"
								variant={iconOnly ? "ghost" : "outline"}
								className={iconOnly ? "size-9 shrink-0 p-0" : undefined}
								aria-label={iconOnly ? t("player.copyMediaLink") : undefined}
								title={iconOnly ? t("player.copyMediaLink") : undefined}
								disabled={pending}
								aria-busy={pending}
								onClick={() => void copyLink()}
							/>
						}
					>
						<Copy size={16} aria-hidden="true" />
						{!iconOnly && t("player.copyMediaLink")}
					</DialogTrigger>
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
