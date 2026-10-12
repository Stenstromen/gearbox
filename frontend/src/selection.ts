export type SelectionModifiers = {
    toggle: boolean;
    range: boolean;
};

/** Selection captured when a shift-range starts, so a later shift-click can move the endpoint. */
type RangeGesture = {
    ids: ReadonlySet<number>;
    additive: boolean;
};

export type RowSelection = {
    selectedIds: ReadonlySet<number>;
    cursorId: number | null;
    anchorId: number | null;
    rangeGesture: RangeGesture | null;
};

export function emptySelection(): RowSelection {
    return {
        selectedIds: new Set(),
        cursorId: null,
        anchorId: null,
        rangeGesture: null,
    };
}

export function selectionFromClick(
    current: RowSelection,
    visibleIds: readonly number[],
    id: number,
    modifiers: SelectionModifiers,
): RowSelection {
    if (modifiers.range) {
        return rangeSelect(current, visibleIds, id, modifiers.toggle);
    }
    if (modifiers.toggle) {
        return toggleSelect(current, visibleIds, id);
    }
    return activateSelect(current, id);
}

export function selectionFromArrow(
    current: RowSelection,
    visibleIds: readonly number[],
    delta: number,
    extend: boolean,
): RowSelection {
    if (visibleIds.length === 0 || delta === 0) {
        return current;
    }
    const index = current.cursorId === null ? -1 : visibleIds.indexOf(current.cursorId);
    const origin = index === -1 ? (delta > 0 ? -1 : visibleIds.length) : index;
    const nextIndex = Math.min(visibleIds.length - 1, Math.max(0, origin + delta));
    const nextId = visibleIds[nextIndex];
    if (nextId === undefined) {
        return current;
    }
    if (index === -1 || !extend) {
        if (nextId === current.cursorId && current.selectedIds.size === 1 && current.selectedIds.has(nextId)) {
            return current;
        }
        return singleSelect(nextId);
    }
    if (nextIndex === index) {
        return current;
    }
    return rangeSelect(current, visibleIds, nextId, false);
}

export function selectionFromSelectAll(current: RowSelection, visibleIds: readonly number[]): RowSelection {
    const first = visibleIds[0];
    if (first === undefined) {
        return current;
    }
    const cursorId = current.cursorId !== null && visibleIds.includes(current.cursorId) ? current.cursorId : first;
    const anchorId = current.anchorId !== null && visibleIds.includes(current.anchorId) ? current.anchorId : cursorId;
    return {
        selectedIds: new Set(visibleIds),
        cursorId,
        anchorId,
        rangeGesture: null,
    };
}

export function selectionFromContext(current: RowSelection, id: number): RowSelection {
    if (current.selectedIds.has(id)) {
        if (current.cursorId === id && current.rangeGesture === null) {
            return current;
        }
        return {
            selectedIds: current.selectedIds,
            cursorId: id,
            anchorId: current.anchorId,
            rangeGesture: null,
        };
    }
    return singleSelect(id);
}

export function sameIds(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
    if (left.size !== right.size) {
        return false;
    }
    for (const id of left) {
        if (!right.has(id)) {
            return false;
        }
    }
    return true;
}

function singleSelect(id: number): RowSelection {
    return {
        selectedIds: new Set([id]),
        cursorId: id,
        anchorId: id,
        rangeGesture: null,
    };
}

function activateSelect(current: RowSelection, id: number): RowSelection {
    if (current.cursorId === id && current.selectedIds.size === 1 && current.selectedIds.has(id)) {
        return emptySelection();
    }
    return singleSelect(id);
}

function toggleSelect(current: RowSelection, visibleIds: readonly number[], id: number): RowSelection {
    const selectedIds = new Set(current.selectedIds);
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    if (selectedIds.size === 0) {
        return emptySelection();
    }
    const cursorId = selectedIds.has(id)
        ? id
        : current.cursorId !== null && selectedIds.has(current.cursorId)
            ? current.cursorId
            : nearestSelected(selectedIds, visibleIds, id);
    return {
        selectedIds,
        cursorId,
        anchorId: id,
        rangeGesture: null,
    };
}

function rangeSelect(current: RowSelection, visibleIds: readonly number[], id: number, additive: boolean): RowSelection {
    if (!visibleIds.includes(id)) {
        return singleSelect(id);
    }
    const anchorId = resolveAnchor(current, visibleIds, id);
    const startIndex = visibleIds.indexOf(anchorId);
    const endIndex = visibleIds.indexOf(id);
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const continueGesture = current.rangeGesture !== null && current.rangeGesture.additive === additive;
    const base = continueGesture && current.rangeGesture ? current.rangeGesture.ids : current.selectedIds;
    const selectedIds = additive ? new Set(base) : new Set<number>();
    for (let index = start; index <= end; index++) {
        const rangeId = visibleIds[index];
        if (rangeId !== undefined) {
            selectedIds.add(rangeId);
        }
    }
    return {
        selectedIds,
        cursorId: id,
        anchorId,
        rangeGesture: {
            ids: continueGesture && current.rangeGesture ? current.rangeGesture.ids : new Set(current.selectedIds),
            additive,
        },
    };
}

function resolveAnchor(current: RowSelection, visibleIds: readonly number[], clickedId: number): number {
    if (current.anchorId !== null && visibleIds.includes(current.anchorId)) {
        return current.anchorId;
    }
    if (current.cursorId !== null && visibleIds.includes(current.cursorId)) {
        return current.cursorId;
    }
    return clickedId;
}

function nearestSelected(selectedIds: ReadonlySet<number>, visibleIds: readonly number[], clickedId: number): number {
    const origin = visibleIds.indexOf(clickedId);
    let bestId: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < visibleIds.length; index++) {
        const id = visibleIds[index];
        if (id === undefined || !selectedIds.has(id)) {
            continue;
        }
        const distance = origin === -1 ? 0 : Math.abs(index - origin);
        if (distance < bestDistance) {
            bestId = id;
            bestDistance = distance;
        }
    }
    if (bestId !== null) {
        return bestId;
    }
    return selectedIds.values().next().value ?? clickedId;
}
