import { site } from "./site";

export function absoluteUrl(path: string) {
  return new URL(path, site.url).toString();
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sitemapDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
