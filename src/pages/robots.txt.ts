import type { APIRoute } from "astro";
import { absoluteUrl } from "@lib/discovery";

export const GET: APIRoute = () => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    ""
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
};
