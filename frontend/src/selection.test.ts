import {emptySelection, selectionFromArrow, selectionFromClick, selectionFromContext, selectionFromSelectAll, type RowSelection} from "./selection.ts";

const visible = [1, 2, 3, 4, 5, 6, 7];
const plain = {toggle: false, range: false};
const toggle = {toggle: true, range: false};
const range = {toggle: false, range: true};
const additive = {toggle: true, range: true};

function expectSelection(actual: RowSelection, ids: readonly number[], cursor: number | null, anchor: number | null): void {
    const got = [...actual.selectedIds].sort((left, right) => left - right);
    const want = [...ids].sort((left, right) => left - right);
    if (got.join(",") !== want.join(",") || actual.cursorId !== cursor || actual.anchorId !== anchor) {
        throw new Error(`expected [${want.join(",")}] cursor=${cursor} anchor=${anchor}, got [${got.join(",")}] cursor=${actual.cursorId} anchor=${actual.anchorId}`);
    }
}

let current = selectionFromClick(emptySelection(), visible, 2, plain);
expectSelection(current, [2], 2, 2);

current = selectionFromClick(current, visible, 2, plain);
expectSelection(current, [], null, null);

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromClick(current, visible, 5, toggle);
expectSelection(current, [2, 5], 5, 5);

current = selectionFromClick(current, visible, 5, toggle);
expectSelection(current, [2], 2, 5);

current = selectionFromClick(emptySelection(), visible, 4, plain);
current = selectionFromClick(current, visible, 4, toggle);
expectSelection(current, [], null, null);

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromClick(current, visible, 6, range);
expectSelection(current, [2, 3, 4, 5, 6], 6, 2);
current = selectionFromClick(current, visible, 4, range);
expectSelection(current, [2, 3, 4], 4, 2);
current = selectionFromClick(current, visible, 1, range);
expectSelection(current, [1, 2], 1, 2);

current = selectionFromClick(emptySelection(), visible, 1, plain);
current = selectionFromClick(current, visible, 5, toggle);
current = selectionFromClick(current, visible, 7, range);
expectSelection(current, [5, 6, 7], 7, 5);

current = selectionFromClick(emptySelection(), visible, 1, plain);
current = selectionFromClick(current, visible, 5, toggle);
current = selectionFromClick(current, visible, 7, additive);
expectSelection(current, [1, 5, 6, 7], 7, 5);
current = selectionFromClick(current, visible, 6, additive);
expectSelection(current, [1, 5, 6], 6, 5);

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromClick(current, visible, 1, toggle);
current = selectionFromClick(current, visible, 3, toggle);
current = selectionFromClick(current, visible, 3, toggle);
expectSelection(current, [1, 2], 2, 3);

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromClick(current, visible, 1, toggle);
current = selectionFromClick(current, visible, 3, toggle);
current = selectionFromClick(current, visible, 1, toggle);
expectSelection(current, [2, 3], 3, 1);

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromClick(current, visible, 1, toggle);
current = selectionFromClick(current, visible, 3, toggle);
current = selectionFromClick(current, visible, 1, plain);
expectSelection(current, [1], 1, 1);

current = selectionFromClick(emptySelection(), visible, 3, plain);
current = selectionFromClick(current, visible, 3, range);
expectSelection(current, [3], 3, 3);

current = selectionFromClick(emptySelection(), visible, 4, plain);
current = selectionFromArrow(current, visible, 1, true);
expectSelection(current, [4, 5], 5, 4);
current = selectionFromArrow(current, visible, 1, true);
expectSelection(current, [4, 5, 6], 6, 4);
current = selectionFromArrow(current, visible, -1, true);
expectSelection(current, [4, 5], 5, 4);
current = selectionFromArrow(current, visible, 1, false);
expectSelection(current, [6], 6, 6);

const atEnd = selectionFromClick(emptySelection(), visible, 7, plain);
const stayed = selectionFromArrow(atEnd, visible, 1, false);
if (stayed !== atEnd) {
    throw new Error("arrow at the end of a single selection should keep the same selection");
}

current = selectionFromClick(emptySelection(), visible, 2, plain);
current = selectionFromSelectAll(current, visible);
expectSelection(current, visible, 2, 2);
current = selectionFromArrow(current, visible, 1, true);
expectSelection(current, [2, 3], 3, 2);

current = emptySelection();
current = selectionFromArrow(current, visible, 1, true);
expectSelection(current, [1], 1, 1);
current = selectionFromArrow(emptySelection(), visible, -1, false);
expectSelection(current, [7], 7, 7);

current = selectionFromClick(emptySelection(), visible, 1, plain);
current = selectionFromClick(current, visible, 2, toggle);
current = selectionFromContext(current, 6);
expectSelection(current, [6], 6, 6);

current = selectionFromClick(emptySelection(), visible, 1, plain);
current = selectionFromClick(current, visible, 3, range);
current = selectionFromContext(current, 3);
expectSelection(current, [1, 2, 3], 3, 1);

const filtered = [2, 3, 4];
current = selectionFromClick(emptySelection(), visible, 1, plain);
current = selectionFromClick(current, visible, 2, toggle);
current = selectionFromClick(current, filtered, 4, range);
expectSelection(current, [2, 3, 4], 4, 2);

console.log("selection tests passed");
