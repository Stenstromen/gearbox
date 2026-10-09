import {decodeSort, encodeSort, sortOptions, type SortKey} from "../sort";

export function createSortField(onChange: (sort: string) => void): {element: HTMLLabelElement; setStored: (sort: string) => void} {
    let key: SortKey = "name";
    let reversed = false;
    let open = false;

    const label = document.createElement("label");
    label.className = "field";
    const caption = document.createElement("span");
    caption.textContent = "Sort";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "picker-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const triggerText = document.createElement("span");
    const icons = document.createElement("span");
    icons.className = "picker-trigger-icons";
    const reverseMark = reverseIcon();
    const chevron = document.createElement("span");
    chevron.className = "picker-trigger-chevron";
    chevron.setAttribute("aria-hidden", "true");
    icons.append(reverseMark, chevron);
    trigger.append(triggerText, icons);
    label.append(caption, trigger);

    const menu = document.createElement("div");
    menu.className = "picker-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Sort by");

    const options = sortOptions.map((option) => {
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
            commit(option.key, reversed);
            close();
            trigger.focus();
        });
        menu.append(item);
        return item;
    });

    const rule = document.createElement("hr");
    menu.append(rule);

    const reverseRow = document.createElement("button");
    reverseRow.type = "button";
    reverseRow.className = "sort-reverse";
    reverseRow.setAttribute("role", "menuitemcheckbox");
    const reverseBox = document.createElement("span");
    reverseBox.className = "sort-reverse-box";
    reverseBox.setAttribute("aria-hidden", "true");
    const reverseText = document.createElement("span");
    reverseText.textContent = "Reverse";
    reverseRow.append(reverseBox, reverseText);
    menu.append(reverseRow);
    document.body.append(menu);

    const paint = () => {
        const option = sortOptions.find((item) => item.key === key);
        const name = option?.label ?? "Name";
        triggerText.textContent = name;
        trigger.setAttribute("aria-label", reversed ? `Sort by ${name}, reversed` : "Sort by");
        reverseMark.toggleAttribute("hidden", !reversed);
        reverseRow.setAttribute("aria-checked", reversed ? "true" : "false");
        for (const item of options) {
            const selected = item.dataset.key === key;
            item.setAttribute("aria-checked", selected ? "true" : "false");
            if (!open) {
                item.tabIndex = selected ? 0 : -1;
            }
        }
    };

    const commit = (nextKey: SortKey, nextReversed: boolean) => {
        key = nextKey;
        reversed = nextReversed;
        paint();
        onChange(encodeSort(key, reversed));
    };

    reverseRow.addEventListener("click", () => {
        commit(key, !reversed);
    });

    const focusables = (): HTMLElement[] => [...options, reverseRow];

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
        const items = focusables();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const start = index === -1 ? 0 : index;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = items[(start + delta + items.length) % items.length];
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
        const selected = options.find((item) => item.dataset.key === key) ?? options[0];
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

    return {
        element: label,
        setStored(sort: string) {
            const parsed = decodeSort(sort);
            if (!parsed) {
                return;
            }
            key = parsed.key;
            reversed = parsed.reversed;
            paint();
        },
    };
}

function reverseIcon(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("picker-trigger-mark");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3.2 1.4v7.2M1.4 6.8l1.8 1.8 1.8-1.8M8.8 10.6V3.4M7 5.2l1.8-1.8 1.8 1.8");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
}
