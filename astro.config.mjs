import mdx from "@astrojs/mdx";
import netlify from "@astrojs/netlify";
import { defineConfig } from "astro/config";

const isDevCommand = process.argv.includes("dev");

export default defineConfig({
  output: "static",
  adapter: isDevCommand ? undefined : netlify(),
  devToolbar: {
    enabled: false
  },
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: "github-light",
      wrap: true
    }
  }
});
