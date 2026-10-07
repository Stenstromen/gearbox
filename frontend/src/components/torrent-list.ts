import type {Torrent} from "../../bindings/github.com/stenstromen/gearbox";
import {formatBytes, formatPercent, formatRate} from "../format";

export type ListSelection = {
    selectedIds: ReadonlySet<number>;
    cursorId: number | null;
    onSelect: (id: number) => void;
    onContextMenu: (id: number, x: number, y: number) => void;
};

export function renderTorrentList(host: HTMLElement, torrents: Torrent[], emptyLabel = "No torrents", selection?: ListSelection): void {
    host.replaceChildren();

    if (torrents.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = emptyLabel;
        host.append(empty);
        return;
    }

    const table = document.createElement("table");
    table.className = "torrents";
    table.setAttribute("aria-multiselectable", "true");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of [
        {label: "Name", className: ""},
        {label: "Size", className: "num"},
        {label: "Progress", className: "col-end"},
        {label: "Peers", className: "num"},
        {label: "Down", className: "num"},
        {label: "Up", className: "num"},
    ]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.className = column.className;
        cell.textContent = column.label;
        headRow.append(cell);
    }
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    for (const torrent of torrents) {
        tbody.append(renderRow(torrent, selection));
    }
    table.append(thead, tbody);
    host.append(table);
}

function renderRow(torrent: Torrent, selection?: ListSelection): HTMLTableRowElement {
    const row = document.createElement("tr");
    const selected = selection?.selectedIds.has(torrent.id) ?? false;
    const cursor = selection?.cursorId === torrent.id;
    row.className = [selected ? "is-selected" : "", cursor ? "is-cursor" : ""].filter(Boolean).join(" ");
    row.dataset.id = String(torrent.id);
    row.setAttribute("aria-selected", selected ? "true" : "false");
    if (selection) {
        row.addEventListener("click", () => selection.onSelect(torrent.id));
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
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
