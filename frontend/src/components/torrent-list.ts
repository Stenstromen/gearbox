import type {Torrent} from "../../bindings/github.com/stenstromen/gearbox";
import {mountColumnResize, pxFromRem, unmountColumnResize, type ColumnSpec} from "../column-resize";
import {formatBytes, formatPercent, formatRate} from "../format";
import type {SelectionModifiers} from "../selection";

export type ListSelection = {
    selectedIds: ReadonlySet<number>;
    cursorId: number | null;
    onSelect: (id: number, modifiers: SelectionModifiers) => void;
    onContextMenu: (id: number, x: number, y: number) => void;
};

let pressToken = 0;
let lastPressAt = 0;

function modifiersFrom(event: MouseEvent): SelectionModifiers {
    return {
        toggle: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
    };
}

function beginPress(): void {
    const token = ++pressToken;
    lastPressAt = performance.now();
    requestAnimationFrame(() => {
        if (pressToken === token) {
            pressToken = 0;
        }
    });
}

if (typeof window !== "undefined") {
    window.addEventListener("click", (event) => {
        if (pressToken === 0) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".list")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

export function renderTorrentList(host: HTMLElement, torrents: Torrent[], emptyLabel = "No torrents", selection?: ListSelection): void {
    host.replaceChildren();

    if (torrents.length === 0) {
        unmountColumnResize("torrents");
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = emptyLabel;
        host.append(empty);
        return;
    }

    const table = document.createElement("table");
    table.className = "torrents";
    table.setAttribute("aria-multiselectable", "true");
    const columns = torrentColumns();
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of columns) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.className = column.className;
        cell.append(columnLabel(column.label));
        headRow.append(cell);
    }
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    for (const torrent of torrents) {
        tbody.append(renderRow(torrent, selection));
    }
    table.append(thead, tbody);
    host.append(table);
    mountColumnResize(table, "torrents", columns);
}

function torrentColumns(): (ColumnSpec & {className: string})[] {
    return [
        {id: "name", label: "Name", className: "", min: pxFromRem(8), defaultWidth: pxFromRem(16), flex: true},
        {id: "size", label: "Size", className: "num", min: pxFromRem(4.5), defaultWidth: pxFromRem(6.25)},
        {id: "progress", label: "Progress", className: "col-end", min: pxFromRem(9), defaultWidth: pxFromRem(19)},
        {id: "peers", label: "Peers", className: "num", min: pxFromRem(3.25), defaultWidth: pxFromRem(4.5)},
        {id: "down", label: "Down", className: "num", min: pxFromRem(4.5), defaultWidth: pxFromRem(6.5)},
        {id: "up", label: "Up", className: "num", min: pxFromRem(4.5), defaultWidth: pxFromRem(6.5)},
    ];
}

function columnLabel(text: string): HTMLSpanElement {
    const label = document.createElement("span");
    label.className = "col-label";
    label.textContent = text;
    return label;
}

function renderRow(torrent: Torrent, selection?: ListSelection): HTMLTableRowElement {
    const row = document.createElement("tr");
    const selected = selection?.selectedIds.has(torrent.id) ?? false;
    const cursor = selection?.cursorId === torrent.id;
    row.className = [selected ? "is-selected" : "", cursor ? "is-cursor" : ""].filter(Boolean).join(" ");
    row.dataset.id = String(torrent.id);
    row.setAttribute("aria-selected", selected ? "true" : "false");
    if (selection) {
        row.addEventListener("selectstart", (event) => event.preventDefault());
        // Select on press. The click that follows can arrive without modifier
        // keys and would otherwise replace a shift-selected range.
        row.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            beginPress();
            selection.onSelect(torrent.id, modifiersFrom(event));
        });
        row.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                event.preventDefault();
            }
        });
        row.addEventListener("click", (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        });
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                if (pressToken !== 0 || performance.now() - lastPressAt < 50) {
                    return;
                }
                beginPress();
                selection.onSelect(torrent.id, {toggle: true, range: event.shiftKey});
                return;
            }
            if (pressToken !== 0) {
                return;
            }
            selection.onContextMenu(torrent.id, event.clientX, event.clientY);
        });
    }
    row.append(
        nameCell(torrent),
        textCell(formatBytes(torrent.totalSize), "num"),
        progressCell(torrent),
        textCell(String(torrent.peersConnected), "num"),
        textCell(formatRate(torrent.rateDownload), "num"),
        textCell(formatRate(torrent.rateUpload), "num"),
    );
    return row;
}

function nameCell(torrent: Torrent): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "name";
    const title = document.createElement("span");
    title.className = "name-title";
    title.textContent = torrent.name || "Untitled";
    title.title = title.textContent;
    cell.append(title);
    return cell;
}

function progressCell(torrent: Torrent): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "progress";
    const status = document.createElement("span");
    const message = torrent.error.trim();
    status.className = message ? "status status-error" : "status";
    status.textContent = message || torrent.status;
    status.title = status.textContent;
    const percent = formatPercent(torrent.percentDone);
    const track = document.createElement("span");
    track.className = "bar";
    const fill = document.createElement("span");
    fill.className = `bar-fill status-${slug(torrent.status)}`;
    const width = Math.min(100, Math.max(0, torrent.percentDone * 100));
    fill.style.width = `${width}%`;
    fill.append(barLabel(percent, "bar-label-on"));
    track.append(fill, barLabel(percent, "bar-label-off"));
    cell.append(status, track);
    return cell;
}

function barLabel(percent: string, className: string): HTMLSpanElement {
    const label = document.createElement("span");
    label.className = `bar-label ${className}`;
    label.textContent = percent;
    return label;
}

function textCell(value: string, className: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = className;
    cell.textContent = value;
    return cell;
}

function slug(status: string): string {
    return status.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}
