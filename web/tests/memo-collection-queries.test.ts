import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { findMemoInCollectionQueries, memoKeys } from "@/hooks/useMemoQueries";
import { ListMemosResponseSchema, MemoSchema } from "@/types/proto/api/memo_service_pb";

describe("findMemoInCollectionQueries", () => {
  it("ignores cached infinite comment lists instead of crashing on page.memos.find", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Pages of useInfiniteMemoComments carry `comments`, not `memos`.
    client.setQueryData([...memoKeys.comments("memos/parent"), "infinite", 20], {
      pages: [{ comments: [create(MemoSchema, { name: "memos/comment-1" })], nextPageToken: "" }],
      pageParams: [""],
    });

    expect(() => findMemoInCollectionQueries(client, "memos/target")).not.toThrow();
    expect(findMemoInCollectionQueries(client, "memos/target")).toBeUndefined();
  });

  it("still finds a memo in a cached infinite memo list", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const target = create(MemoSchema, { name: "memos/target" });
    client.setQueryData(memoKeys.list({}), {
      pages: [create(ListMemosResponseSchema, { memos: [target] })],
      pageParams: [""],
    });

    expect(findMemoInCollectionQueries(client, "memos/target")?.name).toBe("memos/target");
    expect(findMemoInCollectionQueries(client, "memos/other")).toBeUndefined();
  });
});
