import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button, buttonStyles } from "./button.js";
import { Spinner } from "./spinner.js";
import { Tooltip } from "./tooltip.js";

/** Keep the action named at every size; compact toolbars reveal text when they fit. */
export function ActionButton({
	icon: Icon,
	label,
	shortLabel = label,
	className,
	...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
	icon: LucideIcon;
	label: string;
	shortLabel?: string;
}) {
	return (
		<Tooltip content={label}>
			<Button
				{...props}
				aria-label={label}
				className={(state) =>
					`responsive-action ${typeof className === "function" ? className(state) : (className ?? "")}`
				}
			>
				{props["aria-busy"] ? (
					<Spinner />
				) : (
					<Icon size={16} className="shrink-0" aria-hidden="true" />
				)}
				<span className="responsive-action-label">{shortLabel}</span>
			</Button>
		</Tooltip>
	);
}

export function ActionLink({
	icon: Icon,
	label,
	shortLabel = label,
	href,
	...props
}: Omit<ComponentProps<"a">, "children"> & {
	icon: LucideIcon;
	label: string;
	shortLabel?: string;
	href: string;
}) {
	return (
		<Tooltip content={label}>
			<a
				{...props}
				href={href}
				aria-label={label}
				className={buttonStyles("outline", "responsive-action")}
			>
				<Icon size={16} className="shrink-0" aria-hidden="true" />
				<span className="responsive-action-label">{shortLabel}</span>
			</a>
		</Tooltip>
	);
}
