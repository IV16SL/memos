import * as LucideIcons from "lucide-react";
import { AstroidIcon, type LucideIcon } from "lucide-react";
import { LUCIDE_ICON_MAP } from "./lucide-icon-map";

// Shared display shape; each resource retains its own protobuf message type.
export interface CustomIconValue {
  value: { case: "emoji" | "lucide"; value: string } | { case: undefined; value?: undefined };
}

const isIconComponent = (v: unknown): v is LucideIcon =>
  v != null && (typeof v === "function" || typeof v === "object") && "$$typeof" in (v as object);

// Full Lucide catalog (2035 icons), keyed by kebab-case name. Built dynamically from the
// generated filename -> export map so tree-shaking is intentionally defeated here —
// the picker needs every icon. Existing saved names (e.g. "book-open") resolve identically.
export const CUSTOM_SYMBOLS: Record<string, LucideIcon> = {};
for (const [kebab, pascal] of Object.entries(LUCIDE_ICON_MAP)) {
  const comp = (LucideIcons as unknown as Record<string, unknown>)[pascal];
  if (isIconComponent(comp)) {
    CUSTOM_SYMBOLS[kebab] = comp;
  }
}

export const getCustomSymbol = (name: string, fallback: LucideIcon = AstroidIcon) =>
  Object.hasOwn(CUSTOM_SYMBOLS, name) ? CUSTOM_SYMBOLS[name] : fallback;

export const customIconsEqual = (a?: CustomIconValue, b?: CustomIconValue) =>
  a?.value.case === b?.value.case && a?.value.value === b?.value.value;
