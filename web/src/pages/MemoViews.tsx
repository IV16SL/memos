import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import {
  AstroidIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FilterIcon,
  MapPinIcon,
  MoreVerticalIcon,
  ParenthesesIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  ShieldIcon,
  TagsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import CustomIconPicker from "@/components/CustomIconPicker";
import MemoViewIcon from "@/components/MemoViewIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { userServiceClient } from "@/connect";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import useLoading from "@/hooks/useLoading";
import { useMemoViews, userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { getMemoViewId } from "@/lib/memo-views";
import { cn } from "@/lib/utils";
import { MemoView, MemoView_IconSchema, MemoViewSchema } from "@/types/proto/api/user_service_pb";
import { useTranslate, type Translations } from "@/utils/i18n";

const getMemoViewExamples = (t: (key: Translations) => string) => [
  {
    id: "pinned",
    title: t("setting.memo-view.example-pinned-title"),
    filter: "pinned",
    description: t("setting.memo-view.example-pinned-description"),
    icon: PinIcon,
  },
  {
    id: "recent",
    title: t("setting.memo-view.example-recent-title"),
    filter: 'created_ts >= now - duration("1h")',
    description: t("setting.memo-view.example-recent-description"),
    icon: Clock3Icon,
  },
  {
    id: "public",
    title: t("setting.memo-view.example-public-title"),
    filter: 'visibility == "PUBLIC"',
    description: t("setting.memo-view.example-public-description"),
    icon: ShieldIcon,
  },
  {
    id: "project-tags",
    title: t("setting.memo-view.example-project-tags-title"),
    filter: 'tag in ["work", "personal"]',
    description: t("setting.memo-view.example-project-tags-description"),
    icon: TagsIcon,
  },
  {
    id: "untagged",
    title: t("setting.memo-view.example-untagged-title"),
    filter: "size(tags) == 0",
    description: t("setting.memo-view.example-untagged-description"),
    icon: TagsIcon,
  },
  {
    id: "archive-tree",
    title: t("setting.memo-view.example-archive-tree-title"),
    filter: 'tags.exists(t, t.startsWith("archive"))',
    description: t("setting.memo-view.example-archive-tree-description"),
    icon: TagsIcon,
  },
  {
    id: "unassigned",
    title: t("setting.memo-view.example-unassigned-title"),
    filter: "space == null",
    description: t("setting.memo-view.example-unassigned-description"),
    icon: AstroidIcon,
  },
  {
    id: "one-space",
    title: t("setting.memo-view.example-one-space-title"),
    filter: 'space == "spaces/your-space-id"',
    description: t("setting.memo-view.example-one-space-description"),
    icon: AstroidIcon,
  },
  {
    id: "open-tasks",
    title: t("setting.memo-view.example-open-tasks-title"),
    filter: "has_task_list && has_incomplete_tasks",
    description: t("setting.memo-view.example-open-tasks-description"),
    icon: ClipboardCheckIcon,
  },
  {
    id: "links-code",
    title: t("setting.memo-view.example-links-code-title"),
    filter: "has_link || has_code",
    description: t("setting.memo-view.example-links-code-description"),
    icon: FilterIcon,
  },
  {
    id: "no-location",
    title: t("setting.memo-view.example-no-location-title"),
    filter: "!has_location",
    description: t("setting.memo-view.example-no-location-description"),
    icon: MapPinIcon,
  },
  {
    id: "content-search",
    title: t("setting.memo-view.example-content-search-title"),
    filter: 'content.contains("TODO")',
    description: t("setting.memo-view.example-content-search-description"),
    icon: SearchIcon,
  },
  {
    id: "starts-with",
    title: t("setting.memo-view.example-starts-with-title"),
    filter: 'content.startsWith("TODO")',
    description: t("setting.memo-view.example-starts-with-description"),
    icon: SearchIcon,
  },
  {
    id: "regex",
    title: t("setting.memo-view.example-regex-title"),
    filter: 'content.matches("v[0-9]+")',
    description: t("setting.memo-view.example-regex-description"),
    icon: FilterIcon,
  },
  {
    id: "all-tags-complete",
    title: t("setting.memo-view.example-all-tags-complete-title"),
    filter: 'tags.all(t, t.endsWith("-done"))',
    description: t("setting.memo-view.example-all-tags-complete-description"),
    icon: TagsIcon,
  },
  {
    id: "one-project-tag",
    title: t("setting.memo-view.example-one-project-tag-title"),
    filter: 'tags.exists_one(t, t.startsWith("project/"))',
    description: t("setting.memo-view.example-one-project-tag-description"),
    icon: TagsIcon,
  },
  {
    id: "any-tags",
    title: t("setting.memo-view.example-any-tags-title"),
    filter: 'sets.intersects(tags, ["work", "urgent"])',
    description: t("setting.memo-view.example-any-tags-description"),
    icon: TagsIcon,
  },
  {
    id: "exact-tags",
    title: t("setting.memo-view.example-exact-tags-title"),
    filter: 'sets.equivalent(tags, ["inbox"])',
    description: t("setting.memo-view.example-exact-tags-description"),
    icon: TagsIcon,
  },
  {
    id: "from-2024",
    title: t("setting.memo-view.example-from-2024-title"),
    filter: "created_ts.getFullYear() == 2024",
    description: t("setting.memo-view.example-from-2024-description"),
    icon: Clock3Icon,
  },
  {
    id: "weekend",
    title: t("setting.memo-view.example-weekend-title"),
    filter: "created_ts.getDayOfWeek() == 0 || created_ts.getDayOfWeek() == 6",
    description: t("setting.memo-view.example-weekend-description"),
    icon: Clock3Icon,
  },
  {
    id: "long-notes",
    title: t("setting.memo-view.example-long-notes-title"),
    filter: "size(content) > 280",
    description: t("setting.memo-view.example-long-notes-description"),
    icon: FilterIcon,
  },
];

const filterFields = [
  "content.contains(...)",
  "content.startsWith(...)",
  "content.endsWith(...)",
  "content.matches(...)",
  "visibility",
  "pinned",
  "space == null",
  "space != null",
  'space == "spaces/..."',
  "tag in [...]",
  "tags.exists(...)",
  "tags.all(...)",
  "tags.exists_one(...)",
  "sets.contains(tags, [...])",
  "sets.intersects(tags, [...])",
  "sets.equivalent(tags, [...])",
  "size(tags) == ...",
  "size(content) > ...",
  "has_task_list",
  "has_incomplete_tasks",
  "has_link",
  "has_code",
  "has_location",
  'created_ts >= now - duration("24h")',
  "created_ts.getFullYear() == ...",
  "created_ts.getMonth() == ... (0 = Jan)",
  "created_ts.getDayOfWeek() == ... (0 = Sun)",
  "updated_ts",
  "now",
  'timestamp("2025-01-01T00:00:00Z")',
];

const createEmptyMemoView = () =>
  create(MemoViewSchema, {
    name: "",
    title: "",
    filter: "",
  });

type MemoViewExample = ReturnType<typeof getMemoViewExamples>[number];

interface MemoViewGuideProps {
  examples: MemoViewExample[];
  onUseExample: (example: MemoViewExample) => void;
}

interface MemoViewsRouteState {
  openCreate?: boolean;
  memoView?: MemoView;
}

const MemoViewGuide = ({ examples, onUseExample }: MemoViewGuideProps) => {
  const t = useTranslate();
  return (
    <aside className="flex flex-col gap-5">
      <div className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("setting.memo-view.examples-title")}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {examples.map((example) => {
            const Icon = example.icon;
            return (
              <button
                type="button"
                key={example.filter}
                className="group w-full cursor-pointer rounded-md border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => onUseExample(example)}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  {example.title}
                </span>
                <span className="mt-1 block font-mono text-xs leading-5 text-muted-foreground">{example.filter}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{example.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("setting.memo-view.fields-title")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {filterFields.map((field) => (
            <Badge key={field} variant="secondary" className="font-mono">
              {field}
            </Badge>
          ))}
        </div>
      </div>
    </aside>
  );
};

const MemoViews = () => {
  const t = useTranslate();
  const examples = useMemo(() => getMemoViewExamples(t), [t]);
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: memoViews = [], isPending, isError, refetch } = useMemoViews(user?.name);
  const { memoView: selectedMemoView, setMemoView } = useMemoFilterContext();
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [draft, setDraft] = useState<MemoView>(createEmptyMemoView());
  const [deleteTarget, setDeleteTarget] = useState<MemoView | undefined>();
  const createState = useLoading(false);
  const validateState = useLoading(false);
  const updateState = useLoading(false);
  const isEditing = draft.name !== "";
  const isSaving = createState.isLoading || updateState.isLoading;

  useEffect(() => {
    const state = location.state as MemoViewsRouteState | null;
    if (!state) return;

    if (state.memoView) {
      setDraft(
        create(MemoViewSchema, {
          name: state.memoView.name,
          title: state.memoView.title,
          filter: state.memoView.filter,
          icon: state.memoView.icon,
        }),
      );
      setIsCreateFormOpen(true);
    } else if (state.openCreate) {
      setDraft(createEmptyMemoView());
      setIsCreateFormOpen(true);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.pathname, location.state, navigate]);

  const setDraftState = (state: Partial<MemoView>) => {
    setDraft((current) => ({ ...current, ...state }));
  };

  const handleUseExample = (example: MemoViewExample) => {
    setDraft(
      create(MemoViewSchema, {
        name: draft.name,
        title: draft.title || example.title,
        filter: example.filter,
        icon: draft.icon,
      }),
    );
    setIsCreateFormOpen(true);
  };

  const handleOpenCreateForm = () => {
    setDraft(createEmptyMemoView());
    setIsCreateFormOpen(true);
  };

  const handleCloseForm = () => {
    setDraft(createEmptyMemoView());
    setIsCreateFormOpen(false);
  };

  const handleEditMemoView = (memoView: MemoView) => {
    setDraft(
      create(MemoViewSchema, {
        name: memoView.name,
        title: memoView.title,
        filter: memoView.filter,
        icon: memoView.icon,
      }),
    );
    setIsCreateFormOpen(true);
  };

  const validateDraft = async () => {
    if (!draft.title || !draft.filter) {
      toast.error(t("setting.memo-view.toast-empty"));
      return false;
    }
    if (!user?.name) {
      toast.error(t("setting.memo-view.toast-no-user"));
      return false;
    }

    try {
      validateState.setLoading();
      await userServiceClient.createMemoView({
        parent: user.name,
        memoView: { name: "", title: draft.title, filter: draft.filter, icon: draft.icon },
        validateOnly: true,
      });
      validateState.setFinish();
      toast.success(t("setting.memo-view.toast-valid"));
      return true;
    } catch (error: unknown) {
      await handleError(error, toast.error, {
        context: "Validate memo view filter",
        onError: () => validateState.setError(),
      });
      return false;
    }
  };

  const handleCreateMemoView = async () => {
    if (!draft.title || !draft.filter) {
      toast.error(t("setting.memo-view.toast-empty"));
      return;
    }
    if (!user?.name) {
      toast.error(t("setting.memo-view.toast-no-user"));
      return;
    }

    try {
      createState.setLoading();
      await userServiceClient.createMemoView({
        parent: user.name,
        memoView: { name: "", title: draft.title, filter: draft.filter, icon: draft.icon },
      });
      await queryClient.invalidateQueries({ queryKey: userKeys.memoViews(user.name) });
      createState.setFinish();
      setDraft(createEmptyMemoView());
      setIsCreateFormOpen(false);
      toast.success(t("setting.memo-view.toast-created"));
    } catch (error: unknown) {
      await handleError(error, toast.error, {
        context: "Create memo view",
        onError: () => createState.setError(),
      });
    }
  };

  const handleUpdateMemoView = async () => {
    if (!draft.title || !draft.filter) {
      toast.error(t("setting.memo-view.toast-empty"));
      return;
    }

    try {
      updateState.setLoading();
      await userServiceClient.updateMemoView({
        memoView: draft,
        updateMask: create(FieldMaskSchema, { paths: ["title", "filter", "icon"] }),
      });
      await queryClient.invalidateQueries({ queryKey: userKeys.memoViews(user?.name) });
      updateState.setFinish();
      setDraft(createEmptyMemoView());
      setIsCreateFormOpen(false);
      toast.success(t("setting.memo-view.toast-updated"));
    } catch (error: unknown) {
      await handleError(error, toast.error, {
        context: "Update memo view",
        onError: () => updateState.setError(),
      });
    }
  };

  const handleSaveMemoView = async () => {
    if (isEditing) {
      await handleUpdateMemoView();
      return;
    }

    await handleCreateMemoView();
  };

  const confirmDeleteMemoView = async () => {
    if (!deleteTarget) return;

    try {
      await userServiceClient.deleteMemoView({ name: deleteTarget.name });
      await queryClient.invalidateQueries({ queryKey: userKeys.memoViews(user?.name) });
      if (selectedMemoView === getMemoViewId(deleteTarget.name)) setMemoView(undefined);
      toast.success(t("setting.memo-view.delete-success", { title: deleteTarget.title }));
    } catch (error: unknown) {
      await handleError(error, toast.error, {
        context: "Delete memo view",
      });
    } finally {
      setDeleteTarget(undefined);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FilterIcon className="h-4 w-4" />
            <span className="text-sm font-medium">{t("common.views")}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{t("common.views")}</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("setting.memo-view.description")}</p>
        </div>
        <Button onClick={isCreateFormOpen ? handleCloseForm : handleOpenCreateForm}>
          {isCreateFormOpen ? <XIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
          {isCreateFormOpen ? t("common.cancel") : t("common.create")}
        </Button>
      </div>

      <div className={cn("grid grid-cols-1 gap-6", isCreateFormOpen && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="flex min-w-0 flex-col gap-6">
          <div
            inert={!isCreateFormOpen}
            className={cn(
              "overflow-hidden rounded-lg border border-border bg-background transition-[max-height,opacity] duration-200",
              isCreateFormOpen ? "max-h-[48rem] opacity-100" : "max-h-0 border-transparent opacity-0",
            )}
          >
            <div className="grid gap-5 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{isEditing ? t("setting.memo-view.edit-view") : t("setting.memo-view.create")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("setting.memo-view.form-description")}</p>
                </div>
                <a
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  href="https://www.usememos.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("setting.memo-view.docs")}
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="view-title">{t("common.title")}</Label>
                  <div className="flex items-center gap-2">
                    <CustomIconPicker
                      value={draft.icon}
                      onChange={(icon) => setDraftState({ icon: icon ? create(MemoView_IconSchema, icon) : undefined })}
                      label={t("setting.memo-view.change-icon")}
                      fallback={ParenthesesIcon}
                      disabled={isSaving}
                    />
                    <Input
                      id="view-title"
                      value={draft.title}
                      placeholder={t("setting.memo-view.title-placeholder")}
                      onChange={(event) => setDraftState({ title: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="view-filter">{t("common.filter")}</Label>
                  <Textarea
                    id="view-filter"
                    rows={5}
                    className="font-mono text-sm"
                    value={draft.filter}
                    placeholder='pinned && tag in ["work"]'
                    onChange={(event) => setDraftState({ filter: event.target.value })}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">{t("setting.memo-view.filter-help")}</p>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" disabled={validateState.isLoading || isSaving} onClick={validateDraft}>
                  <CheckCircle2Icon className="h-4 w-4" />
                  {t("setting.memo-view.validate")}
                </Button>
                <Button disabled={isSaving || validateState.isLoading} onClick={handleSaveMemoView}>
                  <SaveIcon className="h-4 w-4" />
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </div>

          {!(memoViews.length === 0 && isCreateFormOpen) && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">{t("setting.memo-view.all-views")}</h2>
                {!isPending && !isError && <Badge variant="outline">{memoViews.length}</Badge>}
              </div>

              {isPending ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("setting.memo-view.loading")}</p>
              ) : isError ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">{t("setting.memo-view.load-error")}</p>
                  <Button variant="outline" className="mt-4" onClick={() => void refetch()}>
                    {t("setting.memo-view.retry")}
                  </Button>
                </div>
              ) : memoViews.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">{t("setting.memo-view.empty-title")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("setting.memo-view.empty-description")}</p>
                  <Button variant="outline" className="mt-4" onClick={handleOpenCreateForm}>
                    <PlusIcon className="size-4" />
                    {t("setting.memo-view.create")}
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {memoViews.map((memoView) => (
                    <div
                      key={memoView.name}
                      className="grid gap-3 bg-background px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_2rem]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <MemoViewIcon icon={memoView.icon} className="size-4 text-base" />
                          <span className="truncate">{memoView.title}</span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{getMemoViewId(memoView.name)}</div>
                      </div>
                      <pre className="min-w-0 overflow-x-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                        {memoView.filter}
                      </pre>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="justify-self-end" />}>
                          <MoreVerticalIcon className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditMemoView(memoView)}>
                            <PencilIcon className="h-4 w-4" />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleteTarget(memoView)}>
                            <Trash2Icon className="h-4 w-4" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isCreateFormOpen ? <MemoViewGuide examples={examples} onUseExample={handleUseExample} /> : null}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={t("setting.memo-view.delete-confirm", { title: deleteTarget?.title ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteMemoView}
        confirmVariant="destructive"
      />
    </section>
  );
};

export default MemoViews;
