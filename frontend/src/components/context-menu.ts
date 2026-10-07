export type ContextMenuItem = {
    label: string;
    disabled?: boolean;
    onSelect: () => void;
};

let closeMenu: (() => void) | null = null;

export function openContextMenu(x: number, y: number, items: readonly (ContextMenuItem | "separator")[]): void {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.setAttribute("role", "menu");
    for (const item of items) {
        if (item === "separator") {
            const rule = document.createElement("hr");
            menu.append(rule);
            continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = item.disabled === true;
        button.addEventListener("click", () => {
            closeContextMenu();
            item.onSelect();
        });
        menu.append(button);
    }
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

    const onPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Node && menu.contains(event.target)) {
            return;
        }
        closeContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
        }
        closeContextMenu();
    };
    const onDismiss = () => closeContextMenu();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    closeMenu = () => {
        closeMenu = null;
        menu.remove();
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onDismiss, true);
        window.removeEventListener("resize", onDismiss);
        window.removeEventListener("blur", onDismiss);
    };
}

export function closeContextMenu(): void {
    closeMenu?.();
}
