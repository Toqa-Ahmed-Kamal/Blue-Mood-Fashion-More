"use client";

import { useEffect, type RefObject } from "react";

// Keeps every admin table inside its card (no sideways scroll), whatever the number of columns:
// - each cell gets its column name (data-label) and numbers/amounts are marked (data-num) so they stay on one line;
// - a table still wider than its card switches to one card per row (data-stack), labels beside the values.
// Tables that manage their own layout (old-orders-table) are left alone.
const SKIP = ".old-orders-table";
const NUMBER = /^[\s\d,.٫−\-+×%٪]*(ج\.م|EGP|%|٪|كيلو|قطعة)?[\s\d,.٫%٪]*$/;

function labelCells(table: HTMLTableElement) {
  const headers = [...table.querySelectorAll(":scope > thead > tr > th")].map((th) => th.textContent?.trim() ?? "");
  for (const row of table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tfoot > tr")) {
    let column = 0;
    for (const cell of row.cells) {
      // A label written in the markup wins; ours are marked so they can be refreshed.
      if (!cell.hasAttribute("data-label") || cell.hasAttribute("data-auto-label")) {
        const label = headers[column] ?? "";
        if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
        cell.setAttribute("data-auto-label", "");
      }
      const text = cell.textContent?.trim() ?? "";
      const isNumber = text.length > 0 && text.length <= 24 && /\d/.test(text) && NUMBER.test(text) && cell.children.length <= 2;
      if (isNumber !== cell.hasAttribute("data-num")) cell.toggleAttribute("data-num", isNumber);
      column += cell.colSpan || 1;
    }
  }
}

/** Card layout only when the table does not fit its card. Measured without the card layout, in the same frame (no flicker). */
function fit(table: HTMLTableElement) {
  const box = table.parentElement;
  if (!box) return;
  const wasStacked = table.hasAttribute("data-stack");
  if (wasStacked) table.removeAttribute("data-stack");
  const tooWide = table.scrollWidth > box.clientWidth + 1;
  if (tooWide) table.setAttribute("data-stack", "");
}

export function useAdminTableFit(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      for (const table of element.querySelectorAll<HTMLTableElement>(`table.admin-table:not(${SKIP})`)) {
        if (table.offsetParent === null) continue;
        labelCells(table);
        fit(table);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    // Our own attribute changes are not observed (attributes: false), so this cannot loop.
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    schedule();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}
