/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // TypeScript 严格规则
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-floating-promises": "warn",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-misused-promises": [
      "warn",
      { checksVoidReturn: false },
    ],
    "@typescript-eslint/require-await": "warn",

    // 代码质量规则
    "no-console": "off",
    "prefer-const": "error",
    "no-var": "error",
    eqeqeq: ["error", "always"],
  },
  overrides: [
    {
      // Gateway 层，允许 async 方法无 await
      files: ["src/platform/gateway/**/*.ts"],
      rules: {
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/no-misused-promises": "off",
      },
    },
    {
      // Memory 层，JSON 序列化需要 any
      files: ["src/platform/memory/session-memory.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
      },
    },
    {
      // Config 模型配置，stream reader 返回 any
      files: ["src/platform/models/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-return": "off",
      },
    },
  ],
  ignorePatterns: ["dist", "node_modules", "*.js", "!.eslintrc.js"],
};
