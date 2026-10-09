import type {Torrent} from "../bindings/github.com/stenstromen/gearbox";

export const sortOptions = [
    {key: "name", label: "Name"},
    {key: "size", label: "Size"},
    {key: "progress", label: "Progress"},
    {key: "peers", label: "Peers"},
    {key: "download", label: "Download"},
    {key: "upload", label: "Upload"},
    {key: "ratio", label: "Ratio"},
    {key: "status", label: "Status"},
] as const;

export type SortKey = (typeof sortOptions)[number]["key"];

const reversePrefix = "-";

export function encodeSort(key: SortKey, reversed: boolean): string {
    return reversed ? `${reversePrefix}${key}` : key;
}

export function decodeSort(value: string): {key: SortKey; reversed: boolean} | null {
    const reversed = value.startsWith(reversePrefix);
    const key = reversed ? value.slice(reversePrefix.length) : value;
    if (!isSortKey(key)) {
        return null;
    }
    return {key, reversed};
}

export function isSortKey(value: string): value is SortKey {
    return sortOptions.some((option) => option.key === value);
}

const numericDirection: Record<SortKey, "asc" | "desc"> = {
    name: "asc",
    size: "desc",
    progress: "desc",
    peers: "desc",
    download: "desc",
    upload: "desc",
    ratio: "desc",
    status: "asc",
};

export const statusFilters = [
    {key: "all", label: "All"},
    {key: "active", label: "Active"},
    {key: "downloading", label: "Downloading"},
    {key: "seeding", label: "Seeding"},
    {key: "paused", label: "Paused"},
    {key: "finished", label: "Finished"},
    {key: "error", label: "Error"},
] as const;

export type StatusFilter = (typeof statusFilters)[number]["key"];

export function isStoppedStatus(status: string): boolean {
    return status === "Stopped" || status === "Seeding complete";
}

export function filterByName(torrents: readonly Torrent[], query: string): Torrent[] {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === "") {
        return [...torrents];
    }
    return torrents.filter((torrent) => torrent.name.toLocaleLowerCase().includes(needle));
}

export function filterByStatus(torrents: readonly Torrent[], status: StatusFilter): Torrent[] {
    if (status === "all") {
        return [...torrents];
    }
    return torrents.filter((torrent) => matchesStatus(torrent, status));
}

function matchesStatus(torrent: Torrent, status: StatusFilter): boolean {
    switch (status) {
        case "all":
            return true;
        case "active":
            return torrent.rateDownload > 0 || torrent.rateUpload > 0 || torrent.status === "Verifying";
        case "downloading":
            return torrent.status === "Downloading" || torrent.status === "Queued to download";
        case "seeding":
            return torrent.status === "Seeding" || torrent.status === "Queued to seed";
        case "paused":
            return isStoppedStatus(torrent.status);
        case "finished":
            return torrent.percentDone >= 1;
        case "error":
            return torrent.error.trim() !== "";
    }
}

export function sortTorrents(torrents: readonly Torrent[], key: SortKey, reversed = false): Torrent[] {
    return [...torrents].sort((a, b) => {
        const order = compareTorrents(a, b, key);
        return reversed ? -order : order;
    });
}

function compareTorrents(a: Torrent, b: Torrent, key: SortKey): number {
    const primary = compareBy(a, b, key);
    if (primary !== 0) {
        return primary;
    }
    const byName = compareText(a.name, b.name);
    if (byName !== 0) {
        return byName;
    }
    return a.id - b.id;
}

function compareBy(a: Torrent, b: Torrent, key: SortKey): number {
    switch (key) {
        case "name":
            return compareText(a.name, b.name);
        case "size":
            return compareNumber(a.totalSize, b.totalSize, numericDirection.size);
        case "progress":
            return compareNumber(a.percentDone, b.percentDone, numericDirection.progress);
        case "peers":
            return compareNumber(a.peersConnected, b.peersConnected, numericDirection.peers);
        case "download":
            return compareNumber(a.rateDownload, b.rateDownload, numericDirection.download);
        case "upload":
            return compareNumber(a.rateUpload, b.rateUpload, numericDirection.upload);
        case "ratio":
            return compareNumber(ratioRank(a.uploadRatio), ratioRank(b.uploadRatio), numericDirection.ratio);
        case "status":
            return compareText(a.status, b.status);
    }
}

function compareText(a: string, b: string): number {
    return a.localeCompare(b, undefined, {sensitivity: "base"});
}

const ratioNotAvailable = -1;
const ratioInfinite = -2;

function ratioRank(ratio: number): number {
    if (ratio === ratioInfinite) {
        return Number.POSITIVE_INFINITY;
    }
    if (ratio === ratioNotAvailable || !Number.isFinite(ratio)) {
        return Number.NEGATIVE_INFINITY;
    }
    return ratio;
}

function compareNumber(a: number, b: number, direction: "asc" | "desc"): number {
    const diff = a - b;
    return direction === "asc" ? diff : -diff;
}
