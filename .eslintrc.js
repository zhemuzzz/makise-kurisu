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
    "@typescript-eslint/no-explicit-any": "warn", // 改为警告，LangGraph 类型问题需要 any
    "@typescript-eslint/explicit-function-return-type": "off", // 关闭，过于严格
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-floating-promises": "warn", // 改为警告
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-misused-promises": [
      "warn",
      { checksVoidReturn: false }, // 允许 Promise 返回 void 回调
    ],
    "@typescript-eslint/require-await": "warn", // 改为警告，async 函数可能不需要 await

    // 代码质量规则
    "no-console": "off", // 允许 console（CLI 项目）
    "prefer-const": "error",
    "no-var": "error",
    eqeqeq: ["error", "always"],
  },
  overrides: [
    {
      // LangGraph 相关文件，允许 any 类型
      files: ["src/agents/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
      },
    },
    {
      // CLI 和 Server 入口文件
      files: ["src/bin/**/*.ts"],
      rules: {
        "@typescript-eslint/no-misused-promises": "off",
        "@typescript-eslint/no-floating-promises": "off",
      },
    },
    {
      // Gateway 层，允许 async 方法无 await
      files: ["src/gateway/**/*.ts"],
      rules: {
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/no-misused-promises": "off",
      },
    },
    {
      // Memory 层，JSON 序列化需要 any
      files: ["src/memory/session-memory.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
      },
    },
    {
      // Config 模型配置，stream reader 返回 any
      files: ["src/config/models/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-return": "off",
      },
    },
    {
      // Server HTTP 请求处理，chunk 是 any
      files: ["src/bin/server.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
      },
    },
  ],
  ignorePatterns: ["dist", "node_modules", "*.js", "!.eslintrc.js"],
};
