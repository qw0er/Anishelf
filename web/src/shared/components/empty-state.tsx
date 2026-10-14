import type { ReactNode } from "react";

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
		<section
			className="flex min-w-0 flex-col items-center gap-4 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center sm:py-14"
			aria-label={title}
		>
			<div
				className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
				aria-hidden="true"
			>
				{icon}
			</div>
			<h2 className="max-w-lg text-sm font-medium leading-relaxed text-muted-foreground">
				{title}
			</h2>
			{actions && <div className="action-row justify-center">{actions}</div>}
		</section>
	);
}
