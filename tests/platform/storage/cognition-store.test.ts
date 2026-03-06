/**
 * CognitionStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createCognitionStore } from "../../../src/platform/storage/cognition-store.js";

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DIR = join(process.cwd(), "tmp-test-cognition-store");
const INITIAL_CONTENT = "# 初始认知\n\n我是测试角色。";

describe("CognitionStore", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("read", () => {
    it("should return initialContent when file does not exist", async () => {
      const store = createCognitionStore({
        stateDir: TEST_DIR,
        initialContent: INITIAL_CONTENT,
      });

      const content = await store.read();
      expect(content).toBe(INITIAL_CONTENT);
    });

    it("should return persisted content when file exists", async () => {
      const persisted = "# 已保存的认知\n\n我更新了。";
      writeFileSync(join(TEST_DIR, "cognition.md"), persisted, "utf-8");

      const store = createCognitionStore({
        stateDir: TEST_DIR,
        initialContent: INITIAL_CONTENT,
      });

      const content = await store.read();
      expect(content).toBe(persisted);
    });
  });

  describe("write", () => {
    it("should persist content to cognition.md", async () => {
      const store = createCognitionStore({
        stateDir: TEST_DIR,
        initialContent: INITIAL_CONTENT,
      });

      const newContent = "# 新认知\n\n我学到了新东西。";
      await store.write(newContent);

      const fileContent = readFileSync(join(TEST_DIR, "cognition.md"), "utf-8");
      expect(fileContent).toBe(newContent);
    });

    it("should create directory if stateDir does not exist", async () => {
      const nestedDir = join(TEST_DIR, "nested", "deep");
      const store = createCognitionStore({
        stateDir: nestedDir,
        initialContent: INITIAL_CONTENT,
      });

      await store.write("test content");

      const fileContent = readFileSync(join(nestedDir, "cognition.md"), "utf-8");
      expect(fileContent).toBe("test content");
    });

    it("should overwrite existing content (snapshot pattern)", async () => {
      const store = createCognitionStore({
        stateDir: TEST_DIR,
        initialContent: INITIAL_CONTENT,
      });

      await store.write("version 1");
      await store.write("version 2");

      const content = await store.read();
      expect(content).toBe("version 2");
    });
  });

  describe("read → write → read roundtrip", () => {
    it("should persist and retrieve content correctly", async () => {
      const store = createCognitionStore({
        stateDir: TEST_DIR,
        initialContent: INITIAL_CONTENT,
      });

      // Initial read → returns initial
      const first = await store.read();
      expect(first).toBe(INITIAL_CONTENT);

      // Write new content
      const updated = "# 更新后的认知";
      await store.write(updated);

      // Read again → returns updated
      const second = await store.read();
      expect(second).toBe(updated);
    });
  });
});
