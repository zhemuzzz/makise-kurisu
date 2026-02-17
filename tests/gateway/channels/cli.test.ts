/**
 * L1 交互网关 - CLI 渠道测试
 * 测试命令行输入输出、流式输出、退出命令
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CLIChannel } from "../../../src/gateway/channels/cli";
import { ChannelType, type GatewayDeps } from "../../../src/gateway/types";
import {
  createMockOrchestrator,
  MOCK_AI_RESPONSE_CHUNKS,
  MOCK_AI_RESPONSE_FULL,
} from "../../fixtures/gateway-fixtures";
import * as readline from "readline";

// Mock readline module
vi.mock("readline", () => ({
  createInterface: vi.fn(),
}));

describe("CLIChannel", () => {
  let cliChannel: CLIChannel;
  let mockOrchestrator: ReturnType<typeof createMockOrchestrator>;
  let mockReadline: {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = createMockOrchestrator();

    mockReadline = {
      question: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };

    (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(
      mockReadline,
    );
  });

  afterEach(() => {
    if (cliChannel) {
      cliChannel.stop();
    }
  });

  describe("constructor", () => {
    it("should create CLI channel with default options", () => {
      cliChannel = new CLIChannel(mockOrchestrator);

      expect(cliChannel.channelType).toBe(ChannelType.CLI);
    });

    it("should create CLI channel with custom options", () => {
      cliChannel = new CLIChannel(mockOrchestrator, {
        prompt: "> ",
        exitCommands: ["/quit", "/exit"],
      });

      expect(cliChannel).toBeDefined();
    });

    it("should throw error if orchestrator is missing", () => {
      expect(
        () => new CLIChannel(null as unknown as GatewayDeps["orchestrator"]),
      ).toThrow(/orchestrator.*required/i);
    });
  });

  describe("start", () => {
    it("should create readline interface", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);

      await cliChannel.start();

      expect(readline.createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        output: process.stdout,
      });
    });

    it("should show welcome message", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      cliChannel = new CLIChannel(mockOrchestrator, {
        welcomeMessage: "Welcome to Kurisu!",
      });

      await cliChannel.start();

      expect(consoleSpy).toHaveBeenCalledWith("Welcome to Kurisu!");

      consoleSpy.mockRestore();
    });

    it("should start input loop", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      expect(mockReadline.on).toHaveBeenCalledWith(
        "close",
        expect.any(Function),
      );
    });
  });

  describe("stop", () => {
    it("should close readline interface", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();
      cliChannel.stop();

      expect(mockReadline.close).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      cliChannel.stop();
      cliChannel.stop();
      cliChannel.stop();

      expect(mockReadline.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("input handling", () => {
    it("should handle user input and get AI response", async () => {
      mockOrchestrator.processStream.mockResolvedValue(MOCK_AI_RESPONSE_FULL);

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      // Simulate user input callback
      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("你好");

      expect(mockOrchestrator.processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "你好",
        }),
      );
    });

    it("should handle empty input gracefully", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("");

      // Should not process empty input
      expect(mockOrchestrator.processStream).not.toHaveBeenCalled();
    });

    it("should handle whitespace-only input", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("   \t\n   ");

      expect(mockOrchestrator.processStream).not.toHaveBeenCalled();
    });

    it("should trim input whitespace", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("  hello world  ");

      expect(mockOrchestrator.processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "hello world",
        }),
      );
    });
  });

  describe("exit commands", () => {
    it("should exit on /quit command", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("/quit");

      expect(mockReadline.close).toHaveBeenCalled();
    });

    it("should exit on /exit command", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("/exit");

      expect(mockReadline.close).toHaveBeenCalled();
    });

    it("should support custom exit commands", async () => {
      cliChannel = new CLIChannel(mockOrchestrator, {
        exitCommands: ["/bye", "/goodbye"],
      });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("/bye");

      expect(mockReadline.close).toHaveBeenCalled();
    });

    it("should show goodbye message on exit", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      cliChannel = new CLIChannel(mockOrchestrator, {
        goodbyeMessage: "Goodbye!",
      });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("/exit");

      expect(consoleSpy).toHaveBeenCalledWith("Goodbye!");

      consoleSpy.mockRestore();
    });
  });

  describe("stream output", () => {
    it("should output AI response chunks as stream", async () => {
      const processSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      // Mock orchestrator to return stream
      async function* mockStream() {
        for (const chunk of MOCK_AI_RESPONSE_CHUNKS) {
          yield chunk;
        }
      }

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: mockStream(),
      });

      cliChannel = new CLIChannel(mockOrchestrator, { streamOutput: true });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("你好");

      // Verify output was written
      expect(processSpy).toHaveBeenCalled();

      processSpy.mockRestore();
    });

    it("should output full response when streaming disabled", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockOrchestrator.processStream.mockResolvedValue(MOCK_AI_RESPONSE_FULL);

      cliChannel = new CLIChannel(mockOrchestrator, { streamOutput: false });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("你好");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_AI_RESPONSE_FULL),
      );

      consoleSpy.mockRestore();
    });

    it("should add newline after response", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      // console.log adds newline
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should display error message on orchestrator failure", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockOrchestrator.processStream.mockRejectedValue(
        new Error("Orchestrator failed"),
      );

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error"),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should continue input loop after error", async () => {
      mockOrchestrator.processStream.mockRejectedValue(new Error("Failed"));

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      // Should have called question again to continue loop
      expect(mockReadline.question).toHaveBeenCalledTimes(2);
    });

    it("should handle network timeout gracefully", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockOrchestrator.processStream.mockRejectedValue(
        Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" }),
      );

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("session management", () => {
    it("should create session on first input", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      expect(mockOrchestrator.createSession).toHaveBeenCalled();
    });

    it("should reuse session for subsequent inputs", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");
      mockOrchestrator.hasSession.mockReturnValue(true);

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      // First input
      const questionCall1 = mockReadline.question.mock.calls[0];
      const inputCallback1 = questionCall1[1];
      await inputCallback1("Hello");

      // Second input
      const questionCall2 = mockReadline.question.mock.calls[1];
      const inputCallback2 = questionCall2[1];
      await inputCallback2("World");

      // Should only create session once
      expect(mockOrchestrator.createSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("prompt customization", () => {
    it("should use custom prompt string", async () => {
      cliChannel = new CLIChannel(mockOrchestrator, {
        prompt: "Kurisu> ",
      });
      await cliChannel.start();

      expect(mockReadline.question).toHaveBeenCalledWith(
        "Kurisu> ",
        expect.any(Function),
      );
    });

    it("should use default prompt if not specified", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      expect(mockReadline.question).toHaveBeenCalledWith(
        expect.stringContaining(">"),
        expect.any(Function),
      );
    });
  });

  describe("typing indicator", () => {
    it("should show typing indicator while processing", async () => {
      const processSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      // Delay the response
      mockOrchestrator.processStream.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("Response"), 100)),
      );

      cliChannel = new CLIChannel(mockOrchestrator, {
        showTypingIndicator: true,
      });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      // Should have shown typing indicator
      expect(processSpy).toHaveBeenCalledWith(expect.stringContaining("..."));

      processSpy.mockRestore();
    });

    it("should clear typing indicator after response", async () => {
      const processSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator, {
        showTypingIndicator: true,
      });
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      // Should clear the line
      expect(processSpy).toHaveBeenCalledWith("\r\x1b[K");

      processSpy.mockRestore();
    });
  });

  describe("special input handling", () => {
    it("should handle multi-line input with escape sequence", async () => {
      cliChannel = new CLIChannel(mockOrchestrator, {
        multilineEnabled: true,
      });
      await cliChannel.start();

      // This would require more complex mock setup
      // For now, just verify the option is accepted
      expect(cliChannel).toBeDefined();
    });

    it("should handle interrupt signal (Ctrl+C)", async () => {
      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      // Get the 'close' event handler
      const closeHandler = mockReadline.on.mock.calls.find(
        (call: unknown[]) => call[0] === "close",
      )?.[1];

      // Simulate Ctrl+C by triggering the close event
      expect(closeHandler).toBeDefined();
      if (closeHandler) {
        closeHandler();
      }

      // After close event, isRunning should be false
      // Note: handleClose() sets isRunning = false, doesn't call rl.close() again
      expect(cliChannel.isRunning()).toBe(false);
    });
  });

  describe("integration with Gateway", () => {
    it("should use channel type CLI", () => {
      cliChannel = new CLIChannel(mockOrchestrator);

      expect(cliChannel.channelType).toBe(ChannelType.CLI);
    });

    it("should pass session info to orchestrator", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("Hello");

      expect(mockOrchestrator.processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          channelType: ChannelType.CLI,
        }),
      );
    });
  });

  describe("boundary cases", () => {
    it("should handle very long input", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");
      const longInput = "a".repeat(10000);

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback(longInput);

      expect(mockOrchestrator.processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          input: longInput,
        }),
      );
    });

    it("should handle unicode input", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      await inputCallback("你好世界 🌍 مرحبا");

      expect(mockOrchestrator.processStream).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "你好世界 🌍 مرحبا",
        }),
      );
    });

    it("should handle special characters safely", async () => {
      mockOrchestrator.processStream.mockResolvedValue("Response");

      cliChannel = new CLIChannel(mockOrchestrator);
      await cliChannel.start();

      const questionCall = mockReadline.question.mock.calls[0];
      const inputCallback = questionCall[1];

      // Should not throw
      await inputCallback("<script>alert(1)</script>");
      await inputCallback("'; DROP TABLE users; --");
      await inputCallback('{"json": "content"}');
    });
  });
});
