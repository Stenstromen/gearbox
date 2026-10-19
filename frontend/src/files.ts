import type {TorrentFile} from "../bindings/github.com/stenstromen/gearbox";

export type FilePriority = "low" | "normal" | "high";

export type FileUpdate = {
    indices: readonly number[];
    wanted?: boolean;
    priority?: FilePriority;
};

export type WantedState = "all" | "none" | "mixed";

export type PriorityState = FilePriority | "mixed";

export type FileNode = {
    name: string;
    size: number;
    have: number;
    index: number | null;
    children: FileNode[];
    fileCount: number;
    wantedCount: number;
    low: number;
    normal: number;
    high: number;
};

export type FileSortKey = "name" | "priority" | "size" | "downloaded" | "percent";

const priorityCode: Record<FilePriority, number> = {
    low: -1,
    normal: 0,
    high: 1,
};

export function fileTree(files: readonly TorrentFile[]): FileNode[] {
    const roots: FileNode[] = [];
    const byPath = new Map<string, FileNode>();
    const ensureFolder = (parts: readonly string[]): FileNode[] => {
        let list = roots;
        let key = "";
        for (const part of parts) {
            key = key ? `${key}/${part}` : part;
            let folder = byPath.get(key);
            if (!folder) {
                folder = emptyNode(part);
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
            applyLeaf(existing, file);
            continue;
        }
        const leaf = emptyNode(parts[parts.length - 1]);
        applyLeaf(leaf, file);
        byPath.set(key, leaf);
        parent.push(leaf);
    }
    rollupFiles(roots);
    return roots;
}

export function fileIndices(node: FileNode): number[] {
    const indices: number[] = [];
    collectIndices(node, indices);
    return indices;
}

export function fileSummary(nodes: readonly FileNode[]): Pick<FileNode, "fileCount" | "wantedCount" | "low" | "normal" | "high"> {
    const summary = {fileCount: 0, wantedCount: 0, low: 0, normal: 0, high: 0};
    for (const node of nodes) {
        summary.fileCount += node.fileCount;
        summary.wantedCount += node.wantedCount;
        summary.low += node.low;
        summary.normal += node.normal;
        summary.high += node.high;
    }
    return summary;
}

export function wantedState(node: Pick<FileNode, "fileCount" | "wantedCount">): WantedState {
    if (node.fileCount === 0 || node.wantedCount === node.fileCount) {
        return "all";
    }
    if (node.wantedCount === 0) {
        return "none";
    }
    return "mixed";
}

export function priorityState(node: Pick<FileNode, "fileCount" | "low" | "normal" | "high">): PriorityState {
    if (node.fileCount > 0 && node.low === node.fileCount) {
        return "low";
    }
    if (node.fileCount > 0 && node.high === node.fileCount) {
        return "high";
    }
    if (node.fileCount === 0 || node.normal === node.fileCount) {
        return "normal";
    }
    return "mixed";
}

export function applyFileUpdate(files: readonly TorrentFile[], update: FileUpdate): TorrentFile[] {
    const chosen = new Set(update.indices);
    if (chosen.size === 0) {
        return [...files];
    }
    return files.map((file) => {
        if (!chosen.has(file.index)) {
            return file;
        }
        return {
            ...file,
            wanted: update.wanted === undefined ? file.wanted : update.wanted,
            priority: update.priority === undefined ? file.priority : priorityCode[update.priority],
        };
    });
}

export function sortFileNodes(nodes: FileNode[], key: FileSortKey | null, direction: "asc" | "desc"): void {
    nodes.sort((a, b) => compareFileNodes(a, b, key, direction));
    for (const node of nodes) {
        sortFileNodes(node.children, key, direction);
    }
}

function emptyNode(name: string): FileNode {
    return {
        name,
        size: 0,
        have: 0,
        index: null,
        children: [],
        fileCount: 0,
        wantedCount: 0,
        low: 0,
        normal: 0,
        high: 0,
    };
}

function applyLeaf(node: FileNode, file: TorrentFile): void {
    node.size = file.size;
    node.have = file.have;
    node.index = file.index;
    node.fileCount = 1;
    node.wantedCount = file.wanted ? 1 : 0;
    node.low = file.priority < 0 ? 1 : 0;
    node.normal = file.priority === 0 ? 1 : 0;
    node.high = file.priority > 0 ? 1 : 0;
}

function rollupFiles(nodes: FileNode[]): void {
    for (const node of nodes) {
        if (node.children.length === 0) {
            continue;
        }
        rollupFiles(node.children);
        for (const child of node.children) {
            node.size += child.size;
            node.have += child.have;
            node.fileCount += child.fileCount;
            node.wantedCount += child.wantedCount;
            node.low += child.low;
            node.normal += child.normal;
            node.high += child.high;
        }
    }
}

function collectIndices(node: FileNode, indices: number[]): void {
    if (node.index !== null) {
        indices.push(node.index);
    }
    for (const child of node.children) {
        collectIndices(child, indices);
    }
}

function compareFileNodes(a: FileNode, b: FileNode, key: FileSortKey | null, direction: "asc" | "desc"): number {
    const folderDelta = Number(b.children.length > 0) - Number(a.children.length > 0);
    if (key === null || key === "name") {
        if (folderDelta !== 0) {
            return folderDelta;
        }
        return compareText(a.name, b.name, key === null ? "asc" : direction);
    }
    const primary = key === "size"
        ? compareNumber(a.size, b.size, direction)
        : key === "downloaded"
            ? compareNumber(a.have, b.have, direction)
            : key === "priority"
                ? compareNumber(priorityRank(a), priorityRank(b), direction)
                : compareNumber(fileFraction(a), fileFraction(b), direction);
    if (primary !== 0) {
        return primary;
    }
    if (folderDelta !== 0) {
        return folderDelta;
    }
    return compareText(a.name, b.name);
}

function priorityRank(node: FileNode): number {
    if (node.fileCount === 0) {
        return 0;
    }
    return (node.high - node.low) / node.fileCount;
}

function fileFraction(node: FileNode): number {
    return node.size > 0 ? node.have / node.size : 0;
}

function compareText(a: string, b: string, direction: "asc" | "desc" = "asc"): number {
    const diff = a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"});
    return direction === "asc" ? diff : -diff;
}

function compareNumber(a: number, b: number, direction: "asc" | "desc"): number {
    const diff = a - b;
    return direction === "asc" ? diff : -diff;
}
