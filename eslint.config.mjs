import { FlatCompat } from "@eslint/eslintrc";
import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import-x";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{js,mjs,cjs,ts,tsx}"];
const testFiles = ["**/*.{test,spec}.{js,mjs,cjs,ts,tsx}", "scripts/**"];
const webFiles = [
  "apps/web/**/*.{ts,tsx}",
  // Next runs ESLint with apps/web as its working directory during next build.
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
];
const compat = new FlatCompat({ recommendedConfig: eslint.configs.recommended });
const nextConfigs = compat
  .extends("next/core-web-vitals", "next/typescript")
  .map((config) => ({
    ...config,
    files: webFiles,
    rules: {
      ...config.rules,
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  }));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/dist/**",
      "docs/.vitepress/**",
    ],
  },
  { files: sourceFiles, ...eslint.configs.recommended },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  ...nextConfigs,
  {
    files: sourceFiles,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "import-x": importPlugin,
      sonarjs,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-duplicate-imports": "error",
      "no-unreachable-loop": "error",
      "no-useless-assignment": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "sonarjs/cognitive-complexity": ["error", 20],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      "max-params": ["error", 5],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts", "prisma/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: webFiles,
    languageOptions: { globals: globals.browser },
    settings: {
      react: { version: "detect" },
      next: { rootDir: "apps/web" },
    },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/label-has-associated-control": ["warn", { assert: "either", depth: 4 }],
      "jsx-a11y/no-autofocus": "warn",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    files: testFiles,
    rules: {
      "import-x/first": "off",
      "sonarjs/cognitive-complexity": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "max-params": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["apps/runtime/src/{invoke,invocation-adapters}.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: [
      "apps/api/src/{routes-*,storage-support,reviewed-database-routes,api-operation-helpers,platform-mcp,source-patch}.ts",
      "apps/runtime/src/{server,server-utils,internal-routes,invoke,invocation-adapters,storage-repository}.ts",
      "apps/worker/src/{builder,builder-validation,auth-policy-validation}.ts",
      "apps/web/features/functions/*.{ts,tsx}",
      "apps/web/components/{binding-map,reviewed-database,reviewed-database-queries,runtime-endpoint-detail,runtime-endpoint-authentication,shell,shell-sidebar}.tsx",
    ],
    rules: {
      "max-lines-per-function": ["error", 500],
      complexity: ["error", 70],
      "sonarjs/cognitive-complexity": ["error", 55],
      "max-params": ["error", 8],
    },
  },
  {
    files: [
      "apps/api/src/{endpoint-discovery,installation}.ts",
      "apps/runtime/src/{auth,repository}.ts",
      "apps/web/app/{audit,deployments,endpoints,executions,libraries,login,logs,overview,project-settings,setup,templates}/**/*.tsx",
      "apps/web/app/page.tsx",
      "apps/web/components/{binding-editor-dialog,notification-center,runtime-endpoints-page,schema-input-tools,typescript-editor}.tsx",
      "packages/sandbox/src/network.ts",
      "prisma/seed.ts",
    ],
    rules: {
      "max-lines-per-function": ["error", 700],
      complexity: ["error", 50],
      "sonarjs/cognitive-complexity": ["error", 50],
      "max-params": ["error", 8],
    },
  },
  {
    files: ["prisma/seed.ts"],
    rules: { "max-lines": ["error", 900] },
  },
  {
    files: ["scripts/e2e.mjs"],
    rules: { "max-lines": ["error", 1100] },
  },
  {
    files: ["apps/**/*.{js,mjs,cjs,ts,tsx}", "packages/**/*.{js,mjs,cjs,ts,tsx}"],
    rules: { "max-lines": ["error", { max: 500 }] },
  },
  {
    files: ["apps/api/src/platform-mcp.ts"],
    rules: { "max-lines": ["error", { max: 1650 }] },
  },
);
