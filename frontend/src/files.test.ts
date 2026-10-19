import type {TorrentFile} from "../bindings/github.com/stenstromen/gearbox/index.ts";
import {applyFileUpdate, fileIndices, fileSummary, fileTree, priorityState, sortFileNodes, wantedState} from "./files.ts";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function file(partial: Partial<TorrentFile> & Pick<TorrentFile, "index" | "name">): TorrentFile {
    return {
        size: 10,
        have: 0,
        wanted: true,
        priority: 0,
        ...partial,
    };
}

const files = [
    file({index: 0, name: "Movie/video.mkv", size: 4000, have: 2000, wanted: true, priority: 1}),
    file({index: 1, name: "Movie/subs/en.srt", size: 100, have: 0, wanted: false, priority: -1}),
    file({index: 2, name: "readme.txt", size: 20, have: 20, wanted: true, priority: 0}),
];

const tree = fileTree(files);
assert(tree.length === 2, `roots = ${tree.map((node) => node.name).join(",")}`);
const movie = tree.find((node) => node.name === "Movie");
const readme = tree.find((node) => node.name === "readme.txt");
assert(movie !== undefined && readme !== undefined, "missing roots");
if (!movie || !readme) {
    throw new Error("missing roots");
}
assert(movie.size === 4100 && movie.have === 2000, `movie totals ${movie.size}/${movie.have}`);
assert(movie.fileCount === 2 && movie.wantedCount === 1, `movie wanted ${movie.wantedCount}/${movie.fileCount}`);
assert(wantedState(movie) === "mixed", `movie wanted state ${wantedState(movie)}`);
assert(priorityState(movie) === "mixed", `movie priority ${priorityState(movie)}`);
assert(fileIndices(movie).join(",") === "0,1", `movie indices ${fileIndices(movie).join(",")}`);
const subs = movie.children.find((node) => node.name === "subs");
assert(subs !== undefined && wantedState(subs) === "none" && priorityState(subs) === "low", "subs should be skipped and low");
assert(wantedState(readme) === "all" && priorityState(readme) === "normal" && readme.index === 2, "readme state");
const summary = fileSummary(tree);
assert(summary.fileCount === 3 && summary.wantedCount === 2 && summary.high === 1 && summary.low === 1, `summary ${JSON.stringify(summary)}`);
assert(wantedState(summary) === "mixed" && priorityState(summary) === "mixed", "summary state");

const updated = applyFileUpdate(files, {indices: fileIndices(movie), wanted: true, priority: "low"});
assert(updated[0].wanted && updated[0].priority === -1, `video ${updated[0].wanted} ${updated[0].priority}`);
assert(updated[1].wanted && updated[1].priority === -1, `subs file ${updated[1].wanted} ${updated[1].priority}`);
assert(updated[2] === files[2], "untouched file should keep its object");
const after = fileTree(updated);
const movieAfter = after.find((node) => node.name === "Movie");
assert(movieAfter !== undefined && wantedState(movieAfter) === "all" && priorityState(movieAfter) === "low", "folder should follow its files");

const samePath = fileTree([
    file({index: 4, name: "notes.txt", size: 8, have: 8, wanted: false, priority: 0}),
    file({index: 9, name: "notes.txt", size: 3, have: 1, wanted: true, priority: 1}),
]);
assert(samePath.length === 1 && samePath[0].index === 9 && samePath[0].size === 3 && priorityState(samePath[0]) === "high", "later path wins");

const ordered = fileTree([
    file({index: 0, name: "z/a.txt", priority: -1}),
    file({index: 1, name: "a.txt", priority: 1}),
    file({index: 2, name: "m.txt", priority: 0}),
]);
sortFileNodes(ordered, null, "asc");
assert(ordered.map((node) => node.name).join(",") === "z,a.txt,m.txt", `default order ${ordered.map((node) => node.name).join(",")}`);
sortFileNodes(ordered, "priority", "desc");
assert(ordered.map((node) => node.name).join(",") === "a.txt,m.txt,z", `priority order ${ordered.map((node) => node.name).join(",")}`);
sortFileNodes(ordered, "name", "desc");
assert(ordered[0].name === "z", `name order keeps folders first, got ${ordered.map((node) => node.name).join(",")}`);

const untouched = applyFileUpdate(files, {indices: []});
assert(untouched !== files && untouched[0] === files[0], "empty update copies the list and keeps each file");
assert(untouched[0].priority === 1 && untouched[1].wanted === false, "empty update keeps values");

console.log("file tests passed");
