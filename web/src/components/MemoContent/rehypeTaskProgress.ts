import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import { TASK_LIST_CLASS, TASK_LIST_ITEM_CLASS } from "./constants";

/**
 * Annotates each GFM task list (`ul.contains-task-list`) with
 * `data-task-total` and `data-task-checked` counts. The List component
 * reads these to render a progress bar. Runs before sanitize, so the
 * schema must allow `data-task-*` on `ul`.
 */
export function rehypeTaskProgress() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "ul") return;
      const className = node.properties?.className;
      if (!Array.isArray(className) || !className.includes(TASK_LIST_CLASS)) return;

      let total = 0;
      let checked = 0;
      for (const child of node.children) {
        if (child.type !== "element" || child.tagName !== "li") continue;
        const liClass = child.properties?.className;
        if (!Array.isArray(liClass) || !liClass.includes(TASK_LIST_ITEM_CLASS)) continue;
        total++;
        // remark-gfm emits <input type="checkbox" checked?> as the first child.
        const input = child.children.find(
          (c): c is Element => c.type === "element" && c.tagName === "input" && c.properties?.type === "checkbox",
        );
        if (input?.properties?.checked) checked++;
      }
      if (total > 0) {
        node.properties = {
          ...node.properties,
          dataTaskTotal: String(total),
          dataTaskChecked: String(checked),
        };
      }
    });
  };
}
