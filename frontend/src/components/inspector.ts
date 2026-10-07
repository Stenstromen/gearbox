import type {Peer, TorrentFile, Tracker, TorrentInfo} from "../../bindings/github.com/stenstromen/gearbox";
import {formatAvailability, formatBytes, formatDuration, formatLastActivity, formatPercent, formatRate, formatRatio, formatTimestamp} from "../format";

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
};

export function renderInspector(host: HTMLElement, state: InspectorState, onTab: (tab: InspectorTab) => void, onClose: () => void): void {
    host.replaceChildren();
    host.append(tabBar(state.tab, onTab, onClose), panelBody(state));
}

export function fillTorrentInfo(host: HTMLElement, info: TorrentInfo): void {
    for (const [field, value] of Object.entries(infoFields(info))) {
        const node = host.querySelector(`[data-field="${field}"]`);
        if (!node) {
            continue;
        }
        node.textContent = value;
        node.classList.toggle("info-error", field === "error" && info.error.trim() !== "");
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

function panelBody(state: InspectorState): HTMLElement {
    const body = document.createElement("div");
    body.className = "inspector-body";
    body.id = `inspector-panel-${state.tab}`;
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", `inspector-tab-${state.tab}`);
    if (!state.info) {
        body.append(statusMessage(state));
        return body;
    }
    if (state.tab === "info") {
        body.append(infoColumns(state.info));
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
        body.append(fileTable(state.info.files ?? [], state.info.id));
    }
    return body;
}

function statusMessage(state: InspectorState): HTMLParagraphElement {
    const message = document.createElement("p");
    message.className = state.error ? "inspector-message inspector-message-error" : "inspector-message";
    message.textContent = state.error || (state.loading ? "Loading…" : "");
    return message;
}

function infoColumns(info: TorrentInfo): HTMLElement {
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
    fillTorrentInfo(columns, info);
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
        const value = document.createElement("dd");
        value.dataset.field = field;
        if (field === "hash" || field === "magnet") {
            value.className = "info-mono";
        }
        list.append(term, value);
    }
    section.append(heading, list);
    return section;
}

function infoFields(info: TorrentInfo): Record<string, string> {
    const pieces = info.pieceCount === 1 ? "1 piece" : `${info.pieceCount} pieces`;
    return {
        have: `${formatBytes(info.have)} (${formatPercent(info.percentDone)})`,
        availability: formatAvailability(info.availability),
        uploaded: `${formatBytes(info.uploadedEver)} (ratio ${formatRatio(info.uploadRatio)})`,
        downloaded: formatBytes(info.downloadedEver),
        state: info.status || "Unknown",
        running: formatDuration(info.secondsActive),
        remaining: formatDuration(info.eta),
        activity: formatLastActivity(info.activityDate),
        error: info.error.trim() || "None",
        name: info.name || "Untitled",
        size: `${formatBytes(info.totalSize)} (${pieces} of ${formatBytes(info.pieceSize)})`,
        location: info.downloadDir || "—",
        hash: info.hashString || "—",
        added: formatTimestamp(info.addedDate),
        magnet: info.magnetLink || "—",
    };
}

const peerColumns = [
    {key: "encrypted", label: "Encrypted", className: "peer-encrypted", direction: "desc"},
    {key: "up", label: "Up", className: "num", direction: "desc"},
    {key: "down", label: "Down", className: "num", direction: "desc"},
    {key: "done", label: "Done", className: "num", direction: "desc"},
    {key: "status", label: "Status", className: "", direction: "asc"},
    {key: "address", label: "Address", className: "", direction: "asc"},
    {key: "client", label: "Client", className: "", direction: "asc"},
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = "peer-sort";
        const label = document.createElement("span");
        label.textContent = column.label;
        const mark = document.createElement("span");
        mark.className = "peer-sort-mark";
        mark.setAttribute("aria-hidden", "true");
        button.append(label, mark);
        button.addEventListener("click", () => {
            if (peerSortKey === column.key) {
                peerSortDirection = peerSortDirection === "asc" ? "desc" : "asc";
            } else {
                peerSortKey = column.key;
                peerSortDirection = column.direction;
            }
            paint();
        });
        cell.append(button);
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

type FileNode = {
    name: string;
    size: number;
    have: number;
    children: FileNode[];
};

let collapsedTorrent = 0;
const collapsedPaths = new Set<string>();

function collapsedFor(torrentId: number): Set<string> {
    if (collapsedTorrent !== torrentId) {
        collapsedTorrent = torrentId;
        collapsedPaths.clear();
    }
    return collapsedPaths;
}

function fileTable(files: readonly TorrentFile[], torrentId: number): HTMLElement {
    if (files.length === 0) {
        const empty = document.createElement("p");
        empty.className = "inspector-message";
        empty.textContent = "No files";
        return empty;
    }
    const table = document.createElement("table");
    table.className = "file-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Name", "Size", "Downloaded", "%"]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        if (label !== "Name") {
            cell.className = "num";
        }
        headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    const nodes = fileTree(files);
    const collapsed = collapsedFor(torrentId);
    const paint = () => {
        body.replaceChildren();
        appendFileNodes(body, nodes, 0, "", collapsed, paint);
    };
    paint();
    table.append(head, body);
    return table;
}

function appendFileNodes(body: HTMLElement, nodes: readonly FileNode[], depth: number, parentPath: string, collapsed: Set<string>, paint: () => void): void {
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
        }));
        if (open) {
            appendFileNodes(body, node.children, depth + 1, path, collapsed, paint);
        }
    }
}

function fileRow(node: FileNode, depth: number, folder: boolean, open: boolean, onToggle: () => void): HTMLTableRowElement {
    const row = document.createElement("tr");
    if (folder) {
        row.className = "is-folder";
        row.addEventListener("click", onToggle);
    }
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
    const fraction = node.size > 0 ? node.have / node.size : 0;
    row.append(name, fileStat(formatBytes(node.size)), fileStat(formatBytes(node.have)), fileStat(formatPercent(fraction)));
    return row;
}

function fileStat(value: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.className = "num";
    cell.textContent = value;
    return cell;
}

function fileTree(files: readonly TorrentFile[]): FileNode[] {
    const roots: FileNode[] = [];
    const byPath = new Map<string, FileNode>();
    const ensureFolder = (parts: readonly string[]): FileNode[] => {
        let list = roots;
        let key = "";
        for (const part of parts) {
            key = key ? `${key}/${part}` : part;
            let folder = byPath.get(key);
            if (!folder) {
                folder = {name: part, size: 0, have: 0, children: []};
                byPath.set(key, folder);
                list.push(folder);
            }
            list = folder.children;
        }
        return list;
    };
    for (const file of files) {
        const parts = file.name.split("/").filter((part) => part !== "");
        if (parts.length === 0) {
            continue;
        }
        const parent = ensureFolder(parts.slice(0, -1));
        const key = parts.join("/");
        const existing = byPath.get(key);
        if (existing) {
            existing.size = file.size;
            existing.have = file.have;
            continue;
        }
        const leaf: FileNode = {name: parts[parts.length - 1], size: file.size, have: file.have, children: []};
        byPath.set(key, leaf);
        parent.push(leaf);
    }
    rollupFiles(roots);
    sortFileNodes(roots);
    return roots;
}

function rollupFiles(nodes: FileNode[]): {size: number; have: number} {
    let size = 0;
    let have = 0;
    for (const node of nodes) {
        if (node.children.length > 0) {
            const totals = rollupFiles(node.children);
            node.size += totals.size;
            node.have += totals.have;
        }
        size += node.size;
        have += node.have;
    }
    return {size, have};
}

function sortFileNodes(nodes: FileNode[]): void {
    nodes.sort((a, b) => {
        const folderDelta = Number(b.children.length > 0) - Number(a.children.length > 0);
        if (folderDelta !== 0) {
            return folderDelta;
        }
        return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"});
    });
    for (const node of nodes) {
        sortFileNodes(node.children);
    }
}

function svgPath(d: string): SVGPathElement {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    return path;
}
