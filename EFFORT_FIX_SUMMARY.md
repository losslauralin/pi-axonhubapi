# Pi-AxonHub Effort 实现修复总结

## 问题诊断

检查了 pi-axonhub 对 Claude effort 参数的实现，发现 `buildThinkingLevelMap` 函数的映射逻辑存在问题。

## 关键发现

### Claude API 规范
- effort 参数位于 `output_config.effort`
- 支持的值：`"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`
- 需要配合 `thinking: {type: "adaptive"}` 使用（Opus 4.7+/Fable 5）

### Pi 框架约定
- Pi 使用 `ThinkingLevel` 类型：`"minimal" | "low" | "medium" | "high" | "xhigh"`
- **注意：Pi 的 ThinkingLevel 不包含 `"max"`**
- 通过 `thinkingLevelMap` 将 Pi 的 level 映射到提供商的 effort 值

### Models.dev API
- 通过 `reasoning_options` 数组提供模型能力信息
- 每个选项包含 `type`（如 `"effort"`）和 `values`（支持的值数组）

## 原实现的问题

```typescript
// 旧代码
function buildThinkingLevelMap(effortValues: string[] | undefined) {
  // ...
  for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
    if (set.has(level)) {
      map[level] = level;  // ❌ 问题：试图映射 "max"，但 Pi 永远不会请求它
    }
  }
  if (set.has("max") && !set.has("xhigh")) {
    map["xhigh"] = "max";  // ✅ 这部分是对的
  }
}
```

**问题点：**
1. 尝试创建 `max: "max"` 映射，但 Pi 的 ThinkingLevel 不包含 `"max"`，永远不会被使用
2. 没有显式处理 `"minimal"` -> `"low"` 的映射（Anthropic 没有 minimal）
3. `xhigh` 的回退逻辑不够完整（如果既没有 xhigh 也没有 max，应该回退到 high）

## 修复后的实现

```typescript
function buildThinkingLevelMap(effortValues: string[] | undefined): Record<string, string> | undefined {
  if (!effortValues || effortValues.length === 0) return undefined;

  const supported = new Set(effortValues);
  const map: Record<string, string> = {};

  // Map Pi's ThinkingLevel ("minimal" | "low" | "medium" | "high" | "xhigh")
  // to Anthropic's effort values ("low" | "medium" | "high" | "xhigh" | "max")

  // minimal and low -> "low" (Anthropic has no "minimal")
  if (supported.has("low")) {
    map["minimal"] = "low";
    map["low"] = "low";
  }

  // medium -> "medium"
  if (supported.has("medium")) {
    map["medium"] = "medium";
  }

  // high -> "high"
  if (supported.has("high")) {
    map["high"] = "high";
  }

  // xhigh mapping strategy:
  // - Prefer "xhigh" if supported (Opus 4.7+, Fable 5)
  // - Fall back to "max" if supported (Opus 4.6)
  // - Otherwise fall back to "high"
  if (supported.has("xhigh")) {
    map["xhigh"] = "xhigh";
  } else if (supported.has("max")) {
    map["xhigh"] = "max";
  } else if (supported.has("high")) {
    map["xhigh"] = "high";
  }

  return Object.keys(map).length > 0 ? map : undefined;
}
```

## 测试验证

创建了测试用例覆盖不同的 Claude 模型：

✅ Claude Opus 4.6 (支持 max，不支持 xhigh)
✅ Claude Opus 4.7/4.8 (支持 xhigh)
✅ Claude Fable 5 (支持 xhigh)
✅ 有限 effort 支持的模型
✅ 不支持 effort 的模型
✅ 没有 reasoning_options 的模型

所有测试通过。

## 映射表

### Claude Opus 4.6
Models.dev 返回：`["low", "medium", "high", "max"]`

| Pi Level | Anthropic Effort |
|----------|------------------|
| minimal  | low              |
| low      | low              |
| medium   | medium           |
| high     | high             |
| xhigh    | max (回退)       |

### Claude Opus 4.7/4.8/Fable 5
Models.dev 返回：`["low", "medium", "high", "xhigh", "max"]`

| Pi Level | Anthropic Effort |
|----------|------------------|
| minimal  | low              |
| low      | low              |
| medium   | medium           |
| high     | high             |
| xhigh    | xhigh            |

## 影响评估

### 原实现的实际影响
- 不会导致运行时错误
- 在大多数情况下能正常工作
- 但映射逻辑不够清晰，创建了永远不会被使用的映射

### 修复后的改进
- ✅ 更清晰地表达 Pi level 到 Anthropic effort 的映射意图
- ✅ 显式处理所有 Pi 的 ThinkingLevel 值
- ✅ 完整的回退策略（xhigh -> max -> high）
- ✅ 移除了无用的 `max: "max"` 映射
- ✅ 添加了详细的注释说明映射策略

## 提交信息

```
fix: improve effort mapping for Claude models

- Map Pi's ThinkingLevel to Anthropic's effort values correctly
- Handle 'minimal' -> 'low' mapping (Anthropic has no 'minimal')
- Improve 'xhigh' fallback logic:
  * Prefer 'xhigh' if supported (Opus 4.7+, Fable 5)
  * Fall back to 'max' if 'xhigh' not available (Opus 4.6)
  * Fall back to 'high' as last resort
- Remove unused 'max' mapping (Pi's ThinkingLevel doesn't include 'max')
- Add clear comments explaining the mapping strategy
```

## 其他发现

以下部分的实现是**正确的**：

1. ✅ `getEffortValues()` - 正确从 models.dev 的 `reasoning_options` 中提取 effort 值
2. ✅ `modelCompat()` - 正确为 Anthropic 模型设置 `forceAdaptiveThinking: true`
3. ✅ 整体架构符合 Pi 框架和 Claude API 的约定
