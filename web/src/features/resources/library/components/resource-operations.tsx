import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ellipsis, Folder, FolderInput, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	ResourceCommand,
	ResourceDto,
} from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../../shared/components/ui/dropdown-menu.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { executeResource } from "../api.js";
import { directoryQuery } from "../queries.js";

export function ResourceOperationItems({
	onSelect,
}: {
	onSelect(action: ResourceCommand["action"]): void;
}) {
	const { t } = useTranslation();
	return (
		<>
			<DropdownMenuItem onClick={() => onSelect("move")}>
				<FolderInput size={16} />
				{t("library.operations.move")}
			</DropdownMenuItem>
			<DropdownMenuItem
				variant="destructive"
				onClick={() => onSelect("delete")}
			>
				<Trash2 size={16} />
				{t("library.operations.delete")}
			</DropdownMenuItem>
		</>
	);
}
export function ResourceOperationMenu({
	onSelect,
}: {
	onSelect(action: ResourceCommand["action"]): void;
}) {
	const { t } = useTranslation();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("library.operations.actions")}
					/>
				}
			>
				<Ellipsis size={16} />
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<ResourceOperationItems onSelect={onSelect} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ResourceOperationDialog({
	entry,
	action,
	onClose,
}: {
	entry: ResourceDto;
	action: ResourceCommand["action"];
	onClose(): void;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [destinationId, setDestinationId] = useState(entry.parentId ?? "root");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const directory = useQuery({
		...directoryQuery(destinationId, useQueryScope()),
		enabled: action === "move",
	});
	const input: ResourceCommand = {
		id: entry.id,
		action,
		...(action === "move" ? { destinationId } : {}),
	};
	async function submit() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await executeResource(input);
			void client.invalidateQueries();
			toast.add({
				type: result.refreshRequired ? "warning" : "success",
				title: t(
					result.refreshRequired
						? "library.operations.refreshRequired"
						: "library.operations.completed",
				),
			});
			onClose();
		} catch (failure) {
			setError(failure);
			void client.invalidateQueries();
		} finally {
			setBusy(false);
		}
	}
	function navigate(id: string) {
		setDestinationId(id);
		setError(null);
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent showCloseButton={!busy}>
				<DialogTitle>{t(`library.operations.${action}`)}</DialogTitle>
				<DialogDescription className="break-all">
					{entry.name}
				</DialogDescription>
				{action === "delete" && (
					<p className="text-sm">
						{t(
							entry.kind === "directory"
								? "library.operations.deleteFolderHelp"
								: "library.operations.deleteHelp",
						)}
					</p>
				)}
				{action === "move" && (
					<div className="space-y-2">
						<p className="field-label">{t("library.operations.destination")}</p>
						{directory.isPending ? (
							<p role="status">{t("library.searching")}</p>
						) : directory.isError ? (
							<p role="alert">
								{t(
									getErrorTranslationKey(directory.error) ??
										"errors.requestFailed",
								)}{" "}
								<Button
									variant="outline"
									onClick={() => void directory.refetch()}
								>
									{t("actions.retry")}
								</Button>
							</p>
						) : (
							<>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										disabled={
											busy || directory.data.directory.parentId === null
										}
										aria-label={t("navigation.parentDirectory")}
										onClick={() =>
											navigate(directory.data.directory.parentId ?? "root")
										}
									>
										<ArrowLeft size={16} />
									</Button>
									<span className="break-all">
										{directory.data.directory.name}
									</span>
								</div>
								<ul
									className="max-h-56 overflow-auto divide-y"
									aria-label={t("library.operations.destination")}
								>
									{directory.data.children
										.filter(
											(item) =>
												item.kind === "directory" && item.id !== entry.id,
										)
										.map((item) => (
											<li key={item.id}>
												<Button
													variant="ghost"
													className="w-full justify-start"
													disabled={busy}
													onClick={() => navigate(item.id)}
												>
													<Folder size={16} />
													<span className="truncate">{item.name}</span>
												</Button>
											</li>
										))}
								</ul>
							</>
						)}
					</div>
				)}
				{error != null && (
					<p role="alert" className="text-sm text-destructive">
						{t(getErrorTranslationKey(error) ?? "errors.requestFailed")}
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("actions.cancel")}
					</Button>
					<Button
						disabled={
							busy ||
							(action === "move" &&
								(directory.isPending ||
									directory.isError ||
									destinationId === entry.parentId))
						}
						aria-busy={busy}
						onClick={() => void submit()}
					>
						{t(
							action === "delete"
								? "library.operations.confirmDelete"
								: "library.operations.confirmMove",
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
