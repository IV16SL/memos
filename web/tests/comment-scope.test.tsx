import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useUserStats: vi.fn(() => ({ data: undefined })) }));

vi.mock("@/hooks/useUserQueries", () => ({ useUserStats: mocks.useUserStats, useMemoViews: () => ({ data: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ currentUser: { name: "users/alice" }, isUserSettingsInitialized: true }),
}));

import { updateDevicePreferences } from "@/hooks/useDevicePreferences";
import { useCommentScopeFilter } from "@/hooks/useMemoFilters";

describe("comment scope", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.useUserStats.mockClear();
  });

  it("keeps comments out of lists and their statistics until the reader includes them", () => {
    const { result } = renderHook(() => useCommentScopeFilter());
    expect(result.current).toBe("parent == null");

    act(() => updateDevicePreferences({ includeComments: true }));
    expect(result.current).toBeUndefined();

    act(() => updateDevicePreferences({ includeComments: false }));
    expect(result.current).toBe("parent == null");
  });
});
