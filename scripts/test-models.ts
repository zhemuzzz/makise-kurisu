/**
 * 模型连接测试脚本
 * 位置: scripts/test-models.ts
 *
 * 使用方法: npx tsx scripts/test-models.ts [model-name]
 * 如果不指定 model-name，则测试所有模型
 */

import { resolve } from "path";
import { config } from "dotenv";
import {
  loadConfig,
  ModelProvider,
  type ModelConfig,
} from "../src/config/models";

// 获取项目根目录
const projectRoot = resolve(__dirname, "..");

// 从项目根目录加载 .env 文件
config({ path: resolve(projectRoot, ".env") });

interface TestResult {
  model: string;
  status: "success" | "failed" | "skipped";
  latency?: number;
  error?: string;
  response?: string;
}

async function testModel(
  provider: ModelProvider,
  modelName: string,
): Promise<TestResult> {
  try {
    const model = provider.get(modelName);
    const startTime = Date.now();

    const response = await model.chat(
      [{ role: "user", content: 'Say "OK" if you can hear me.' }],
      { maxTokens: 10 },
    );

    const latency = Date.now() - startTime;

    return {
      model: modelName,
      status: "success",
      latency,
      response: response.content.substring(0, 100),
    };
  } catch (error) {
    return {
      model: modelName,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const targetModel = process.argv[2];

  console.log("\n🔧 模型连接测试");
  console.log("=".repeat(50));

  // 加载配置
  let config;
  const configPath = resolve(projectRoot, "config/models.yaml");
  try {
    config = await loadConfig(configPath);
    console.log(`✓ 配置加载成功，共 ${config.models.length} 个模型\n`);
  } catch (error) {
    console.error("✗ 配置加载失败:", error);
    process.exit(1);
  }

  // 创建 Provider
  const provider = new ModelProvider(config.models, config.defaults);

  // 确定要测试的模型
  const modelsToTest = targetModel
    ? [targetModel]
    : config.models.map((m) => m.name);

  const results: TestResult[] = [];

  for (const modelName of modelsToTest) {
    // 检查环境变量是否配置
    const modelConfig = config.models.find((m) => m.name === modelName);
    if (!modelConfig) {
      results.push({
        model: modelName,
        status: "skipped",
        error: "Model not found in config",
      });
      continue;
    }

    // 检查 apiKey 是否配置
    if (!modelConfig.apiKey || modelConfig.apiKey.startsWith("${")) {
      results.push({
        model: modelName,
        status: "skipped",
        error: "API key not configured (check .env file)",
      });
      continue;
    }

    console.log(`测试 ${modelName}...`);
    const result = await testModel(provider, modelName);
    results.push(result);

    if (result.status === "success") {
      console.log(`  ✓ 成功 (${result.latency}ms): ${result.response}\n`);
    } else {
      console.log(`  ✗ 失败: ${result.error}\n`);
    }
  }

  // 输出汇总
  console.log("\n📊 测试结果汇总");
  console.log("=".repeat(50));

  const successCount = results.filter((r) => r.status === "success").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  console.log(
    `成功: ${successCount}  失败: ${failedCount}  跳过: ${skippedCount}`,
  );

  if (failedCount > 0) {
    console.log("\n失败的模型:");
    results
      .filter((r) => r.status === "failed")
      .forEach((r) => console.log(`  - ${r.model}: ${r.error}`));
  }

  if (skippedCount > 0) {
    console.log("\n跳过的模型 (需要配置环境变量):");
    results
      .filter((r) => r.status === "skipped")
      .forEach((r) => console.log(`  - ${r.model}`));
  }

  console.log("");

  // 退出码
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch(console.error);
