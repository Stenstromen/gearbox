import {Events} from "@wailsio/runtime";
import {TransmissionService, type Torrent, type TorrentInfo} from "../../bindings/github.com/stenstromen/gearbox";
import {formatRate} from "../format";
import {decodeSort, filterByName, filterByStatus, isStoppedStatus, sortTorrents, type SortKey, type StatusFilter} from "../sort";
import {openAddDialog, openRemoveDialog} from "./add-dialog";
import {openContextMenu} from "./context-menu";
import {createPreferencesPanel} from "./preferences";
import {fillTorrentInfo, renderInspector, type InspectorTab} from "./inspector";
import {createSortField} from "./sort-menu";
import {createStatusField} from "./status-menu";
import {renderTorrentList} from "./torrent-list";

let refreshMs = 5000;

export function mountApp(root: HTMLElement): void {
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "filter";
    nameInput.placeholder = "Filter by name";
    nameInput.setAttribute("aria-label", "Filter by name");
    nameInput.autocomplete = "off";
    nameInput.spellcheck = false;
    const statusField = createStatusField((next) => {
        statusFilter = next;
        if (loaded) {
            paint();
        }
    });
    const sortField = createSortField((stored) => {
        const parsed = decodeSort(stored);
        if (!parsed) {
            return;
        }
        sortTouched = true;
        sortKey = parsed.key;
        sortReversed = parsed.reversed;
        void TransmissionService.SetSort(stored).catch((err: unknown) => {
            notice.hidden = false;
            notice.textContent = errorMessage(err);
        });
        if (loaded) {
            paint();
        }
    });
    const totals = document.createElement("div");
    totals.className = "totals";
    const downTotal = document.createElement("span");
    downTotal.className = "total total-down";
    const upTotal = document.createElement("span");
    upTotal.className = "total total-up";
    totals.append(downTotal, upTotal);
    const preferencesButton = actionButton("Preferences", gearIcon());
    const toolbarEnd = document.createElement("div");
    toolbarEnd.className = "toolbar-end";
    toolbarEnd.append(preferencesButton, totals);
    const openButton = actionButton("Open", folderIcon());
    const deleteButton = actionButton("Delete", trashIcon());
    const startButton = actionButton("Start", playIcon());
    const stopButton = actionButton("Stop", pauseIcon());
    deleteButton.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = true;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.setAttribute("role", "toolbar");
    actions.setAttribute("aria-label", "Torrent actions");
    const divider = document.createElement("span");
    divider.className = "action-divider";
    divider.setAttribute("aria-hidden", "true");
    actions.append(openButton, deleteButton, divider, startButton, stopButton);
    const filters = document.createElement("div");
    filters.className = "toolbar-filters";
    filters.append(nameInput, statusField.element, sortField.element);
    toolbar.append(actions, filters, toolbarEnd);

    const notice = document.createElement("p");
    notice.className = "notice";
    notice.hidden = true;
    notice.setAttribute("role", "status");

    const list = document.createElement("div");
    list.className = "list";

    const inspector = document.createElement("section");
    inspector.className = "inspector";
    inspector.hidden = true;
    inspector.setAttribute("aria-label", "Selected torrent");
    const inspectorResize = document.createElement("div");
    inspectorResize.className = "inspector-resize";
    inspectorResize.tabIndex = 0;
    inspectorResize.setAttribute("role", "separator");
    inspectorResize.setAttribute("aria-orientation", "horizontal");
    inspectorResize.setAttribute("aria-label", "Resize details");
    const inspectorContent = document.createElement("div");
    inspectorContent.className = "inspector-content";
    inspector.append(inspectorResize, inspectorContent);

    let preferencesOpen = false;
    const preferences = createPreferencesPanel(() => {
        preferencesOpen = false;
        list.hidden = false;
        paint();
    }, (refreshSeconds) => {
        refreshMs = refreshSeconds * 1000;
        armRefresh();
        preferencesOpen = false;
        list.hidden = false;
        paint();
        void load();
    });
    root.append(toolbar, notice, preferences.element, list, inspector);
    const openPreferences = () => {
        if (document.querySelector(".modal-backdrop")) {
            return;
        }
        if (preferencesOpen) {
            preferences.close();
            return;
        }
        preferencesOpen = true;
        list.hidden = true;
        preferences.open();
        paint();
    };
    preferencesButton.addEventListener("click", openPreferences);

    const inspectorMinHeight = 140;
    let inspectorHeight = 320;

    const inspectorMaxHeight = () => {
        const noticeHeight = notice.hidden ? 0 : notice.offsetHeight;
        const reserved = toolbar.offsetHeight + noticeHeight + 120;
        return Math.max(inspectorMinHeight, root.clientHeight - reserved);
    };

    const applyInspectorHeight = (value: number) => {
        inspectorHeight = Math.min(inspectorMaxHeight(), Math.max(inspectorMinHeight, value));
        inspector.style.height = `${inspectorHeight}px`;
        inspectorResize.setAttribute("aria-valuemin", String(inspectorMinHeight));
        inspectorResize.setAttribute("aria-valuemax", String(Math.round(inspectorMaxHeight())));
        inspectorResize.setAttribute("aria-valuenow", String(Math.round(inspectorHeight)));
    };
    applyInspectorHeight(inspectorHeight);

    inspectorResize.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = inspector.getBoundingClientRect().height;
        inspectorResize.classList.add("is-dragging");
        document.body.classList.add("is-resizing");
        inspectorResize.setPointerCapture(event.pointerId);
        const move = (ev: PointerEvent) => {
            applyInspectorHeight(startHeight + (startY - ev.clientY));
        };
        const end = () => {
            inspectorResize.classList.remove("is-dragging");
            document.body.classList.remove("is-resizing");
            inspectorResize.removeEventListener("pointermove", move);
            inspectorResize.removeEventListener("pointerup", end);
            inspectorResize.removeEventListener("pointercancel", end);
        };
        inspectorResize.addEventListener("pointermove", move);
        inspectorResize.addEventListener("pointerup", end);
        inspectorResize.addEventListener("pointercancel", end);
    });

    inspectorResize.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") {
            event.preventDefault();
            applyInspectorHeight(inspectorHeight + 24);
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            applyInspectorHeight(inspectorHeight - 24);
        }
    });

    window.addEventListener("resize", () => applyInspectorHeight(inspectorHeight));

    let inFlight = false;
    let reloadQueued = false;
    let acting = false;
    let loaded = false;
    let timer = 0;
    let sortKey: SortKey = "name";
    let sortReversed = false;
    let sortTouched = false;
    let statusFilter: StatusFilter = "all";
    let nameQuery = "";
    let torrents: Torrent[] = [];
    let selectedIds = new Set<number>();
    let cursorId: number | null = null;
    let inspectorOpen = false;
    let inspectorTab: InspectorTab = "info";
    let torrentInfo: TorrentInfo | null = null;
    let inspectorError = "";
    let inspectorLoading = false;
    let inspectorGeneration = 0;

    const visibleTorrents = () => sortTorrents(filterByStatus(filterByName(torrents, nameQuery), statusFilter), sortKey, sortReversed);

    const selectedTorrents = () => torrents.filter((torrent) => selectedIds.has(torrent.id));

    const paint = () => {
        const visible = visibleTorrents();
        const narrowed = nameQuery.trim() !== "" || statusFilter !== "all";
        renderTorrentList(list, visible, narrowed ? "No matching torrents" : "No torrents", {
            selectedIds,
            cursorId,
            onSelect: selectTorrent,
            onContextMenu: openRowMenu,
        });
        showTotals(torrents);
        const chosen = selectedTorrents();
        const ready = chosen.length > 0 && !acting;
        deleteButton.disabled = !ready;
        startButton.disabled = !ready || !chosen.some((torrent) => isStoppedStatus(torrent.status));
        stopButton.disabled = !ready || !chosen.some((torrent) => !isStoppedStatus(torrent.status));
        openButton.disabled = acting;
        paintInspector(inspectorContent.querySelector(".inspector-columns") !== null);
        if (inspectorOpen && cursorId !== null) {
            applyInspectorHeight(inspectorHeight);
        }
    };

    const paintInspector = (updateValues: boolean) => {
        if (preferencesOpen) {
            inspector.hidden = true;
            return;
        }
        inspector.hidden = !inspectorOpen || cursorId === null;
        if (!inspectorOpen || cursorId === null) {
            inspectorContent.replaceChildren();
            return;
        }
        if (updateValues && torrentInfo && inspectorContent.querySelector(".inspector-columns")) {
            fillTorrentInfo(inspectorContent, torrentInfo);
            return;
        }
        const scroll = updateValues ? inspectorContent.querySelector(".inspector-body")?.scrollTop ?? 0 : 0;
        renderInspector(inspectorContent, {
            tab: inspectorTab,
            loading: inspectorLoading,
            error: inspectorError,
            info: torrentInfo,
        }, (tab) => {
            inspectorTab = tab;
            paintInspector(false);
        }, closeInspector);
        if (scroll > 0) {
            const body = inspectorContent.querySelector(".inspector-body");
            if (body) {
                body.scrollTop = scroll;
            }
        }
    };

    const scrollCursor = () => {
        if (cursorId === null) {
            return;
        }
        list.querySelector(`tr[data-id="${cursorId}"]`)?.scrollIntoView({block: "nearest"});
    };

    const clearSelection = () => {
        selectedIds = new Set();
        cursorId = null;
        inspectorOpen = false;
        torrentInfo = null;
        inspectorError = "";
        inspectorLoading = false;
        inspectorGeneration++;
        paint();
    };

    const showInspector = (id: number) => {
        inspectorOpen = true;
        if (torrentInfo?.id === id) {
            paint();
            return;
        }
        torrentInfo = null;
        inspectorError = "";
        inspectorLoading = true;
        paint();
        void loadInspector(id);
    };

    const closeInspector = () => {
        clearSelection();
    };

    const selectTorrent = (id: number) => {
        if (cursorId === id && selectedIds.size === 1 && selectedIds.has(id)) {
            clearSelection();
            return;
        }
        selectedIds = new Set([id]);
        cursorId = id;
        showInspector(id);
    };

    const moveCursor = (delta: number) => {
        const rows = visibleTorrents();
        if (rows.length === 0) {
            return;
        }
        const index = cursorId === null ? -1 : rows.findIndex((torrent) => torrent.id === cursorId);
        const start = index === -1 ? (delta > 0 ? -1 : rows.length) : index;
        const next = rows[Math.min(rows.length - 1, Math.max(0, start + delta))];
        if (!next || (next.id === cursorId && selectedIds.size === 1 && selectedIds.has(next.id))) {
            scrollCursor();
            return;
        }
        selectedIds = new Set([next.id]);
        const changed = cursorId !== next.id;
        cursorId = next.id;
        if (inspectorOpen && changed) {
            showInspector(next.id);
        } else {
            paint();
        }
        scrollCursor();
    };

    const selectAll = () => {
        const rows = visibleTorrents();
        if (rows.length === 0) {
            return;
        }
        selectedIds = new Set(rows.map((torrent) => torrent.id));
        if (cursorId === null || !selectedIds.has(cursorId)) {
            cursorId = rows[0].id;
        }
        paint();
    };

    const toggleInspector = () => {
        if (inspectorOpen) {
            inspectorOpen = false;
            paint();
            return;
        }
        if (cursorId === null) {
            return;
        }
        showInspector(cursorId);
    };

    const loadInspector = async (id: number) => {
        const generation = ++inspectorGeneration;
        const hadInfo = torrentInfo !== null && torrentInfo.id === id;
        try {
            const next = await TransmissionService.GetTorrent(id);
            if (generation !== inspectorGeneration || cursorId !== id || !inspectorOpen) {
                return;
            }
            if (!next) {
                if (!hadInfo) {
                    inspectorError = "Torrent was not found";
                }
                return;
            }
            torrentInfo = next;
            inspectorError = "";
            paintInspector(hadInfo);
        } catch (err) {
            if (generation !== inspectorGeneration || cursorId !== id || !inspectorOpen) {
                return;
            }
            if (!hadInfo) {
                torrentInfo = null;
                inspectorError = errorMessage(err);
                paintInspector(false);
            }
        } finally {
            if (generation === inspectorGeneration && cursorId === id && inspectorOpen) {
                inspectorLoading = false;
                if (!torrentInfo || inspectorError) {
                    paintInspector(false);
                }
            }
        }
    };

    const showTotals = (items: readonly Torrent[]) => {
        const down = items.reduce((sum, torrent) => sum + torrent.rateDownload, 0);
        const up = items.reduce((sum, torrent) => sum + torrent.rateUpload, 0);
        downTotal.textContent = `Down ${formatRate(down)}`;
        upTotal.textContent = `Up ${formatRate(up)}`;
    };
    showTotals([]);

    nameInput.addEventListener("input", () => {
        nameQuery = nameInput.value;
        if (loaded) {
            paint();
        }
    });

    const load = async () => {
        if (inFlight) {
            reloadQueued = true;
            return;
        }
        inFlight = true;
        try {
            torrents = (await TransmissionService.ListTorrents()) ?? [];
            loaded = true;
            notice.hidden = true;
            notice.textContent = "";
            for (const id of Array.from(selectedIds)) {
                if (!torrents.some((torrent) => torrent.id === id)) {
                    selectedIds.delete(id);
                }
            }
            if (cursorId !== null && !torrents.some((torrent) => torrent.id === cursorId)) {
                cursorId = selectedIds.values().next().value ?? null;
                torrentInfo = null;
                if (cursorId === null) {
                    inspectorOpen = false;
                    inspectorError = "";
                    inspectorLoading = false;
                    inspectorGeneration++;
                }
            }
            paint();
            if (inspectorOpen && cursorId !== null) {
                void loadInspector(cursorId);
            }
        } catch (err) {
            notice.hidden = false;
            notice.textContent = errorMessage(err);
            if (!loaded) {
                list.replaceChildren();
            }
        } finally {
            inFlight = false;
            if (reloadQueued) {
                reloadQueued = false;
                void load();
            }
        }
    };

    const runAction = async (work: () => Promise<void>) => {
        if (acting || selectedIds.size === 0) {
            return;
        }
        acting = true;
        paint();
        try {
            await work();
            notice.hidden = true;
            await load();
        } catch (err) {
            notice.hidden = false;
            notice.textContent = errorMessage(err);
        } finally {
            acting = false;
            paint();
        }
    };

    openButton.addEventListener("click", () => {
        openAddDialog(() => {
            void load();
        });
    });
    const removeSelected = () => {
        const chosen = selectedTorrents();
        if (chosen.length === 0 || acting) {
            return;
        }
        const ids = chosen.map((torrent) => torrent.id);
        void openRemoveDialog(chosen[0].name || "this torrent", chosen.length).then((deleteData) => {
            if (deleteData === null) {
                return;
            }
            void runAction(async () => {
                for (const id of ids) {
                    await TransmissionService.RemoveTorrent(id, deleteData);
                }
            });
        });
    };
    const startSelected = () => {
        const ids = selectedTorrents().filter((torrent) => isStoppedStatus(torrent.status)).map((torrent) => torrent.id);
        if (ids.length === 0) {
            return;
        }
        void runAction(async () => {
            for (const id of ids) {
                await TransmissionService.StartTorrent(id);
            }
        });
    };
    const stopSelected = () => {
        const ids = selectedTorrents().filter((torrent) => !isStoppedStatus(torrent.status)).map((torrent) => torrent.id);
        if (ids.length === 0) {
            return;
        }
        void runAction(async () => {
            for (const id of ids) {
                await TransmissionService.StopTorrent(id);
            }
        });
    };
    const removeSelectedData = (deleteData: boolean) => {
        const chosen = selectedTorrents();
        if (chosen.length === 0 || acting) {
            return;
        }
        const ids = chosen.map((torrent) => torrent.id);
        void openRemoveDialog(chosen[0].name || "this torrent", chosen.length, deleteData).then((confirmed) => {
            if (confirmed === null) {
                return;
            }
            void runAction(async () => {
                for (const id of ids) {
                    await TransmissionService.RemoveTorrent(id, confirmed);
                }
            });
        });
    };
    function openRowMenu(id: number, x: number, y: number): void {
        if (preferencesOpen || document.querySelector(".modal-backdrop")) {
            return;
        }
        if (!selectedIds.has(id)) {
            selectedIds = new Set([id]);
            const changed = cursorId !== id;
            cursorId = id;
            if (inspectorOpen && changed) {
                showInspector(id);
            } else {
                paint();
            }
        } else if (cursorId !== id) {
            cursorId = id;
            paint();
        }
        const chosen = selectedTorrents();
        const ready = chosen.length > 0 && !acting;
        openContextMenu(x, y, [
            {label: "Resume", disabled: !ready || !chosen.some((torrent) => isStoppedStatus(torrent.status)), onSelect: startSelected},
            {label: "Pause", disabled: !ready || !chosen.some((torrent) => !isStoppedStatus(torrent.status)), onSelect: stopSelected},
            "separator",
            {label: "Remove from list…", disabled: !ready, onSelect: () => removeSelectedData(false)},
            {label: "Trash data and remove from list…", disabled: !ready, onSelect: () => removeSelectedData(true)},
        ]);
    }
    deleteButton.addEventListener("click", removeSelected);
    startButton.addEventListener("click", startSelected);
    stopButton.addEventListener("click", stopSelected);

    const modalOpen = () => document.querySelector(".modal-backdrop") !== null;
    const torrentCommandsBlocked = () => modalOpen() || preferencesOpen;
    const addTorrents = () => {
        if (torrentCommandsBlocked()) {
            return;
        }
        openAddDialog(() => {
            void load();
        });
    };
    Events.On("gearbox:preferences", openPreferences);
    Events.On("gearbox:add", addTorrents);
    Events.On("gearbox:remove", () => {
        if (!torrentCommandsBlocked()) {
            removeSelected();
        }
    });
    Events.On("gearbox:start", () => {
        if (!torrentCommandsBlocked()) {
            startSelected();
        }
    });
    Events.On("gearbox:stop", () => {
        if (!torrentCommandsBlocked()) {
            stopSelected();
        }
    });
    Events.On("gearbox:select-all", () => {
        if (!torrentCommandsBlocked()) {
            selectAll();
        }
    });
    Events.On("gearbox:deselect", () => {
        if (!torrentCommandsBlocked()) {
            clearSelection();
        }
    });
    Events.On("gearbox:inspector", () => {
        if (!torrentCommandsBlocked()) {
            toggleInspector();
        }
    });
    Events.On("gearbox:refresh", () => {
        if (!modalOpen()) {
            void load();
        }
    });
    const showOpenError = (message: string) => {
        if (!message) {
            return;
        }
        if (preferencesOpen) {
            preferences.close();
        }
        notice.hidden = false;
        notice.textContent = message;
    };
    Events.On("gearbox:opened", () => {
        if (preferencesOpen) {
            preferences.close();
        }
        void load();
    });
    Events.On("gearbox:open-error", (event) => {
        showOpenError(typeof event.data === "string" ? event.data : errorMessage(event.data));
    });
    void TransmissionService.TakeOpenError().then((message) => {
        showOpenError(message);
    }).catch(() => undefined);
    window.addEventListener("keydown", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
            return;
        }
        if (preferencesOpen) {
            if (event.key === "Escape") {
                event.preventDefault();
                preferences.close();
            }
            return;
        }
        if (document.querySelector(".modal-backdrop") || isTypingTarget(event.target) || isResizeHandle(event.target)) {
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveCursor(event.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (event.repeat) {
            return;
        }
        switch (event.key.toLowerCase()) {
            case "a":
                event.preventDefault();
                selectAll();
                break;
            case "d":
                event.preventDefault();
                clearSelection();
                break;
            case "i":
                event.preventDefault();
                toggleInspector();
                break;
            case "o":
                event.preventDefault();
                addTorrents();
                break;
            case "u":
                event.preventDefault();
                stopSelected();
                break;
            case "r":
                event.preventDefault();
                startSelected();
                break;
            default:
                break;
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            void load();
        }
    });

    const armRefresh = () => {
        window.clearInterval(timer);
        timer = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                void load();
            }
        }, refreshMs);
    };
    armRefresh();

    window.addEventListener("beforeunload", () => window.clearInterval(timer));

    void TransmissionService.GetSettings().then((settings) => {
        if (settings && settings.refreshSeconds >= 1) {
            refreshMs = settings.refreshSeconds * 1000;
            armRefresh();
        }
        if (!sortTouched && settings) {
            const parsed = decodeSort(settings.sort);
            if (parsed) {
                sortKey = parsed.key;
                sortReversed = parsed.reversed;
                sortField.setStored(settings.sort);
                if (loaded) {
                    paint();
                }
            }
        }
    }).catch(() => undefined);

    void load();
}

function actionButton(label: string, icon: SVGSVGElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    const caption = document.createElement("span");
    caption.textContent = label;
    button.append(icon, caption);
    return button;
}

function actionIcon(paths: readonly string[]): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.append(path);
    }
    return svg;
}

function gearIcon(): SVGSVGElement {
    return actionIcon([
        "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
        "M12 3.4v2.1M12 18.5v2.1M4.9 6.2l1.5 1.5M17.6 16.3l1.5 1.5M3.4 12h2.1M18.5 12h2.1M4.9 17.8l1.5-1.5M17.6 7.7l1.5-1.5",
    ]);
}

function folderIcon(): SVGSVGElement {
    return actionIcon([
        "M3.5 8.2V18a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 18V9.4a1.5 1.5 0 0 0-1.5-1.5h-7.1L10 5.6H5A1.5 1.5 0 0 0 3.5 7.1V8.2z",
        "M12 11.2v5M9.5 13.7h5",
    ]);
}

function trashIcon(): SVGSVGElement {
    return actionIcon([
        "M5 7.6h14",
        "M9.2 7.5V5.8A1.2 1.2 0 0 1 10.4 4.6h3.2a1.2 1.2 0 0 1 1.2 1.2v1.7",
        "M7.3 7.6l.7 11.1a1.3 1.3 0 0 0 1.3 1.2h5.4a1.3 1.3 0 0 0 1.3-1.2l.7-11.1",
    ]);
}

function playIcon(): SVGSVGElement {
    return actionIcon(["M8 5.4v13.2l11-6.6L8 5.4z"]);
}

function pauseIcon(): SVGSVGElement {
    return actionIcon(["M8 5.2h3.1v13.6H8z", "M12.9 5.2H16v13.6h-3.1z"]);
}

function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, .picker-trigger, .picker-menu") !== null);
}

function isResizeHandle(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".inspector-resize") !== null;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    if (typeof err === "string" && err) {
        return err;
    }
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message) {
        return err.message;
    }
    return "Could not load torrents";
}
