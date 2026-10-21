import type {TorrentInfo} from "../bindings/github.com/stenstromen/gearbox/index.ts";
import {formatAvailability, formatBytes, formatDuration, formatLastActivity, formatPercent, formatRatio, formatTimestamp} from "./format.ts";

export const mixedLabel = "Mixed";

const emptyLabel = "—";

export function copyableInfoValue(value: string): string {
    if (value === "" || value === emptyLabel || value === mixedLabel) {
        return "";
    }
    return value;
}

export function torrentInfoFields(infos: readonly TorrentInfo[]): Record<string, string> {
    if (infos.length === 1) {
        const [info] = infos;
        if (info) {
            return singleTorrentFields(info);
        }
    }
    if (infos.length === 0) {
        return {};
    }
    return mixedTorrentFields(infos);
}

function singleTorrentFields(info: TorrentInfo): Record<string, string> {
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
        size: sizeField(info.totalSize, info.pieceCount, info.pieceSize),
        location: info.downloadDir || emptyLabel,
        hash: info.hashString || emptyLabel,
        added: formatTimestamp(info.addedDate),
        magnet: info.magnetLink || emptyLabel,
    };
}

function mixedTorrentFields(infos: readonly TorrentInfo[]): Record<string, string> {
    const status = shared(infos, (info) => info.status);
    const seconds = shared(infos, (info) => info.secondsActive);
    const eta = shared(infos, (info) => info.eta);
    const error = shared(infos, (info) => info.error.trim());
    const location = shared(infos, (info) => info.downloadDir);
    const hash = shared(infos, (info) => info.hashString);
    const added = shared(infos, (info) => info.addedDate);
    const availability = shared(infos, (info) => info.availability);
    const pieceSize = shared(infos, (info) => info.pieceSize);
    const latest = infos.reduce((max, info) => Math.max(max, Number.isFinite(info.activityDate) ? info.activityDate : 0), 0);
    return {
        have: `${formatBytes(sumBy(infos, (info) => info.have))} (${formatPercent(combinedPercent(infos))})`,
        availability: availability === undefined ? mixedLabel : formatAvailability(availability),
        uploaded: `${formatBytes(sumBy(infos, (info) => info.uploadedEver))} (ratio ${formatRatio(combinedUploadRatio(infos))})`,
        downloaded: formatBytes(sumBy(infos, (info) => info.downloadedEver)),
        state: status === undefined ? mixedLabel : (status || "Unknown"),
        running: seconds === undefined ? mixedLabel : formatDuration(seconds),
        remaining: eta === undefined ? mixedLabel : formatDuration(eta),
        activity: formatLastActivity(latest),
        error: error === undefined ? mixedLabel : (error || "None"),
        name: mixedLabel,
        size: sizeField(sumBy(infos, (info) => info.totalSize), sumBy(infos, (info) => info.pieceCount), pieceSize === undefined ? null : pieceSize),
        location: location === undefined ? mixedLabel : (location || emptyLabel),
        hash: hash === undefined ? mixedLabel : (hash || emptyLabel),
        added: added === undefined ? mixedLabel : formatTimestamp(added),
        magnet: mixedLabel,
    };
}

function sizeField(totalSize: number, pieceCount: number, pieceSize: number | null): string {
    const pieces = pieceCount === 1 ? "1 piece" : `${pieceCount} pieces`;
    if (pieceSize === null) {
        return `${formatBytes(totalSize)} (${pieces})`;
    }
    return `${formatBytes(totalSize)} (${pieces} of ${formatBytes(pieceSize)})`;
}

function combinedPercent(infos: readonly TorrentInfo[]): number {
    let done = 0;
    let basis = 0;
    for (const info of infos) {
        const weight = info.sizeWhenDone > 0 ? info.sizeWhenDone : info.totalSize;
        if (!Number.isFinite(weight) || weight <= 0) {
            continue;
        }
        done += (Number.isFinite(info.percentDone) ? info.percentDone : 0) * weight;
        basis += weight;
    }
    return basis > 0 ? done / basis : 0;
}

function combinedUploadRatio(infos: readonly TorrentInfo[]): number {
    const uploaded = sumBy(infos, (info) => info.uploadedEver);
    const basis = sumBy(infos, (info) => info.sizeWhenDone);
    if (basis > 0) {
        return uploaded / basis;
    }
    const have = sumBy(infos, (info) => info.have);
    if (have > 0) {
        return uploaded / have;
    }
    return uploaded > 0 ? -2 : 0;
}

function shared<T>(infos: readonly TorrentInfo[], pick: (info: TorrentInfo) => T): T | undefined {
    const first = infos[0];
    if (!first) {
        return undefined;
    }
    const value = pick(first);
    return infos.every((info) => Object.is(pick(info), value)) ? value : undefined;
}

function sumBy(infos: readonly TorrentInfo[], pick: (info: TorrentInfo) => number): number {
    return infos.reduce((total, info) => {
        const value = pick(info);
        return total + (Number.isFinite(value) ? value : 0);
    }, 0);
}
