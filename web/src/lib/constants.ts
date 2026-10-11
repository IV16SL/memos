// TAB_SPACE_WIDTH is the default tab space width.
export const TAB_SPACE_WIDTH = 2;

// DEFAULT_LIST_MEMOS_PAGE_SIZE is the default page size for list memos request.
export const DEFAULT_LIST_MEMOS_PAGE_SIZE = 16;

// LOADING_INDICATOR_DELAY_MS is how long a load must take before the loading spinner appears.
// Loads that finish faster than this never render the spinner, avoiding a flash on fast/self-hosted networks.
export const LOADING_INDICATOR_DELAY_MS = 250;

// SLOW_LOAD_HINT_DELAY_MS is how long the initial memo list load must take before
// we tell the user the database might be waking up (e.g. Neon auto-suspend after
// idle). This keeps a multi-second wake from looking like a broken page.
export const SLOW_LOAD_HINT_DELAY_MS = 3000;

export const MEMOS_WEBSITE_URL = "https://usememos.com/";
export const MEMOS_DOCUMENTATION_URL = "https://usememos.com/docs";
export const MEMOS_API_DOCUMENTATION_URL = "https://usememos.com/docs/api";
export const MEMOS_GITHUB_URL = "https://github.com/usememos/memos";

// Official companion browser extension for saving web content to Memos.
export const WEB_CLIPPER_URL = "https://github.com/usememos/web-clipper";
