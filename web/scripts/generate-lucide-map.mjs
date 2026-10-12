// Regenerates src/lib/lucide-icon-map.ts from the installed lucide-react filenames.
// Run from web/: node scripts/generate-lucide-map.mjs
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(webDir, "node_modules/lucide-react/dist/esm/icons");

const toPascal = (kebab) =>
  kebab
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("") + "Icon";

const files = readdirSync(iconsDir)
  .filter((f) => f.endsWith(".mjs") && f !== "index.mjs")
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort();

const entries = files.map((kebab) => `  "${kebab}": "${toPascal(kebab)}",`).join("\n");

writeFileSync(
  join(webDir, "src/lib/lucide-icon-map.ts"),
  `// Generated from lucide-react icon filenames. Do not edit manually.\n// Regenerate: node scripts/generate-lucide-map.mjs (kebab-case filename -> PascalCase export)\nexport const LUCIDE_ICON_MAP: Record<string, string> = {\n${entries}\n};\n`,
);
console.log(`generated ${files.length} entries`);
