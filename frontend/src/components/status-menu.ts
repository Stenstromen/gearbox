import {statusFilters, type StatusFilter} from "../sort";

export function createStatusField(onChange: (status: StatusFilter) => void): {element: HTMLLabelElement} {
    let status: StatusFilter = "all";
    let open = false;

    const label = document.createElement("label");
    label.className = "field";
    const caption = document.createElement("span");
    caption.textContent = "Status";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "picker-trigger picker-trigger-wide";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Filter by status");
    const triggerText = document.createElement("span");
    const icons = document.createElement("span");
    icons.className = "picker-trigger-icons";
    const chevron = document.createElement("span");
    chevron.className = "picker-trigger-chevron";
    chevron.setAttribute("aria-hidden", "true");
    icons.append(chevron);
    trigger.append(triggerText, icons);
    label.append(caption, trigger);

    const menu = document.createElement("div");
    menu.className = "picker-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Filter by status");

    const options = statusFilters.map((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "picker-option";
        item.setAttribute("role", "menuitemradio");
        item.dataset.key = option.key;
        const mark = document.createElement("span");
        mark.className = "picker-option-mark";
        mark.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = option.label;
        item.append(mark, text);
        item.addEventListener("click", () => {
            choose(option.key);
            close();
            trigger.focus();
        });
        menu.append(item);
        return item;
    });
    document.body.append(menu);

    const paint = () => {
        const option = statusFilters.find((item) => item.key === status);
        triggerText.textContent = option?.label ?? "All";
        for (const item of options) {
            const selected = item.dataset.key === status;
            item.setAttribute("aria-checked", selected ? "true" : "false");
            if (!open) {
                item.tabIndex = selected ? 0 : -1;
            }
        }
    };

    const choose = (next: StatusFilter) => {
        status = next;
        paint();
        onChange(status);
    };

    const focusItem = (item: HTMLElement) => {
        for (const option of options) {
            option.tabIndex = option === item ? 0 : -1;
        }
        item.focus();
    };

    const place = () => {
        const rect = trigger.getBoundingClientRect();
        menu.style.minWidth = `${Math.round(rect.width)}px`;
        const menuRect = menu.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
        let top = rect.bottom + 6;
        if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - menuRect.height - 6);
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    };

    const onPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Node && (menu.contains(event.target) || trigger.contains(event.target))) {
            return;
        }
        close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            trigger.focus();
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
        }
        event.preventDefault();
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        const start = index === -1 ? 0 : index;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = options[(start + delta + options.length) % options.length];
        if (next) {
            focusItem(next);
        }
    };

    const openMenu = () => {
        if (open) {
            return;
        }
        open = true;
        trigger.setAttribute("aria-expanded", "true");
        trigger.classList.add("is-open");
        menu.hidden = false;
        place();
        const selected = options.find((item) => item.dataset.key === status) ?? options[0];
        if (selected) {
            focusItem(selected);
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        menu.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
    };

    const close = () => {
        if (!open) {
            return;
        }
        open = false;
        trigger.setAttribute("aria-expanded", "false");
        trigger.classList.remove("is-open");
        menu.hidden = true;
        document.removeEventListener("pointerdown", onPointerDown, true);
        menu.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
        paint();
    };

    trigger.addEventListener("click", () => {
        if (open) {
            close();
            return;
        }
        openMenu();
    });

    paint();
    return {element: label};
}
