import { Menu } from "@base-ui/react/menu";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuSub = Menu.SubmenuRoot;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuRadioItem(props: Menu.RadioItem.Props) {
	return (
		<Menu.RadioItem
			{...props}
			closeOnClick
			className="touch-control flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
		>
			<span
				aria-hidden="true"
				className="flex size-4 items-center justify-center rounded-full border"
			>
				<Menu.RadioItemIndicator className="size-2 rounded-full bg-current" />
			</span>
			{props.children}
		</Menu.RadioItem>
	);
}

export function DropdownMenuSubTrigger(props: Menu.SubmenuTrigger.Props) {
	return (
		<Menu.SubmenuTrigger
			className="touch-control flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
			{...props}
		/>
	);
}

export function DropdownMenuContent({
	children,
	submenu = false,
}: {
	children: React.ReactNode;
	submenu?: boolean;
}) {
	return (
		<Menu.Portal keepMounted>
			<Menu.Positioner
				align={submenu ? "start" : "end"}
				side={submenu ? "right" : "bottom"}
				sideOffset={4}
				className="z-50"
			>
				<Menu.Popup
					className={`min-w-48 max-w-[calc(100vw-1rem)] max-h-[var(--available-height)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none ${submenu ? "w-72" : ""}`}
				>
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}

export function DropdownMenuItem({
	className,
	variant = "default",
	...props
}: Menu.Item.Props & { variant?: "default" | "destructive" }) {
	return (
		<Menu.Item
			className={(state) =>
				`touch-control flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 ${variant === "destructive" ? "text-destructive data-highlighted:text-destructive" : ""} ${typeof className === "function" ? className(state) : (className ?? "")}`
			}
			{...props}
		/>
	);
}
