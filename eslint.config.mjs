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
        ...globals.browser,
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
      "sonarjs/cognitive-complexity": ["warn", 20],
      complexity: ["warn", 20],
      "max-depth": ["warn", 4],
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "warn",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      "max-params": ["warn", 5],
    },
  },
  {
    files: webFiles,
    settings: {
      react: { version: "detect" },
      next: { rootDir: "apps/web" },
    },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
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
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["apps/runtime/src/invoke.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
);
