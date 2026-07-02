import { absoluteUrl } from "./discovery";
import type { ApiRequestContext } from "./api";
import { logApiError } from "./api";
import { getPublishedPost } from "./posts";
import { site } from "./site";

const NOTIFICATION_TIMEOUT_MS = 3000;
const BODY_SUMMARY_MAX_LENGTH = 160;

type PendingCommentNotification = {
  slug: string;
  commentId: string;
  authorName: string;
  body: string;
  context?: ApiRequestContext;
};

function getWebhookUrl(context?: ApiRequestContext) {
  const rawUrl = process.env.COMMENT_NOTIFY_WEBHOOK_URL?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      logNotificationError(context, "comment_notification_config", 500, "invalid protocol");
      return null;
    }

    return url.toString();
  } catch {
    logNotificationError(context, "comment_notification_config", 500, "invalid URL");
    return null;
  }
}

function summarizeBody(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= BODY_SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, BODY_SUMMARY_MAX_LENGTH)}...`;
}

export async function notifyPendingComment(params: PendingCommentNotification) {
  const webhookUrl = getWebhookUrl(params.context);
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFICATION_TIMEOUT_MS);

  try {
    const post = await getPublishedPost(params.slug);
    const reviewParams = new URLSearchParams({
      status: "pending",
      q: params.commentId
    });
    const payload = {
      event: "comment.pending",
      site: {
        name: site.name,
        url: site.url
      },
      post: {
        slug: params.slug,
        title: post?.data.title ?? params.slug,
        url: absoluteUrl(`/posts/${params.slug}`)
      },
      comment: {
        id: params.commentId,
        authorName: params.authorName,
        bodySummary: summarizeBody(params.body)
      },
      reviewUrl: absoluteUrl(`/admin/comments?${reviewParams.toString()}`)
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      logNotificationError(
        params.context,
        "comment_notification_webhook",
        response.status,
        `webhook returned ${response.status}`,
        {
          slug: params.slug,
          commentId: params.commentId
        }
      );
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    logNotificationError(
      params.context,
      "comment_notification_webhook",
      isTimeout ? 504 : 502,
      error,
      {
        slug: params.slug,
        commentId: params.commentId
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function logNotificationError(
  context: ApiRequestContext | undefined,
  action: string,
  status: number,
  error: unknown,
  meta?: Record<string, unknown>
) {
  if (!context) {
    console.error("api.error", {
      action,
      status,
      error: "Comment notification failed without request context."
    });
    return;
  }

  logApiError(context, {
    action,
    status,
    error,
    meta
  });
}
