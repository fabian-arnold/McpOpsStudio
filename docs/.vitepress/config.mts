import { defineConfig } from "vitepress";

const repository = "https://github.com/fabian-arnold/McpOpsStudio";

export default defineConfig({
  title: "MCP Ops Studio",
  titleTemplate: ":title | MCP Ops Studio",
  description:
    "Technical documentation for the self-hosted, function-first operations platform.",
  base: process.env.DOCS_BASE ?? "/",
  lastUpdated: true,
  srcExclude: ["README.md"],
  sitemap: {
    hostname: "https://fabian-arnold.github.io/McpOpsStudio/",
  },
  head: [
    ["meta", { name: "theme-color", content: "#6d4aff" }],
    [
      "link",
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%236d4aff%22/><path d=%22M10 9v14M22 9v14M10 16h12%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22/></svg>",
      },
    ],
  ],
  markdown: {
    lineNumbers: true,
  },
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "MCP Ops Studio Docs",
    nav: [
      { text: "Overview", link: "/" },
      { text: "Install", link: "/installation" },
      { text: "Development", link: "/development" },
      { text: "API", link: "/api" },
      { text: "GitHub", link: repository },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Project overview", link: "/" },
          { text: "Docker Compose installation", link: "/installation" },
          { text: "Development", link: "/development" },
        ],
      },
      {
        text: "Platform concepts",
        items: [
          { text: "Architecture", link: "/architecture" },
          {
            text: "Runtime and deployments",
            link: "/runtime-and-deployments",
          },
          { text: "Security model", link: "/security" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Control-plane API", link: "/api" },
          { text: "Software releases", link: "/releasing" },
          { text: "Commit style", link: "/commit-style" },
          {
            text: "Contributing",
            link: `${repository}/blob/main/CONTRIBUTING.md`,
          },
        ],
      },
    ],
    outline: {
      level: [2, 3],
      label: "On this page",
    },
    search: {
      provider: "local",
    },
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    lastUpdated: {
      text: "Last updated",
      formatOptions: {
        dateStyle: "medium",
        timeStyle: "short",
      },
    },
    docFooter: {
      prev: "Previous",
      next: "Next",
    },
    socialLinks: [{ icon: "github", link: repository }],
    footer: {
      message: "Self-hosted infrastructure for operational Functions.",
      copyright: "MCP Ops Studio",
    },
  },
});
