import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { markdownStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import { TASK_LIST_CLASS, TASK_LIST_ITEM_CLASS } from "../constants";
import { NestedMarkdownRenderContext } from "../MarkdownRenderContext";
import type { ReactMarkdownProps } from "./types";

interface TaskListChildProps {
  children?: ReactNode;
  node?: {
    tagName?: string;
    properties?: {
      type?: unknown;
    };
  };
  type?: string;
  checked?: boolean;
}

const isCheckboxInput = (child: ReactNode): child is ReactElement<TaskListChildProps> => {
  return (
    isValidElement<TaskListChildProps>(child) && (child.props.type === "checkbox" || child.props.node?.properties?.type === "checkbox")
  );
};

const isParagraphElement = (child: ReactNode): child is ReactElement<TaskListChildProps> => {
  return isValidElement<TaskListChildProps>(child) && (child.type === "p" || child.props.node?.tagName === "p");
};

const splitTaskListItemChildren = (children: ReactNode) => {
  let checkbox: ReactNode;
  const content: ReactNode[] = [];

  Children.toArray(children).forEach((child) => {
    if (!checkbox && isCheckboxInput(child)) {
      checkbox = child;
      return;
    }

    if (!checkbox && isParagraphElement(child)) {
      const paragraphChildren: ReactNode[] = [];

      Children.toArray(child.props.children).forEach((paragraphChild) => {
        if (!checkbox && isCheckboxInput(paragraphChild)) {
          checkbox = paragraphChild;
          return;
        }
        paragraphChildren.push(paragraphChild);
      });

      if (checkbox) {
        if (paragraphChildren.length > 0) {
          content.push(cloneElement(child, undefined, ...paragraphChildren));
        }
        return;
      }
    }

    content.push(child);
  });

  return { checkbox, content };
};

interface ListProps extends React.HTMLAttributes<HTMLUListElement | HTMLOListElement>, ReactMarkdownProps {
  ordered?: boolean;
  children: React.ReactNode;
}

/**
 * List component for both regular and task lists (GFM)
 * Detects task lists via the "contains-task-list" class added by remark-gfm.
 * Task lists annotated by rehypeTaskProgress get a progress bar on top.
 */
export const List = ({ ordered, children, className, node: _node, ...domProps }: ListProps) => {
  const Component = ordered ? "ol" : "ul";
  const isTaskList = className?.includes(TASK_LIST_CLASS);
  const listClass = isTaskList ? markdownStyles.taskList : ordered ? markdownStyles.orderedList : markdownStyles.bulletList;

  const total = Number((domProps as Record<string, unknown>)["data-task-total"] ?? (domProps as Record<string, unknown>)["dataTaskTotal"] ?? 0);
  const checked = Number(
    (domProps as Record<string, unknown>)["data-task-checked"] ?? (domProps as Record<string, unknown>)["dataTaskChecked"] ?? 0,
  );
  const showProgress = isTaskList && total > 1;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;

  return (
    <>
      {showProgress && (
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span>
            {checked}/{total} · {percent}%
          </span>
        </div>
      )}
      <Component className={cn(listClass, className)} {...domProps}>
        {children}
      </Component>
    </>
  );
};

interface ListItemProps extends React.LiHTMLAttributes<HTMLLIElement>, ReactMarkdownProps {
  children: React.ReactNode;
}

/**
 * List item component for both regular and task list items
 * Detects task items via the "task-list-item" class added by remark-gfm
 */
export const ListItem = ({ children, className, node: _node, ...domProps }: ListItemProps) => {
  const isTaskListItem = className?.includes(TASK_LIST_ITEM_CLASS);

  if (isTaskListItem) {
    const { checkbox, content } = splitTaskListItemChildren(children);
    // remark-gfm marks completed tasks with checked on the checkbox element;
    // strike through the text when the task is done.
    const isChecked = isValidElement<TaskListChildProps>(checkbox) && checkbox.props.checked === true;

    return (
      <li className={cn(markdownStyles.taskListItem, className)} {...domProps}>
        <NestedMarkdownRenderContext>
          {checkbox}
          <div className={cn(markdownStyles.taskItemContent, isChecked && "text-muted-foreground line-through decoration-muted-foreground/60")}>
            {content}
          </div>
        </NestedMarkdownRenderContext>
      </li>
    );
  }

  return (
    <li className={cn(markdownStyles.listItem, className)} {...domProps}>
      <NestedMarkdownRenderContext>{children}</NestedMarkdownRenderContext>
    </li>
  );
};
