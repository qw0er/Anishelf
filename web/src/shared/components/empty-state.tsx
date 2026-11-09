import type { ReactNode } from "react";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "./ui/empty.js";
export function EmptyState({
	icon,
	title,
	description,
	actions,
	embedded = false,
}: {
	icon: ReactNode;
	title: string;
	description?: string;
	actions?: ReactNode;
	embedded?: boolean;
}) {
	return (
		<section aria-label={title}>
			<Empty
				aria-label={title}
				className={
					embedded
						? "py-10 sm:py-14"
						: "rounded-lg border bg-muted/20 py-10 sm:py-14"
				}
			>
				<EmptyHeader>
					<EmptyMedia variant="icon" aria-hidden="true">
						{icon}
					</EmptyMedia>
					<EmptyTitle>
						<h2>{title}</h2>
					</EmptyTitle>
					{description && <EmptyDescription>{description}</EmptyDescription>}
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
