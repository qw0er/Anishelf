import type { ReactNode } from "react";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "./ui/empty.js";
export function EmptyState({
	icon,
	title,
	actions,
}: {
	icon: ReactNode;
	title: string;
	actions?: ReactNode;
}) {
	return (
		<section aria-label={title}>
			<Empty
				aria-label={title}
				className="rounded-lg border bg-muted/20 py-10 sm:py-14"
			>
				<EmptyHeader>
					<EmptyMedia variant="icon" aria-hidden="true">
						{icon}
					</EmptyMedia>
					<EmptyTitle>
						<h2>{title}</h2>
					</EmptyTitle>
				</EmptyHeader>
				{actions && (
					<EmptyContent>
						<div className="action-row justify-center">{actions}</div>
					</EmptyContent>
				)}
			</Empty>
		</section>
	);
}
