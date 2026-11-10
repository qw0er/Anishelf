import { useTranslation } from "react-i18next";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../../shared/components/ui/dropdown-menu.js";
import type { PlayerChapter } from "../chapters.js";

function timestamp(ms: number) {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ChapterMenu({
	chapters,
	container,
	onOpenChange,
	onSelect,
}: {
	chapters: PlayerChapter[];
	container: HTMLElement | null;
	onOpenChange(open: boolean): void;
	onSelect(chapter: PlayerChapter, index: number): void;
}) {
	const { t } = useTranslation();
	return (
		<DropdownMenu onOpenChange={onOpenChange}>
			<DropdownMenuTrigger className="min-h-11 rounded-md border border-white/30 bg-black/80 px-3 text-sm text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
				{t("player.chapters")}
			</DropdownMenuTrigger>
			<DropdownMenuContent container={container}>
				{chapters.map((chapter, index) => (
					<DropdownMenuItem
						key={chapter.id}
						onClick={() => onSelect(chapter, index)}
					>
						<span className="shrink-0 tabular-nums text-muted-foreground">
							{timestamp(chapter.startMs)}
						</span>
						<span className="min-w-0 break-words">
							{chapter.title ??
								t("player.chapterNumber", { number: index + 1 })}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
