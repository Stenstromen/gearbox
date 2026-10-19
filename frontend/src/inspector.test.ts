import type {TorrentInfo} from "../bindings/github.com/stenstromen/gearbox/index.ts";
import {mixedLabel, torrentInfoFields} from "./inspector-info.ts";
import {formatBytes, formatPercent, formatRatio} from "./format.ts";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function torrent(partial: Partial<TorrentInfo> & Pick<TorrentInfo, "id">): TorrentInfo {
    return {
        name: "Gamma",
        status: "Seeding",
        error: "",
        percentDone: 1,
        have: 4096,
        availability: 1,
        uploadedEver: 2048,
        uploadRatio: 0.5,
        downloadedEver: 1024,
        secondsActive: 30,
        eta: -1,
        activityDate: 0,
        totalSize: 4096,
        sizeWhenDone: 4096,
        pieceCount: 4,
        pieceSize: 1024,
        downloadDir: "/downloads",
        hashString: "abc",
        addedDate: 1700000000,
        magnetLink: "magnet:?xt=urn:btih:abc",
        peers: null,
        trackers: null,
        files: null,
        ...partial,
    };
}

const alone = torrent({id: 1, name: "Gamma", uploadRatio: 3, uploadedEver: 3000, sizeWhenDone: 100});
const aloneFields = torrentInfoFields([alone]);
assert(aloneFields.name === "Gamma", `single name, got ${aloneFields.name}`);
assert(aloneFields.uploaded === `${formatBytes(3000)} (ratio ${formatRatio(3)})`, `single upload, got ${aloneFields.uploaded}`);
assert(aloneFields.downloaded === formatBytes(1024), `single download, got ${aloneFields.downloaded}`);
assert(aloneFields.size === `${formatBytes(4096)} (4 pieces of ${formatBytes(1024)})`, `single size, got ${aloneFields.size}`);

const alpha = torrent({
    id: 1,
    name: "Alpha",
    uploadedEver: 2048,
    downloadedEver: 1024,
    sizeWhenDone: 4096,
    uploadRatio: 0.5,
    have: 4096,
    percentDone: 1,
    totalSize: 8192,
    pieceCount: 4,
    pieceSize: 2048,
    hashString: "aaa",
    downloadDir: "/downloads",
    status: "Seeding",
});
const beta = torrent({
    id: 2,
    name: "Alpha",
    uploadedEver: 2048,
    downloadedEver: 3072,
    sizeWhenDone: 4096,
    uploadRatio: 0.5,
    have: 2048,
    percentDone: 0.5,
    totalSize: 4096,
    pieceCount: 1,
    pieceSize: 4096,
    hashString: "bbb",
    downloadDir: "/downloads",
    status: "Downloading",
});
const mixed = torrentInfoFields([alpha, beta]);
assert(mixed.name === mixedLabel, `mixed name, got ${mixed.name}`);
assert(mixed.uploaded === `${formatBytes(4096)} (ratio ${formatRatio(4096 / 8192)})`, `mixed upload, got ${mixed.uploaded}`);
assert(mixed.downloaded === formatBytes(4096), `mixed download, got ${mixed.downloaded}`);
assert(mixed.size === `${formatBytes(12288)} (5 pieces)`, `mixed size, got ${mixed.size}`);
assert(!mixed.size.includes("of"), `piece size should be omitted, got ${mixed.size}`);
assert(mixed.hash === mixedLabel, `mixed hash, got ${mixed.hash}`);
assert(mixed.state === mixedLabel, `mixed state, got ${mixed.state}`);
assert(mixed.location === "/downloads", `shared location, got ${mixed.location}`);
assert(mixed.magnet === mixedLabel, `mixed magnet, got ${mixed.magnet}`);
assert(mixed.have === `${formatBytes(6144)} (${formatPercent((4096 + 2048) / 8192)})`, `mixed have, got ${mixed.have}`);

const samePieces = torrentInfoFields([
    torrent({id: 3, pieceCount: 2, pieceSize: 1024, totalSize: 2048}),
    torrent({id: 4, pieceCount: 2, pieceSize: 1024, totalSize: 2048, hashString: "other"}),
]);
assert(samePieces.size === `${formatBytes(4096)} (4 pieces of ${formatBytes(1024)})`, `uniform pieces, got ${samePieces.size}`);

const onePiece = torrentInfoFields([
    torrent({id: 5, pieceCount: 1, pieceSize: 1024, totalSize: 1024}),
    torrent({id: 6, pieceCount: 0, pieceSize: 4096, totalSize: 0, hashString: "other"}),
]);
assert(onePiece.size === `${formatBytes(1024)} (1 piece)`, `singular pieces, got ${onePiece.size}`);

console.log("inspector tests passed");
