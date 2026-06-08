import { absoluteUrl } from "./discovery";
import { getPublishedPost } from "./posts";
import { site } from "./site";

const NOTIFICATION_TIMEOUT_MS = 3000;
const BODY_SUMMARY_MAX_LENGTH = 160;

type PendingCommentNotification = {
  slug: string;
  commentId: string;
  authorName: string;
  body: string;
};

function getWebhookUrl() {
  const rawUrl = process.env.COMMENT_NOTIFY_WEBHOOK_URL?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      console.error("Comment notification webhook URL must use http or https.");
      return null;
    }

    return url.toString();
  } catch {
    console.error("Comment notification webhook URL is invalid.");
    return null;
  }
}

function summarizeBody(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= BODY_SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, BODY_SUMMARY_MAX_LENGTH)}...`;
}

export async function notifyPendingComment(params: PendingCommentNotification) {
  const webhookUrl = getWebhookUrl();
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
      console.error(`Comment notification webhook failed with status ${response.status}.`);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Comment notification webhook timed out."
        : "Comment notification webhook request failed.";
    console.error(message);
  } finally {
    clearTimeout(timeout);
  }
}
