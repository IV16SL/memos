import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * Converts `<!--more-->` HTML comments into `<span data-more-marker>` followed by
 * `<div data-more-content>` wrapping all subsequent siblings. The sanitizer strips
 * comments, so we convert before sanitize runs. React toggles `[data-more-content]`
 * visibility instead of direct DOM manipulation (which breaks React reconciliation).
 */
export function rehypeMoreMarker() {
  return (tree: Root) => {
    visit(tree, "comment", (node: any, index: number | undefined, parent: any) => {
      if (node.value?.trim() !== "more" || !parent || typeof index !== "number") return;

      const marker: Element = {
        type: "element",
        tagName: "span",
        properties: { dataMoreMarker: "" },
        children: [],
      };
      // Wrap everything after the marker (at the same level) for collapsible display.
      const after = parent.children.slice(index + 1);
      const wrapper: Element = {
        type: "element",
        tagName: "div",
        properties: { dataMoreContent: "" },
        children: after as Element[],
      };
      parent.children = [...parent.children.slice(0, index), marker, wrapper];
    });
  };
}
