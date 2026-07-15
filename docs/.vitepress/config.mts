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
      { text: "Get started", link: "/getting-started" },
      { text: "App guide", link: "/app/navigation" },
      { text: "Operations", link: "/installation" },
      { text: "Contribute", link: "/contributing/platform-development" },
      { text: "API", link: "/api" },
      { text: "GitHub", link: repository },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Project overview", link: "/" },
          { text: "Getting started", link: "/getting-started" },
          { text: "Installation and account", link: "/app/account-and-setup" },
          { text: "Navigation and roles", link: "/app/navigation" },
        ],
      },
      {
        text: "Use the app",
        collapsed: false,
        items: [
          { text: "Global overview", link: "/app/global-overview" },
          { text: "Dashboard", link: "/app/dashboard" },
          { text: "Functions", link: "/app/functions" },
          { text: "Function editor", link: "/app/function-editor" },
          { text: "IDE access", link: "/app/platform-mcp" },
          { text: "Operational templates", link: "/app/templates" },
          { text: "Endpoint Map", link: "/app/endpoint-map" },
          { text: "Endpoints", link: "/app/endpoints" },
          { text: "MCP Endpoints", link: "/app/mcp-endpoints" },
          { text: "HTTP APIs", link: "/app/http-apis" },
          { text: "Endpoint details", link: "/app/endpoint-details" },
          { text: "Libraries", link: "/app/libraries" },
          { text: "Authentication", link: "/app/authentication" },
          { text: "Secrets", link: "/app/secrets" },
          { text: "Executions", link: "/app/executions" },
          { text: "Logs", link: "/app/logs" },
          { text: "Deployments", link: "/app/deployments" },
          { text: "Project settings", link: "/app/project-settings" },
        ],
      },
      {
        text: "Administration and help",
        items: [
          { text: "Projects", link: "/app/projects" },
          { text: "Users", link: "/app/users" },
          { text: "Audit log", link: "/app/audit-log" },
          { text: "Source code", link: "/app/source-code" },
          { text: "Legal notices", link: "/app/legal-notices" },
          { text: "Documentation", link: "/app/documentation" },
          { text: "Platform settings", link: "/app/platform-settings" },
        ],
      },
      {
        text: "End-to-end guides",
        items: [
          { text: "Build your first Function", link: "/guides/first-function" },
          { text: "Publish an MCP tool", link: "/guides/mcp-tool" },
          { text: "Publish an HTTP route", link: "/guides/http-route" },
          { text: "Secure an endpoint", link: "/guides/secure-endpoint" },
          { text: "Release and roll back", link: "/guides/release-and-rollback" },
        ],
      },
      {
        text: "Operate an installation",
        items: [
          { text: "Docker Compose installation", link: "/installation" },
          { text: "Runtime and deployments", link: "/runtime-and-deployments" },
          { text: "Security model", link: "/security" },
          { text: "Control-plane API", link: "/api" },
          { text: "Software releases", link: "/releasing" },
        ],
      },
      {
        text: "Develop the platform",
        items: [
          { text: "Contributor orientation", link: "/contributing/platform-development" },
          { text: "Architecture", link: "/architecture" },
          { text: "Local development", link: "/development" },
          { text: "Commit style", link: "/commit-style" },
          { text: "Documentation media", link: "/contributing/documentation-media" },
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
