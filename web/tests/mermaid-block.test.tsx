import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MermaidBlock } from "@/components/MemoContent/MermaidBlock";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    userGeneralSetting: { theme: "default" },
  }),
}));

const renderAsync = vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' }));

// MermaidBlock renders through Pele now (see MermaidBlock.tsx), not mermaid.js:
// the old mermaid mock is dead. Mock Pele's lazy renderer so the test covers
// the component's own behavior (clearing output) without pulling in the real
// renderer.
vi.mock("pele/lazy", () => ({
  renderAsync,
}));

const codeElement = (content: string) => <code className="language-mermaid">{content}</code>;

describe("MermaidBlock", () => {
  it("clears rendered output when code content becomes empty", async () => {
    const { container, rerender } = render(<MermaidBlock>{codeElement("graph TD; A-->B")}</MermaidBlock>);

    // The .mermaid-diagram container is always mounted by design (it is
    // measured for Pele's autoDirection flip); only the rendered SVG inside
    // it is cleared when the code empties.
    await waitFor(() => expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull());

    rerender(<MermaidBlock>{codeElement("")}</MermaidBlock>);

    await waitFor(() => expect(container.querySelector(".mermaid-diagram svg")).toBeNull());
  });
});
