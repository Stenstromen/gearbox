export type ColumnSpec = {
    id: string;
    label: string;
    min: number;
    defaultWidth: number;
    flex?: boolean;
};

export function pxFromRem(rem: number): number {
    if (typeof document === "undefined") {
        return Math.round(rem * 16);
    }
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const base = Number.isFinite(root) && root > 0 ? root : 16;
    return Math.round(rem * base);
}

/** Pixel widths for one pass. The flex column takes leftover container space. */
export function layoutColumns(columns: readonly ColumnSpec[], stored: Readonly<Record<string, number>>, containerWidth: number): number[] {
    const widths = columns.map((column) => widthOf(column, stored));
    const flexIndex = columns.findIndex((column) => column.flex);
    if (flexIndex < 0) {
        return widths;
    }
    if (containerWidth <= 0) {
        widths[flexIndex] = Math.max(columns[flexIndex].min, columns[flexIndex].defaultWidth);
        return widths;
    }
    const fixed = widths.reduce((sum, width, index) => index === flexIndex ? sum : sum + width, 0);
    widths[flexIndex] = Math.max(columns[flexIndex].min, containerWidth - fixed);
    return widths;
}

/**
 * Drag the vertical boundary after `boundary` by `delta` pixels.
 * The two columns beside that line trade width until one hits its minimum.
 */
export function resizeColumns(
    columns: readonly ColumnSpec[],
    stored: Readonly<Record<string, number>>,
    boundary: number,
    delta: number,
    containerWidth: number,
): Record<string, number> {
    const current = layoutColumns(columns, stored, containerWidth);
    const next = shiftBoundary(current, columns.map((column) => column.min), boundary, delta);
    return rememberFixed(columns, next);
}

/** Double-click or Home restores the column on this boundary to its default width. */
export function resetColumn(columns: readonly ColumnSpec[], stored: Readonly<Record<string, number>>, boundary: number): Record<string, number> {
    const target = resetTarget(columns, boundary);
    if (!target) {
        return {...stored};
    }
    const next = {...stored};
    delete next[target.id];
    return next;
}

function widthOf(column: ColumnSpec, stored: Readonly<Record<string, number>>): number {
    if (column.flex) {
        return column.min;
    }
    const saved = stored[column.id];
    const chosen = saved === undefined || !Number.isFinite(saved) ? column.defaultWidth : saved;
    return Math.max(column.min, Math.round(chosen));
}

function shiftBoundary(widths: readonly number[], mins: readonly number[], boundary: number, delta: number): number[] {
    const next = widths.slice();
    const right = boundary + 1;
    const pixels = Math.round(delta);
    if (boundary < 0 || right >= next.length || pixels === 0) {
        return next;
    }
    const left = next[boundary] ?? 0;
    const rightWidth = next[right] ?? 0;
    const leftMin = mins[boundary] ?? 0;
    const rightMin = mins[right] ?? 0;
    if (pixels > 0) {
        const applied = Math.min(pixels, Math.max(0, rightWidth - rightMin));
        next[boundary] = left + applied;
        next[right] = rightWidth - applied;
        return next;
    }
    const applied = Math.min(-pixels, Math.max(0, left - leftMin));
    next[boundary] = left - applied;
    next[right] = rightWidth + applied;
    return next;
}

function rememberFixed(columns: readonly ColumnSpec[], widths: readonly number[]): Record<string, number> {
    const stored: Record<string, number> = {};
    columns.forEach((column, index) => {
        if (column.flex) {
            return;
        }
        const width = widths[index];
        if (width !== undefined) {
            stored[column.id] = width;
        }
    });
    return stored;
}

function resetTarget(columns: readonly ColumnSpec[], boundary: number): ColumnSpec | undefined {
    const left = columns[boundary];
    if (left && !left.flex) {
        return left;
    }
    const right = columns[boundary + 1];
    if (right && !right.flex) {
        return right;
    }
    return undefined;
}

const storageKey = "gearbox.columnWidths";

type Drag = {
    boundary: number;
    startX: number;
    startStored: Record<string, number>;
    containerWidth: number;
};

type Mount = {
    table: HTMLTableElement;
    columns: readonly ColumnSpec[];
    observer: ResizeObserver;
    observing: boolean;
};

const storedWidths = new Map<string, Record<string, number>>();
const mounts = new Map<string, Mount>();
const drags = new Map<string, Drag>();
let storageLoaded = false;

export function unmountColumnResize(tableId: string): void {
    const mount = mounts.get(tableId);
    if (!mount) {
        return;
    }
    mount.observer.disconnect();
    mounts.delete(tableId);
}

export function mountColumnResize(table: HTMLTableElement, tableId: string, columns: readonly ColumnSpec[]): void {
    unmountColumnResize(tableId);
    ensureLoaded();
    if (!storedWidths.has(tableId)) {
        storedWidths.set(tableId, {});
    }
    const observer = new ResizeObserver(() => apply(tableId));
    mounts.set(tableId, {table, columns, observer, observing: false});
    table.classList.add("resizable");
    installHandles(tableId);
    apply(tableId);
    watchContainer(tableId);
    requestAnimationFrame(() => {
        if (mounts.get(tableId)?.table !== table) {
            return;
        }
        watchContainer(tableId);
        apply(tableId);
    });
}

function watchContainer(tableId: string): void {
    const mount = mounts.get(tableId);
    const container = mount?.table.parentElement;
    if (!mount || !container || mount.observing) {
        return;
    }
    mount.observer.observe(container);
    mount.observing = true;
}

function installHandles(tableId: string): void {
    const mount = mounts.get(tableId);
    if (!mount) {
        return;
    }
    const headers = mount.table.querySelectorAll(":scope > thead > tr:first-child > th");
    headers.forEach((header, index) => {
        if (!(header instanceof HTMLTableCellElement) || index >= mount.columns.length - 1) {
            return;
        }
        header.querySelectorAll(":scope > .col-resize").forEach((node) => node.remove());
        const handle = document.createElement("div");
        handle.className = "col-resize";
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");
        header.append(handle);
        bindHandle(tableId, handle, index);
    });
}

function bindHandle(tableId: string, handle: HTMLElement, boundary: number): void {
    let lastResetAt = 0;
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const now = performance.now();
        if (now - lastResetAt < 400) {
            lastResetAt = 0;
            endDrag(tableId);
            resetBoundary(tableId, boundary);
            return;
        }
        lastResetAt = now;
        const mount = mounts.get(tableId);
        if (!mount) {
            return;
        }
        drags.set(tableId, {
            boundary,
            startX: event.clientX,
            startStored: {...(storedWidths.get(tableId) ?? {})},
            containerWidth: containerWidth(mount.table),
        });
        document.body.classList.add("is-col-resizing");
        apply(tableId);
        const move = (ev: PointerEvent) => {
            const drag = drags.get(tableId);
            const current = mounts.get(tableId);
            if (!drag || !current) {
                return;
            }
            storedWidths.set(tableId, resizeColumns(current.columns, drag.startStored, drag.boundary, ev.clientX - drag.startX, drag.containerWidth));
            apply(tableId);
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            endDrag(tableId);
            persist();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    });
    handle.addEventListener("keydown", (event) => {
        const mount = mounts.get(tableId);
        if (!mount) {
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            resetBoundary(tableId, boundary);
            return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowRight" ? 16 : -16;
        storedWidths.set(tableId, resizeColumns(mount.columns, storedWidths.get(tableId) ?? {}, boundary, delta, containerWidth(mount.table)));
        apply(tableId);
        persist();
    });
    handle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
}

function resetBoundary(tableId: string, boundary: number): void {
    const mount = mounts.get(tableId);
    if (!mount) {
        return;
    }
    storedWidths.set(tableId, resetColumn(mount.columns, storedWidths.get(tableId) ?? {}, boundary));
    apply(tableId);
    persist();
}

function endDrag(tableId: string): void {
    drags.delete(tableId);
    if (drags.size === 0) {
        document.body.classList.remove("is-col-resizing");
    }
    apply(tableId);
}

function apply(tableId: string): void {
    const mount = mounts.get(tableId);
    if (!mount || !mount.table.isConnected) {
        return;
    }
    const width = containerWidth(mount.table);
    const widths = layoutColumns(mount.columns, storedWidths.get(tableId) ?? {}, width);
    paintWidths(mount.table, widths, width);
    paintHandles(tableId, widths);
}

function containerWidth(table: HTMLTableElement): number {
    return table.parentElement?.clientWidth ?? 0;
}

function paintWidths(table: HTMLTableElement, widths: readonly number[], containerWidth: number): void {
    let group = table.querySelector(":scope > colgroup");
    if (!(group instanceof HTMLTableColElement) || group.children.length !== widths.length) {
        group?.remove();
        group = document.createElement("colgroup");
        for (let index = 0; index < widths.length; index += 1) {
            group.append(document.createElement("col"));
        }
        table.prepend(group);
    }
    for (let index = 0; index < widths.length; index += 1) {
        const col = group.children[index];
        if (col instanceof HTMLElement) {
            col.style.width = `${widths[index]}px`;
        }
    }
    const total = widths.reduce((sum, column) => sum + column, 0);
    const overflows = containerWidth > 0 && total > containerWidth;
    table.style.width = overflows ? `${total}px` : "100%";
    table.style.minWidth = overflows ? `${total}px` : "";
}

function paintHandles(tableId: string, widths: readonly number[]): void {
    const mount = mounts.get(tableId);
    if (!mount) {
        return;
    }
    const drag = drags.get(tableId);
    const handles = mount.table.querySelectorAll(":scope > thead > tr:first-child > th > .col-resize");
    handles.forEach((node, index) => {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        const column = mount.columns[index];
        const rightMin = mount.columns[index + 1]?.min ?? 0;
        const left = widths[index] ?? column?.min ?? 0;
        const right = widths[index + 1] ?? left;
        node.setAttribute("aria-label", `Resize ${column?.label ?? "column"} column`);
        node.setAttribute("aria-valuemin", String(column?.min ?? 0));
        node.setAttribute("aria-valuemax", String(left + Math.max(0, right - rightMin)));
        node.setAttribute("aria-valuenow", String(left));
        node.classList.toggle("is-dragging", drag?.boundary === index);
    });
}

function ensureLoaded(): void {
    if (storageLoaded) {
        return;
    }
    storageLoaded = true;
    for (const [tableId, widths] of Object.entries(readStorage())) {
        storedWidths.set(tableId, widths);
    }
}

function persist(): void {
    try {
        const all: Record<string, Record<string, number>> = {};
        for (const [tableId, widths] of storedWidths) {
            all[tableId] = widths;
        }
        localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {
        // Private mode and full storage can reject writes. Widths still last for this session.
    }
}

function readStorage(): Record<string, Record<string, number>> {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        const all: Record<string, Record<string, number>> = {};
        for (const [tableId, value] of Object.entries(parsed)) {
            if (!value || typeof value !== "object") {
                continue;
            }
            const widths: Record<string, number> = {};
            for (const [columnId, width] of Object.entries(value)) {
                if (typeof width === "number" && Number.isFinite(width) && width > 0) {
                    widths[columnId] = Math.round(width);
                }
            }
            all[tableId] = widths;
        }
        return all;
    } catch {
        return {};
    }
}
