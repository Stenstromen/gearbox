import {layoutColumns, resetColumn, resizeColumns, type ColumnSpec} from "./column-resize.ts";

const columns: ColumnSpec[] = [
    {id: "name", label: "Name", min: 80, defaultWidth: 200, flex: true},
    {id: "size", label: "Size", min: 50, defaultWidth: 100},
    {id: "progress", label: "Progress", min: 90, defaultWidth: 260},
    {id: "up", label: "Up", min: 40, defaultWidth: 80},
];

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function assertWidths(actual: readonly number[], expected: readonly number[], message: string): void {
    if (actual.join(",") !== expected.join(",")) {
        throw new Error(`${message}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
    }
}

let widths = layoutColumns(columns, {}, 800);
assertWidths(widths, [360, 100, 260, 80], "flex column fills the container");

widths = layoutColumns(columns, {size: 140, progress: 200}, 800);
assertWidths(widths, [380, 140, 200, 80], "stored widths replace defaults");

widths = layoutColumns(columns, {size: 20, progress: 400}, 800);
assertWidths(widths, [270, 50, 400, 80], "stored width stays at the column minimum");

widths = layoutColumns(columns, {}, 200);
assertWidths(widths, [80, 100, 260, 80], "flex column stops at its minimum and the table can scroll");

widths = layoutColumns(columns, {}, 0);
assertWidths(widths, [200, 100, 260, 80], "unknown container uses the flex default");

let stored = resizeColumns(columns, {}, 1, 40, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [360, 140, 220, 80], "dragging between fixed columns trades their widths");
assert(stored.name === undefined, "flex width is derived, not stored");

stored = resizeColumns(columns, {}, 0, 30, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [390, 70, 260, 80], "dragging the flex boundary shrinks the next column");

stored = resizeColumns(columns, {}, 0, -50, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [310, 150, 260, 80], "dragging the flex boundary left grows the next column");

stored = resizeColumns(columns, {size: 60}, 0, 40, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [410, 50, 260, 80], "drag stops when the shrinking column hits its minimum");

stored = resizeColumns(columns, {}, 1, -80, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [360, 50, 310, 80], "drag stops when the growing side's neighbor hits its minimum");

stored = resizeColumns(columns, {size: 180, progress: 220}, 1, 0, 800);
widths = layoutColumns(columns, stored, 900);
assertWidths(widths, [420, 180, 220, 80], "a wider container gives the extra space to the flex column");

stored = resizeColumns(columns, {}, 2, 25, 800);
widths = layoutColumns(columns, stored, 800);
assertWidths(widths, [360, 100, 285, 55], "the last boundary resizes the last column");

const reset = resetColumn(columns, {size: 180, progress: 220, up: 90}, 1);
widths = layoutColumns(columns, reset, 800);
assertWidths(widths, [390, 100, 220, 90], "reset restores the column on that boundary");
assert(reset.size === undefined, "reset clears the stored width");

const resetNext = resetColumn(columns, {size: 150}, 0);
widths = layoutColumns(columns, resetNext, 800);
assertWidths(widths, [360, 100, 260, 80], "reset on the flex boundary restores the following column");

console.log("column resize tests passed");
