import {TransmissionService} from "../../bindings/github.com/stenstromen/gearbox";
import {formatBytes} from "../format";

const maxTorrentBytes = 8 * 1024 * 1024;

export function openAddDialog(onAdded: () => void): void {
    if (document.querySelector(".modal-backdrop")) {
        return;
    }
    const previous = document.activeElement;
    let locationGeneration = 0;
    let pathEdited = false;
    let submitting = false;
    let closed = false;
    let spaceTimer = 0;
    const files: File[] = [];

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const dialog = document.createElement("form");
    dialog.className = "modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "add-torrent-title");

    const title = document.createElement("h2");
    title.id = "add-torrent-title";
    title.textContent = "Add Torrents";

    const filePrompt = document.createElement("p");
    filePrompt.className = "modal-prompt";
    filePrompt.textContent = "Please select torrent files to add:";

    const fileRow = document.createElement("div");
    fileRow.className = "modal-file";
    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "modal-browse";
    browse.textContent = "Browse…";
    const fileLabel = document.createElement("span");
    fileLabel.textContent = "No files selected.";
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.accept = ".torrent,application/x-bittorrent";
    picker.hidden = true;
    fileRow.append(browse, fileLabel, picker);

    const urlLabel = document.createElement("label");
    urlLabel.className = "modal-field";
    urlLabel.textContent = "Or enter a URL:";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.spellcheck = false;
    urlInput.autocomplete = "off";
    urlInput.placeholder = "magnet:?xt=urn:btih:… or https://…";
    urlInput.setAttribute("aria-label", "Torrent URL or magnet link");
    urlLabel.append(urlInput);

    const destination = document.createElement("p");
    destination.className = "modal-destination";
    destination.textContent = "Destination folder";
    const directoryInput = document.createElement("input");
    directoryInput.type = "text";
    directoryInput.spellcheck = false;
    directoryInput.autocomplete = "off";
    directoryInput.setAttribute("aria-label", "Destination folder");

    const startLabel = document.createElement("label");
    startLabel.className = "modal-check";
    const startInput = document.createElement("input");
    startInput.type = "checkbox";
    startInput.checked = true;
    const startText = document.createElement("span");
    startText.textContent = "Start when added";
    startLabel.append(startInput, startText);

    const error = document.createElement("p");
    error.className = "modal-error";
    error.hidden = true;

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "modal-button";
    cancel.textContent = "Cancel";
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "modal-button modal-primary";
    add.textContent = "Add";
    actions.append(cancel, add);

    dialog.append(title, filePrompt, fileRow, urlLabel, destination, directoryInput, startLabel, error, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        window.clearTimeout(spaceTimer);
        locationGeneration++;
        backdrop.remove();
        if (previous instanceof HTMLElement) {
            previous.focus();
        }
    };

    const showError = (message: string) => {
        error.hidden = false;
        error.textContent = message;
    };

    const refreshSpace = (path: string) => {
        const generation = ++locationGeneration;
        void TransmissionService.DownloadLocation(path).then((location) => {
            if (generation !== locationGeneration || !backdrop.isConnected) {
                return;
            }
            if (!pathEdited) {
                directoryInput.value = location.path;
            }
            destination.textContent = location.freeBytes < 0
                ? "Destination folder"
                : `Destination folder: ${formatBytes(location.freeBytes)} Free`;
        }).catch(() => {
            if (generation === locationGeneration && backdrop.isConnected) {
                destination.textContent = "Destination folder";
            }
        });
    };

    browse.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
        files.splice(0, files.length, ...Array.from(picker.files ?? []));
        if (files.length === 0) {
            fileLabel.textContent = "No files selected.";
        } else if (files.length === 1) {
            fileLabel.textContent = files[0].name;
        } else {
            fileLabel.textContent = `${files.length} files selected.`;
        }
        error.hidden = true;
    });

    directoryInput.addEventListener("input", () => {
        pathEdited = true;
        window.clearTimeout(spaceTimer);
        const path = directoryInput.value.trim();
        if (path === "") {
            destination.textContent = "Destination folder";
            return;
        }
        spaceTimer = window.setTimeout(() => refreshSpace(path), 400);
    });

    cancel.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
            close();
        }
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    });

    dialog.addEventListener("submit", (event) => {
        event.preventDefault();
        if (submitting) {
            return;
        }
        const link = urlInput.value.trim();
        if (files.length === 0 && link === "") {
            showError("Choose a torrent file or enter a URL.");
            return;
        }
        if (link !== "" && !validTorrentURL(link)) {
            showError("Enter a magnet link or an http(s) URL.");
            return;
        }
        const oversized = files.find((file) => file.size > maxTorrentBytes);
        if (oversized) {
            showError(`${oversized.name} is too large to add.`);
            return;
        }
        submitting = true;
        add.disabled = true;
        browse.disabled = true;
        add.textContent = "Adding…";
        error.hidden = true;
        void submitAdd(files, link, directoryInput.value.trim(), startInput.checked).then(() => {
            if (!closed) {
                close();
            }
            onAdded();
        }).catch((err: unknown) => {
            if (closed) {
                return;
            }
            submitting = false;
            add.disabled = false;
            browse.disabled = false;
            add.textContent = "Add";
            showError(dialogError(err));
        });
    });

    urlInput.focus();
    refreshSpace("");
}

export function openRemoveDialog(name: string, count = 1, deleteData?: boolean): Promise<boolean | null> {
    if (document.querySelector(".modal-backdrop")) {
        return Promise.resolve(null);
    }
    const previous = document.activeElement;
    return new Promise((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        const dialog = document.createElement("div");
        dialog.className = "modal";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "remove-torrent-title");

        const title = document.createElement("h2");
        title.id = "remove-torrent-title";
        title.textContent = count === 1 ? "Remove torrent" : "Remove torrents";
        const prompt = document.createElement("p");
        prompt.className = "modal-prompt";
        prompt.textContent = removePrompt(name, count, deleteData);

        const dataLabel = document.createElement("label");
        dataLabel.className = "modal-check";
        const dataInput = document.createElement("input");
        dataInput.type = "checkbox";
        const dataText = document.createElement("span");
        dataText.textContent = "Delete downloaded files";
        dataLabel.append(dataInput, dataText);
        dataLabel.hidden = deleteData !== undefined;

        const actions = document.createElement("div");
        actions.className = "modal-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "modal-button";
        cancel.textContent = "Cancel";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "modal-button modal-danger";
        remove.textContent = deleteData ? "Trash" : "Remove";
        actions.append(cancel, remove);
        dialog.append(title, prompt, dataLabel, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);

        const finish = (deleteData: boolean | null) => {
            backdrop.remove();
            if (previous instanceof HTMLElement) {
                previous.focus();
            }
            resolve(deleteData);
        };
        cancel.addEventListener("click", () => finish(null));
        remove.addEventListener("click", () => finish(deleteData ?? dataInput.checked));
        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop) {
                finish(null);
            }
        });
        dialog.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(null);
            }
        });
        cancel.focus();
    });
}

function removePrompt(name: string, count: number, deleteData?: boolean): string {
    if (deleteData) {
        return count === 1
            ? `Trash the downloaded files for “${name}” and remove it from Transmission?`
            : `Trash the downloaded files for ${count} torrents and remove them from Transmission?`;
    }
    return count === 1 ? `Remove “${name}” from Transmission?` : `Remove ${count} torrents from Transmission?`;
}

async function submitAdd(files: readonly File[], link: string, directory: string, start: boolean): Promise<void> {
    const metainfo: string[] = [];
    for (const file of files) {
        metainfo.push(await readMetainfo(file));
    }
    await TransmissionService.AddTorrent({
        metainfo,
        url: link,
        directory,
        start,
    });
}

function readMetainfo(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
        reader.readAsDataURL(file);
    });
}

function validTorrentURL(value: string): boolean {
    const lower = value.toLowerCase();
    if (lower.startsWith("magnet:?")) {
        return lower.includes("xt=urn:btih:") || lower.includes("xt=urn:btmh:");
    }
    try {
        const parsed = new URL(value);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "";
    } catch {
        return false;
    }
}

function dialogError(err: unknown): string {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    if (typeof err === "string" && err) {
        return err;
    }
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message) {
        return err.message;
    }
    return "Could not add the torrent";
}
