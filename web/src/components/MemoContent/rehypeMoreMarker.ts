import type { Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * Converts `<!--more-->` HTML comments into `<span data-more-marker>` elements.
 * The sanitizer strips comments, so we convert before sanitize runs.
 * The custom "read more" script looks for `[data-more-marker]` in the DOM.
 */
export function rehypeMoreMarker() {
  return (tree: Root) => {
    visit(tree, "comment", (node: any, index: number | undefined, parent: any) => {
      if (node.value?.trim() === "more" && parent && typeof index === "number") {
        parent.children[index] = {
          type: "element",
          tagName: "span",
          properties: { dataMoreMarker: "" },
          children: [],
        };
      }
    });
  };
}
