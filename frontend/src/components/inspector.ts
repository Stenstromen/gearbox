import {Clipboard} from "@wailsio/runtime";
import type {Peer, TorrentFile, Tracker, TorrentInfo} from "../../bindings/github.com/stenstromen/gearbox";
import {mountColumnResize, pxFromRem, unmountColumnResize, type ColumnSpec} from "../column-resize";
import {fileIndices, fileSummary, fileTree, priorityState, sortFileNodes, wantedState, type FileNode, type FilePriority, type FileSortKey, type FileUpdate} from "../files";
import {formatBytes, formatPercent, formatRate} from "../format";
import {copyableInfoValue, mixedLabel, torrentInfoFields} from "../inspector-info";

export const inspectorTabs = [
    {id: "info", label: "Info"},
    {id: "peer", label: "Peer"},
    {id: "trackers", label: "Trackers"},
    {id: "files", label: "Files"},
] as const;

export type InspectorTab = (typeof inspectorTabs)[number]["id"];

export type InspectorState = {
    tab: InspectorTab;
    loading: boolean;
    error: string;
    info: TorrentInfo | null;
    infos: readonly TorrentInfo[];
};

export function renderInspector(host: HTMLElement, state: InspectorState, onTab: (tab: InspectorTab) => void, onClose: () => void, onFiles: (update: FileUpdate) => void): void {
    unmountColumnResize("peers");
    unmountColumnResize("files");
    host.replaceChildren();
    const body = panelBody(state, onFiles);
    host.append(tabBar(state.tab, onTab, onClose), body);
    const table = body.querySelector("table");
    if (!(table instanceof HTMLTableElement) || !host.isConnected) {
        return;
    }
    if (table.classList.contains("peer-table")) {
        mountColumnResize(table, "peers", peerColumnSpecs());
    } else if (table.classList.contains("file-table")) {
        mountColumnResize(table, "files", fileColumnSpecs());
    }
}

export function fillTorrentInfo(host: HTMLElement, infos: readonly TorrentInfo[]): void {
    for (const [field, value] of Object.entries(torrentInfoFields(infos))) {
        const node = host.querySelector(`[data-field="${field}"]`);
        if (!node) {
            continue;
        }
        const text = node.querySelector(":scope > .info-copy-value");
        if (text instanceof HTMLElement) {
            text.textContent = value;
            text.title = value;
            const button = node.querySelector(":scope > .info-copy-button");
            if (button instanceof HTMLButtonElement) {
                syncCopyButton(button, value);
            }
        } else {
            node.textContent = value;
        }
        node.classList.toggle("info-error", field === "error" && value !== "None" && value !== mixedLabel);
    }
}

function tabBar(active: InspectorTab, onTab: (tab: InspectorTab) => void, onClose: () => void): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "inspector-bar";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Torrent details");
    for (const tab of inspectorTabs) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "inspector-tab";
        button.id = `inspector-tab-${tab.id}`;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", `inspector-panel-${tab.id}`);
        button.setAttribute("aria-selected", tab.id === active ? "true" : "false");
        button.tabIndex = tab.id === active ? 0 : -1;
        button.textContent = tab.label;
        button.addEventListener("click", () => onTab(tab.id));
        bar.append(button);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "inspector-close";
    close.textContent = "Close";
    close.addEventListener("click", onClose);
    bar.append(close);
    return bar;
}

function panelBody(state: InspectorState, onFiles: (update: FileUpdate) => void): HTMLElement {
    const body = document.createElement("div");
    body.className = "inspector-body";
    body.id = `inspector-panel-${state.tab}`;
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", `inspector-tab-${state.tab}`);
    const selection = state.infos.length > 0 ? state.infos : state.info ? [state.info] : [];
    if (selection.length === 0) {
        body.append(statusMessage(state));
        return body;
    }
    if (state.tab === "info") {
        body.append(infoColumns(selection));
        return body;
    }
    if (!state.info) {
        body.append(statusMessage(state));
        return body;
    }
    if (state.tab === "peer") {
        body.classList.add("inspector-body-flush");
        body.append(peerTable(state.info.peers ?? [], state.info.id));
        return body;
    }
    if (state.tab === "trackers") {
        body.classList.add("inspector-body-flush");
        body.append(trackerList(state.info.trackers ?? []));
        return body;
    }
    if (state.tab === "files") {
        body.classList.add("inspector-body-flush");
        body.append(fileTable(state.info.files ?? [], state.info.id, onFiles));
    }
    return body;
}

function statusMessage(state: InspectorState): HTMLParagraphElement {
    const message = document.createElement("p");
    message.className = state.error ? "inspector-message inspector-message-error" : "inspector-message";
    message.textContent = state.error || (state.loading ? "Loading…" : "");
    return message;
}

function infoColumns(infos: readonly TorrentInfo[]): HTMLElement {
    const columns = document.createElement("div");
    columns.className = "inspector-columns";
    columns.append(
        infoSection("Activity", [
            ["have", "Have"],
            ["availability", "Availability"],
            ["uploaded", "Uploaded"],
            ["downloaded", "Downloaded"],
            ["state", "State"],
            ["running", "Running time"],
            ["remaining", "Remaining time"],
            ["activity", "Last activity"],
            ["error", "Error"],
        ]),
        infoSection("Details", [
            ["name", "Name"],
            ["size", "Size"],
            ["location", "Location"],
            ["hash", "Hash"],
            ["added", "Date added"],
            ["magnet", "Magnet"],
        ]),
    );
    fillTorrentInfo(columns, infos);
    return columns;
}

function infoSection(title: string, rows: readonly (readonly [string, string])[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "inspector-section";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const list = document.createElement("dl");
    list.className = "info-list";
    for (const [field, label] of rows) {
        const term = document.createElement("dt");
        term.textContent = label;
        list.append(term, infoValue(field));
    }
    section.append(heading, list);
    return section;
}

const copyActions: Record<string, string> = {
    hash: "Copy hash",
    magnet: "Copy magnet link",
};

const copyReset = new WeakMap<HTMLButtonElement, number>();

function infoValue(field: string): HTMLElement {
    const value = document.createElement("dd");
    value.dataset.field = field;
    if (field !== "hash" && field !== "magnet") {
        return value;
    }
    value.className = "info-copy";
    const text = document.createElement("span");
    text.className = "info-mono info-copy-value";
    value.append(copyButton(field), text);
    return value;
}

function copyButton(field: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "info-copy-button";
    button.dataset.copyField = field;
    button.dataset.copyAction = copyActions[field] ?? "Copy";
    button.hidden = true;
    resetCopyButton(button);
    button.addEventListener("click", () => {
        const text = button.dataset.copy ?? "";
        if (text === "") {
            return;
        }
        void copyToClipboard(text).then((ok) => {
            if (!button.isConnected || button.dataset.copy !== text) {
                return;
            }
            if (ok) {
                showCopyResult(button, "Copied", "is-copied");
                return;
            }
            showCopyResult(button, "Failed", "is-failed");
        });
    });
    return button;
}

function syncCopyButton(button: HTMLButtonElement, value: string): void {
    const copy = copyableInfoValue(value);
    const changed = (button.dataset.copy ?? "") !== copy;
    button.dataset.copy = copy;
    button.hidden = copy === "";
    button.disabled = copy === "";
    if (copy === "" || changed) {
        resetCopyButton(button);
    }
}

function showCopyResult(button: HTMLButtonElement, label: string, className: "is-copied" | "is-failed"): void {
    button.textContent = label;
    button.classList.remove("is-copied", "is-failed");
    button.classList.add(className);
    const announced = copyResultLabel(button, className === "is-copied");
    button.setAttribute("aria-label", announced);
    button.title = announced;
    const existing = copyReset.get(button);
    if (existing !== undefined) {
        window.clearTimeout(existing);
    }
    copyReset.set(button, window.setTimeout(() => {
        copyReset.delete(button);
        if (button.isConnected) {
            resetCopyButton(button);
        }
    }, 1600));
}

function copyResultLabel(button: HTMLButtonElement, copied: boolean): string {
    if (button.dataset.copyField === "magnet") {
        return copied ? "Magnet link copied" : "Could not copy magnet link";
    }
    return copied ? "Hash copied" : "Could not copy hash";
}

function resetCopyButton(button: HTMLButtonElement): void {
    const existing = copyReset.get(button);
    if (existing !== undefined) {
        window.clearTimeout(existing);
        copyReset.delete(button);
    }
    const action = button.dataset.copyAction ?? "Copy";
    button.textContent = "Copy";
    button.classList.remove("is-copied", "is-failed");
    button.setAttribute("aria-label", action);
    button.title = action;
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await Clipboard.SetText(text);
        return true;
    } catch {
        // A browser preview has no native pasteboard.
    }
    if (!navigator.clipboard?.writeText) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

const peerColumns = [
    {key: "encrypted", label: "Encrypted", className: "peer-encrypted", direction: "desc", minRem: 2.75, defaultRem: 9.25},
    {key: "up", label: "Up", className: "num", direction: "desc", minRem: 6, defaultRem: 7},
    {key: "down", label: "Down", className: "num", direction: "desc", minRem: 6, defaultRem: 7},
    {key: "done", label: "Done", className: "num", direction: "desc", minRem: 5, defaultRem: 6.5},
    {key: "status", label: "Status", className: "", direction: "asc", minRem: 5.75, defaultRem: 6.5},
    {key: "address", label: "Address", className: "", direction: "asc", minRem: 8, defaultRem: 14},
    {key: "client", label: "Client", className: "", direction: "asc", minRem: 8, defaultRem: 12, flex: true},
] as const;

type PeerSortKey = (typeof peerColumns)[number]["key"];

const peerStatusLegend = "D downloading, U uploading, E encrypted, I incoming, H DHT, X PEX, T µTP";

let peerSortTorrent = 0;
let peerSortKey: PeerSortKey | null = null;
let peerSortDirection: "asc" | "desc" = "asc";

function peerTable(peers: readonly Peer[], torrentId: number): HTMLElement {
    if (peers.length === 0) {
        const empty = document.createElement("p");
        empty.className = "inspector-message";
        empty.textContent = "No connected peers";
        return empty;
    }
    if (peerSortTorrent !== torrentId) {
        peerSortTorrent = torrentId;
        peerSortKey = null;
        peerSortDirection = "asc";
    }
    const table = document.createElement("table");
    table.className = "peer-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const headers = new Map<PeerSortKey, HTMLTableCellElement>();
    for (const column of peerColumns) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.className = column.className;
        if (column.key === "status") {
            cell.title = peerStatusLegend;
        }
        cell.append(sortButton(column.label, () => {
            if (peerSortKey === column.key) {
                peerSortDirection = peerSortDirection === "asc" ? "desc" : "asc";
            } else {
                peerSortKey = column.key;
                peerSortDirection = column.direction;
            }
            paint();
        }));
        headers.set(column.key, cell);
        headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    const paint = () => {
        for (const column of peerColumns) {
            const cell = headers.get(column.key);
            if (!cell) {
                continue;
            }
            const active = peerSortKey === column.key;
            cell.setAttribute("aria-sort", active ? (peerSortDirection === "asc" ? "ascending" : "descending") : "none");
            const button = cell.querySelector("button");
            if (button) {
                button.setAttribute("aria-label", active
                    ? `Sort by ${column.label}, ${peerSortDirection === "asc" ? "ascending" : "descending"}`
                    : `Sort by ${column.label}`);
            }
        }
        body.replaceChildren();
        for (const peer of sortPeers(peers)) {
            body.append(peerRow(peer));
        }
    };
    paint();
    table.append(head, body);
    return table;
}

function peerColumnSpecs(): ColumnSpec[] {
    return peerColumns.map((column) => ({
        id: column.key,
        label: column.label,
        min: pxFromRem(column.minRem),
        defaultWidth: pxFromRem(column.defaultRem),
        flex: "flex" in column && column.flex,
    }));
}

function sortPeers(peers: readonly Peer[]): Peer[] {
    const key = peerSortKey;
    if (key === null) {
        return [...peers];
    }
    const direction = peerSortDirection;
    return [...peers].sort((a, b) => {
        const primary = comparePeers(a, b, key, direction);
        if (primary !== 0) {
            return primary;
        }
        return comparePeerText(a.address, b.address);
    });
}

function comparePeers(a: Peer, b: Peer, key: PeerSortKey, direction: "asc" | "desc"): number {
    switch (key) {
        case "encrypted":
            return comparePeerNumber(Number(a.encrypted), Number(b.encrypted), direction);
        case "up":
            return comparePeerNumber(a.rateToPeer, b.rateToPeer, direction);
        case "down":
            return comparePeerNumber(a.rateToClient, b.rateToClient, direction);
        case "done":
            return comparePeerNumber(a.progress, b.progress, direction);
        case "status":
            return comparePeerText(a.flagStr, b.flagStr, direction);
        case "address":
            return comparePeerText(a.address, b.address, direction);
        case "client":
            return comparePeerText(a.clientName, b.clientName, direction);
    }
}

function comparePeerText(a: string, b: string, direction: "asc" | "desc" = "asc"): number {
    const diff = a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"});
    return direction === "asc" ? diff : -diff;
}

function comparePeerNumber(a: number, b: number, direction: "asc" | "desc"): number {
    const diff = a - b;
    return direction === "asc" ? diff : -diff;
}

function peerRow(peer: Peer): HTMLTableRowElement {
    const row = document.createElement("tr");
    row.append(
        encryptedCell(peer.encrypted),
        textCell(formatRate(peer.rateToPeer), "num"),
        textCell(formatRate(peer.rateToClient), "num"),
        textCell(formatPercent(peer.progress), "num"),
        textCell(peer.flagStr || "—", "peer-flags"),
        textCell(peer.address || "—", "peer-address"),
        textCell(peer.clientName || "—", "peer-client"),
    );
    return row;
}

function encryptedCell(encrypted: boolean): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "peer-encrypted";
    const label = document.createElement("span");
    label.className = "peer-lock-wrap";
    label.title = encrypted ? "Encrypted" : "Not encrypted";
    label.setAttribute("aria-label", encrypted ? "Encrypted" : "Not encrypted");
    label.append(lockIcon(encrypted));
    cell.append(label);
    return cell;
}

function textCell(value: string, className: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = className;
    cell.textContent = value;
    cell.title = value;
    return cell;
}

function lockIcon(encrypted: boolean): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", encrypted ? "peer-lock" : "peer-lock off");
    svg.setAttribute("aria-hidden", "true");
    svg.append(svgPath("M5.2 7.1V5.2a2.8 2.8 0 0 1 5.6 0v1.9"));
    const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    body.setAttribute("x", "3.2");
    body.setAttribute("y", "7");
    body.setAttribute("width", "9.6");
    body.setAttribute("height", "6.2");
    body.setAttribute("rx", "1");
    svg.append(body);
    if (!encrypted) {
        svg.append(svgPath("M4.4 9.2l7.2 2.6M11.6 9.2L4.4 11.8"));
    }
    return svg;
}

function trackerList(trackers: Tracker[]): HTMLElement {
    if (trackers.length === 0) {
        const message = document.createElement("p");
        message.className = "inspector-message";
        message.textContent = "No trackers";
        return message;
    }
    const list = document.createElement("div");
    list.className = "tracker-list";
    for (const tracker of trackers) {
        list.append(trackerRow(tracker));
    }
    return list;
}

function trackerRow(tracker: Tracker): HTMLElement {
    const row = document.createElement("article");
    row.className = "tracker";
    const title = document.createElement("div");
    title.className = "tracker-title";
    title.textContent = `${tracker.announce} - tier ${tracker.tier + 1}`;
    const main = document.createElement("div");
    main.className = "tracker-main";
    main.append(trackerLine(announceLine(tracker)), trackerLine(nextAnnounceLine(tracker)), trackerLine(scrapeLine(tracker)));
    const stats = document.createElement("div");
    stats.className = "tracker-stats";
    for (const line of [
        `Seeders: ${swarmCount(tracker.seederCount)}`,
        `Leechers: ${swarmCount(tracker.leecherCount)}`,
        `Downloads: ${swarmCount(tracker.downloadCount)}`,
    ]) {
        const item = document.createElement("div");
        item.textContent = line;
        stats.append(item);
    }
    const body = document.createElement("div");
    body.className = "tracker-body";
    body.append(main, stats);
    row.append(title, body);
    return row;
}

function trackerLine(text: string): HTMLDivElement {
    const line = document.createElement("div");
    line.textContent = text;
    return line;
}

function announceLine(tracker: Tracker, now = new Date()): string {
    const when = formatTrackerClock(tracker.lastAnnounceTime, now);
    if (!tracker.hasAnnounced && tracker.lastAnnounceTime <= 0) {
        return "Last Announce: Never";
    }
    if (!tracker.lastAnnounceSucceeded) {
        const reason = tracker.lastAnnounceResult || "Unknown error";
        return when ? `Announce error: ${reason} - ${when}` : `Announce error: ${reason}`;
    }
    const peers = tracker.lastAnnouncePeerCount === 1 ? "1 peer" : `${tracker.lastAnnouncePeerCount} peers`;
    return `Last Announce: ${when} (got ${peers})`;
}

function nextAnnounceLine(tracker: Tracker, now = Date.now()): string {
    const delta = Math.max(0, Math.round(tracker.nextAnnounceTime - now / 1000));
    return `Next announce in ${formatSpan(delta)}`;
}

function scrapeLine(tracker: Tracker, now = new Date()): string {
    const when = formatTrackerClock(tracker.lastScrapeTime, now);
    if (!tracker.hasScraped && tracker.lastScrapeTime <= 0) {
        return "Last Scrape: Never";
    }
    if (!tracker.lastScrapeSucceeded) {
        const reason = tracker.lastScrapeResult || "Unknown error";
        return when ? `Scrape error: ${reason} - ${when}` : `Scrape error: ${reason}`;
    }
    return `Last Scrape: ${when}`;
}

function formatTrackerClock(unixSeconds: number, now: Date): string {
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
        return "";
    }
    const date = new Date(unixSeconds * 1000);
    const time = date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true});
    if (date.toDateString() === now.toDateString()) {
        return `Today ${time}`;
    }
    return `${date.toLocaleDateString([], {month: "short", day: "numeric", year: "numeric"})} ${time}`;
}

function formatSpan(total: number): string {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0 && minutes > 0) {
        return `${hours} ${plural(hours, "hour")} and ${minutes} ${plural(minutes, "minute")}`;
    }
    if (hours > 0) {
        return `${hours} ${plural(hours, "hour")}`;
    }
    if (minutes > 0) {
        return `${minutes} ${plural(minutes, "minute")}`;
    }
    return `${seconds} ${plural(seconds, "second")}`;
}

function plural(count: number, word: string): string {
    return count === 1 ? word : `${word}s`;
}

function swarmCount(value: number): string {
    return value < 0 ? "N/A" : String(value);
}

let collapsedTorrent = 0;
const collapsedPaths = new Set<string>();

function collapsedFor(torrentId: number): Set<string> {
    if (collapsedTorrent !== torrentId) {
        collapsedTorrent = torrentId;
        collapsedPaths.clear();
    }
    return collapsedPaths;
}

const fileColumns = [
    {id: "download", label: "Download", minRem: 2.75, defaultRem: 3.25},
    {id: "name", label: "Name", minRem: 8, defaultRem: 16, flex: true, direction: "asc"},
    {id: "priority", label: "Priority", minRem: 6.75, defaultRem: 8.25, direction: "desc"},
    {id: "size", label: "Size", minRem: 4.5, defaultRem: 6.5, direction: "desc"},
    {id: "downloaded", label: "Downloaded", minRem: 6, defaultRem: 9.5, direction: "desc"},
    {id: "percent", label: "%", minRem: 5.75, defaultRem: 6.25, direction: "desc"},
] as const;

let fileSortTorrent = 0;
let fileSortKey: FileSortKey | null = null;
let fileSortDirection: "asc" | "desc" = "asc";

function fileTable(files: readonly TorrentFile[], torrentId: number, onUpdate: (update: FileUpdate) => void): HTMLElement {
    if (files.length === 0) {
        const empty = document.createElement("p");
        empty.className = "inspector-message";
        empty.textContent = "No files";
        return empty;
    }
    if (fileSortTorrent !== torrentId) {
        fileSortTorrent = torrentId;
        fileSortKey = null;
        fileSortDirection = "asc";
    }
    const table = document.createElement("table");
    table.className = "file-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const headers = new Map<FileSortKey, HTMLTableCellElement>();
    const nodes = fileTree(files);
    for (const column of fileColumns) {
        const cell = document.createElement("th");
        cell.scope = "col";
        if (column.id === "download") {
            cell.className = "file-download";
            cell.append(downloadCheck("all files", wantedState(fileSummary(nodes)), (wanted) => {
                onUpdate({indices: nodes.flatMap((node) => fileIndices(node)), wanted});
            }));
            headRow.append(cell);
            continue;
        }
        if (column.id === "size" || column.id === "downloaded" || column.id === "percent") {
            cell.className = "num";
        }
        if (!("direction" in column)) {
            headRow.append(cell);
            continue;
        }
        const sortable = column;
        cell.append(sortButton(sortable.label, () => {
            if (fileSortKey === sortable.id) {
                fileSortDirection = fileSortDirection === "asc" ? "desc" : "asc";
            } else {
                fileSortKey = sortable.id;
                fileSortDirection = sortable.direction;
            }
            paint();
        }));
        headers.set(sortable.id, cell);
        headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    const collapsed = collapsedFor(torrentId);
    const paint = () => {
        for (const column of fileColumns) {
            if (!("direction" in column)) {
                continue;
            }
            const cell = headers.get(column.id);
            if (!cell) {
                continue;
            }
            const active = fileSortKey === column.id;
            cell.setAttribute("aria-sort", active ? (fileSortDirection === "asc" ? "ascending" : "descending") : "none");
            const button = cell.querySelector("button");
            if (button) {
                button.setAttribute("aria-label", active
                    ? `Sort by ${column.label}, ${fileSortDirection === "asc" ? "ascending" : "descending"}`
                    : `Sort by ${column.label}`);
            }
        }
        sortFileNodes(nodes, fileSortKey, fileSortDirection);
        body.replaceChildren();
        appendFileNodes(body, nodes, 0, "", collapsed, paint, onUpdate);
    };
    paint();
    table.append(head, body);
    return table;
}

function fileColumnSpecs(): ColumnSpec[] {
    return fileColumns.map((column) => ({
        id: column.id,
        label: column.label,
        min: pxFromRem(column.minRem),
        defaultWidth: pxFromRem(column.defaultRem),
        flex: "flex" in column && column.flex,
    }));
}

function sortButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "col-sort";
    const text = document.createElement("span");
    text.className = "col-label";
    text.textContent = label;
    const mark = document.createElement("span");
    mark.className = "col-sort-mark";
    mark.setAttribute("aria-hidden", "true");
    button.append(text, mark);
    button.addEventListener("click", onClick);
    return button;
}

function appendFileNodes(body: HTMLElement, nodes: readonly FileNode[], depth: number, parentPath: string, collapsed: Set<string>, paint: () => void, onUpdate: (update: FileUpdate) => void): void {
    for (const node of nodes) {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        const folder = node.children.length > 0;
        const open = folder && !collapsed.has(path);
        body.append(fileRow(node, depth, folder, open, () => {
            if (collapsed.has(path)) {
                collapsed.delete(path);
            } else {
                collapsed.add(path);
            }
            paint();
        }, onUpdate));
        if (open) {
            appendFileNodes(body, node.children, depth + 1, path, collapsed, paint, onUpdate);
        }
    }
}

function fileRow(node: FileNode, depth: number, folder: boolean, open: boolean, onToggle: () => void, onUpdate: (update: FileUpdate) => void): HTMLTableRowElement {
    const row = document.createElement("tr");
    const classes: string[] = [];
    if (folder) {
        classes.push("is-folder");
        row.addEventListener("click", onToggle);
    }
    if (wantedState(node) === "none") {
        classes.push("is-skipped");
    }
    row.className = classes.join(" ");
    const download = document.createElement("td");
    download.className = "file-download";
    download.append(downloadCheck(node.name, wantedState(node), (wanted) => {
        onUpdate({indices: fileIndices(node), wanted});
    }));
    download.addEventListener("click", (event) => event.stopPropagation());
    const name = document.createElement("td");
    name.className = "file-name";
    const label = document.createElement("div");
    label.className = "file-label";
    label.style.paddingLeft = `${depth * 16}px`;
    if (folder) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-toggle";
        button.setAttribute("aria-expanded", open ? "true" : "false");
        button.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${node.name}`);
        const chevron = document.createElement("span");
        chevron.className = "file-chevron";
        chevron.setAttribute("aria-hidden", "true");
        button.append(chevron);
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            onToggle();
        });
        label.append(button);
    } else {
        const pad = document.createElement("span");
        pad.className = "file-pad";
        pad.setAttribute("aria-hidden", "true");
        label.append(pad);
    }
    const text = document.createElement("span");
    text.className = folder ? "file-folder" : "file-leaf";
    text.textContent = node.name;
    text.title = node.name;
    label.append(text);
    name.append(label);
    const priority = document.createElement("td");
    priority.className = "file-priority";
    priority.append(prioritySelect(node.name, priorityState(node), (value) => {
        onUpdate({indices: fileIndices(node), priority: value});
    }));
    priority.addEventListener("click", (event) => event.stopPropagation());
    const fraction = node.size > 0 ? node.have / node.size : 0;
    row.append(download, name, priority, fileStat(formatBytes(node.size)), fileStat(formatBytes(node.have)), fileStat(formatPercent(fraction)));
    return row;
}

function downloadCheck(name: string, state: ReturnType<typeof wantedState>, onChange: (wanted: boolean) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "file-check";
    input.checked = state === "all";
    input.indeterminate = state === "mixed";
    input.setAttribute("aria-label", `Download ${name}`);
    input.title = state === "none" ? "Skipped" : state === "mixed" ? "Some files skipped" : "Download";
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => onChange(state !== "all"));
    return input;
}

function prioritySelect(name: string, state: ReturnType<typeof priorityState>, onChange: (priority: FilePriority) => void): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = state === "mixed" ? "file-priority-select is-mixed" : "file-priority-select";
    select.setAttribute("aria-label", `Priority for ${name}`);
    if (state === "mixed") {
        select.title = "Mixed priority";
        const mixed = document.createElement("option");
        mixed.value = "mixed";
        mixed.textContent = "Mixed";
        mixed.disabled = true;
        select.append(mixed);
    }
    for (const option of [
        ["low", "Low"],
        ["normal", "Normal"],
        ["high", "High"],
    ] as const) {
        const item = document.createElement("option");
        item.value = option[0];
        item.textContent = option[1];
        select.append(item);
    }
    select.value = state;
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("mousedown", (event) => event.stopPropagation());
    select.addEventListener("change", () => {
        const value = select.value;
        if (value === "low" || value === "normal" || value === "high") {
            onChange(value);
        }
    });
    return select;
}

function fileStat(value: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "num";
    cell.textContent = value;
    return cell;
}

function svgPath(d: string): SVGPathElement {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    return path;
}
