/**
 * 跨平台工具执行器 - 安全验证
 *
 * KURISU-019: 提供输入验证和安全检查，防止命令注入
 */

/**
 * 验证工具名称
 *
 * 只允许字母、数字、下划线、连字符，防止命令注入
 */
export function validateToolName(name: string): {
  valid: boolean;
  error?: string;
} {
  // 检查是否为空
  if (!name || name.length === 0) {
    return { valid: false, error: "Tool name cannot be empty" };
  }

  // 检查长度
  if (name.length > 64) {
    return { valid: false, error: `Tool name too long: ${name.length} > 64` };
  }

  // 只允许安全字符：字母、数字、下划线、连字符
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return {
      valid: false,
      error: `Invalid tool name: "${name}". Only alphanumeric characters, underscores, and hyphens are allowed.`,
    };
  }

  return { valid: true };
}

/**
 * 危险命令模式列表
 *
 * 这些是明确禁止的命令，无论命令结构如何
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  description: string;
}> = [
  { pattern: /\brm\s+-rf\b/, description: "Recursive delete" },
  { pattern: /\bmkfs\b/, description: "Format filesystem" },
  { pattern: /\bdd\s+if=/, description: "Disk write" },
  { pattern: />\s*\/dev\//, description: "Write to device" },
  { pattern: /\bchmod\s+777\b/, description: "Dangerous permissions" },
  { pattern: /\bsudo\b/, description: "Privilege escalation" },
  { pattern: /\bdoas\b/, description: "Privilege escalation" },
  { pattern: /\bnc\b.*-e/, description: "Reverse shell" },
  { pattern: /\bbash\s+-i\b/, description: "Interactive shell" },
  { pattern: /\bsh\s+-i\b/, description: "Interactive shell" },
  { pattern: /:\(\)\{.*:\|:.*\};.*:/, description: "Fork bomb" },
];

/**
 * Shell 元字符模式列表
 *
 * 这些字符在 shell 中有特殊含义，可能被利用进行命令注入
 */
const SHELL_METACHARACTER_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  description: string;
  severity: "critical" | "high" | "medium";
}> = [
  // CRITICAL: 命令替换 - 允许执行任意命令
  {
    pattern: /\$\(/,
    description: "Command substitution $()",
    severity: "critical",
  },
  {
    pattern: /`[^`]*`/,
    description: "Backtick command substitution",
    severity: "critical",
  },
  // CRITICAL: 命令链 - 允许执行多个命令
  {
    pattern: /;\s*\w/,
    description: "Command chain with ;",
    severity: "critical",
  },
  {
    pattern: /&&\s*\w/,
    description: "Command chain with &&",
    severity: "critical",
  },
  {
    pattern: /\|\|\s*\w/,
    description: "Command chain with ||",
    severity: "critical",
  },
  { pattern: /\|\s*\w/, description: "Pipe to command", severity: "high" },
  // HIGH: 重定向 - 可能泄露数据
  {
    pattern: />\s*\//,
    description: "Output redirect to path",
    severity: "high",
  },
  {
    pattern: /<\s*\//,
    description: "Input redirect from path",
    severity: "high",
  },
  {
    pattern: />>\s*\//,
    description: "Append redirect to path",
    severity: "high",
  },
  // HIGH: 敏感文件访问
  {
    pattern: /\/etc\/passwd/,
    description: "Access to /etc/passwd",
    severity: "high",
  },
  {
    pattern: /\/etc\/shadow/,
    description: "Access to /etc/shadow",
    severity: "critical",
  },
  {
    pattern: /\/root\/\.ssh/,
    description: "Access to SSH keys",
    severity: "critical",
  },
  {
    pattern: /\.ssh\/id_rsa/,
    description: "Access to private SSH key",
    severity: "critical",
  },
  // HIGH: 环境变量扩展 - 可能泄露敏感信息
  {
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*\}/,
    description: "Variable expansion ${VAR}",
    severity: "medium",
  },
  // MEDIUM: 特殊字符
  { pattern: /~\//, description: "Home directory access", severity: "medium" },
  {
    pattern: /\$HOME\b/,
    description: "HOME variable access",
    severity: "medium",
  },
  // CRITICAL: Heredoc - 可能用于绕过检查
  {
    pattern: /<<\s*['"]?\w+['"]?/,
    description: "Heredoc syntax",
    severity: "high",
  },
];

/**
 * 检查命令是否包含危险模式
 */
export function checkDangerousCommand(command: string): {
  safe: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(`Detected dangerous pattern: ${description}`);
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

/**
 * Shell 元字符检测结果
 */
export interface ShellMetacharacterResult {
  /** 是否安全（无危险元字符） */
  safe: boolean;
  /** 检测到的元字符问题 */
  issues: Array<{
    description: string;
    severity: "critical" | "high" | "medium";
    matched: string;
  }>;
  /** 是否有 critical 级别问题 */
  hasCritical: boolean;
  /** 是否有 high 级别问题 */
  hasHigh: boolean;
}

/**
 * 检查命令是否包含危险的 shell 元字符
 *
 * 用于检测命令注入攻击向量
 */
export function checkShellMetacharacters(
  command: string,
): ShellMetacharacterResult {
  const issues: ShellMetacharacterResult["issues"] = [];

  for (const {
    pattern,
    description,
    severity,
  } of SHELL_METACHARACTER_PATTERNS) {
    const match = pattern.exec(command);
    if (match) {
      issues.push({
        description,
        severity,
        matched: match[0],
      });
    }
  }

  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasHigh = issues.some((i) => i.severity === "high");

  return {
    safe: issues.length === 0,
    issues,
    hasCritical,
    hasHigh,
  };
}

/**
 * 综合安全检查
 *
 * 同时检查危险命令模式和 shell 元字符
 */
export function validateCommandSecurity(command: string): {
  safe: boolean;
  dangerousWarnings: string[];
  shellIssues: ShellMetacharacterResult;
  overallRisk: "none" | "low" | "medium" | "high" | "critical";
} {
  const dangerousWarnings = checkDangerousCommand(command).warnings;
  const shellIssues = checkShellMetacharacters(command);

  // 计算整体风险等级
  let overallRisk: "none" | "low" | "medium" | "high" | "critical" = "none";

  if (dangerousWarnings.length > 0) {
    overallRisk = "critical";
  } else if (shellIssues.hasCritical) {
    overallRisk = "critical";
  } else if (shellIssues.hasHigh) {
    overallRisk = "high";
  } else if (shellIssues.issues.length > 0) {
    overallRisk = "medium";
  }

  return {
    safe: dangerousWarnings.length === 0 && shellIssues.safe,
    dangerousWarnings,
    shellIssues,
    overallRisk,
  };
}

/**
 * 敏感环境变量名称模式（黑名单）
 *
 * 这些模式在白名单检查后仍会被阻止
 */
const BLOCKED_ENV_PATTERNS: ReadonlyArray<RegExp> = [
  /API[_-]?KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /PRIVATE[_-]?KEY/i,
  /ACCESS[_-]?KEY/i,
  /AUTH/i,
  /DATABASE[_-]?URL/i,
  /DB[_-]?PASS/i,
  /REDIS[_-]?URL/i,
  /MONGO[_-]?URI/i,
  /AWS[_-]?ACCESS/i,
  /AWS[_-]?SECRET/i,
  /GITHUB[_-]?TOKEN/i,
  /SLACK[_-]?WEBHOOK/i,
  /OPENAI[_-]?KEY/i,
  /ANTHROPIC[_-]?KEY/i,
];

/**
 * 允许的环境变量（白名单）
 *
 * 只有这些变量会被传递给子进程
 */
const ALLOWED_ENV_VARS: ReadonlyArray<string> = [
  // 系统基础
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USER",
  "SHELL",
  // 工具相关（显式允许的 kurisu 变量）
  "KURISU_WORKSPACE",
  "KURISU_LOG_LEVEL",
  "KURISU_PATH",
  // Node.js
  "NODE_OPTIONS",
  // 时区
  "TZ",
];

/**
 * 允许的环境变量前缀（用于动态变量）
 */
const ALLOWED_ENV_PREFIXES: ReadonlyArray<string> = [
  "TOOL_", // 工具特定配置
  "APP_", // 应用配置（非敏感）
];

/**
 * 过滤敏感环境变量
 *
 * 使用白名单优先策略，只传递已知安全的变量
 *
 * @param env 源环境变量对象
 * @param mode 过滤模式："strict"（仅白名单）| "permissive"（白名单+黑名单）
 */
export function filterSensitiveEnvVars(
  env: Record<string, string>,
  mode: "strict" | "permissive" = "strict",
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    // 1. 检查是否在显式白名单中
    const isInWhitelist = ALLOWED_ENV_VARS.includes(key);
    const hasAllowedPrefix = ALLOWED_ENV_PREFIXES.some((prefix) =>
      key.startsWith(prefix),
    );

    if (mode === "strict") {
      // 严格模式：仅允许白名单中的变量
      if (!isInWhitelist && !hasAllowedPrefix) {
        continue;
      }
    }

    // 2. 检查黑名单（即使通过白名单也要检查）
    const isBlocked = BLOCKED_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (isBlocked) {
      continue;
    }

    // 3. 额外检查：值中可能包含的敏感信息模式
    if (typeof value === "string") {
      // 检测看起来像密钥的值
      if (
        value.length > 20 &&
        /^[A-Za-z0-9_-]+$/.test(value) &&
        !value.startsWith("/")
      ) {
        // 可能是 API key，跳过
        continue;
      }
    }

    filtered[key] = value;
  }

  return filtered;
}

/**
 * 关键系统路径（不允许挂载）
 */
const CRITICAL_SYSTEM_PATHS: ReadonlyArray<string> = [
  "/",
  "/etc",
  "/var",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/root",
  "/boot",
  "/proc",
  "/sys",
  "/dev",
];

/**
 * 验证允许的路径列表
 *
 * 过滤掉危险的系统路径
 */
export function validateAllowedPaths(paths: readonly string[]): {
  valid: string[];
  rejected: string[];
} {
  const valid: string[] = [];
  const rejected: string[] = [];

  for (const p of paths) {
    // 特殊处理根路径
    if (p === "/" || p === "") {
      rejected.push(p);
      continue;
    }

    const normalized = p.replace(/\/+$/, ""); // 移除尾部斜杠

    // 检查是否是关键系统路径
    const isCritical = CRITICAL_SYSTEM_PATHS.some(
      (critical) =>
        normalized === critical || normalized.startsWith(critical + "/"),
    );

    if (isCritical) {
      rejected.push(p);
    } else {
      valid.push(p);
    }
  }

  return { valid, rejected };
}

/**
 * 安全地构建执行命令
 *
 * 使用 Base64 编码参数，避免 shell 注入
 */
export function buildSafeCommand(
  toolName: string,
  args: Record<string, unknown>,
): { command: string; error?: string } {
  // 验证工具名称
  const nameValidation = validateToolName(toolName);
  if (!nameValidation.valid) {
    return { command: "", error: nameValidation.error ?? "Invalid tool name" };
  }

  // 将参数编码为 Base64，避免 shell 注入
  const argsJson = JSON.stringify(args);
  const argsBase64 = Buffer.from(argsJson).toString("base64");

  // 构建安全的命令
  const command = `${toolName} --args-base64 ${argsBase64}`;

  return { command };
}

/**
 * 解码 Base64 参数
 *
 * 用于沙箱内的工具解码参数
 */
export function decodeBase64Args(base64Args: string): Record<string, unknown> {
  const json = Buffer.from(base64Args, "base64").toString("utf-8");
  return JSON.parse(json) as Record<string, unknown>;
}
