# spirits

[English](README.md) | [日本語](README.ja.md) | **简体中文** | [Deutsch (Schweiz)](README.de-CH.md)

spirits 是 [Pi](https://github.com/earendil-works/pi) 的一个分支（fork），用 TypeScript / Bun 重新实现 Prime Intellect 的 [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) 的执行模型。

spirits 不通过逐个工具调用的循环来驱动模型，而是把持久化的 TypeScript REPL（`tsrepl`）作为模型的主要接口：模型编写 TypeScript 单元格（cell），在单元格之间保持状态，调用宿主函数，并可以递归地启动子代理。代理还可以跨会话维护自己的记忆、技能和 code-mode 提示词（Continual Harness）。

> **状态：** M1–M4 已实现：持久化 REPL、单文件二进制分发、同步 `rlm`、Continual Harness。M5（Phase 2 增强）等待基于 dogfooding 的 Go/No-Go 判定。发布标签为 `spirits-v*`；目前仅支持 Linux x86_64。

## 功能

- **持久化 TypeScript REPL** — 主要工具是 `tsrepl`。单元格经 `Bun.Transpiler` 转换后在 `node:vm` 上下文中执行；对 `globalThis` 的赋值跨单元格持久。`return` / `out()` 设置返回值，`print()` 的输出会被捕获，错误会附带出错行和修正提示；`use()` 可导入 `node:` / `bun:` 内置模块和相对于 cwd 的模块；`tool()` 通过宿主工具执行管线调用其他工具。
- **递归子代理** — `await rlm("prompt")` 在进程内运行子代理并以字符串返回其最终回答。深度上限（默认 2）、同一 REPL 的调用串行化、中断向子代理传播，每次调用记录一条 `rlm_usage`（用于 token 与成本统计）。
- **Continual Harness** — `note()` 追加跨会话记忆，`goal()` 管理当前分支的目标，codemode 工具管理技能（`spirits_skill_*`），并可覆盖 code-mode 提示词（`spirits_prompt_set`）。
- **单文件二进制** — 使用 `bun build --compile` 编译。目标机器无需安装 Bun 或 Node。

## 安装

仅支持 Linux x86_64（glibc）。安装器在写入前会校验 SHA256。

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
```

二进制安装到 `~/.spirits/bin/spirits`。如有需要，将其加入 PATH：

```sh
export PATH="$HOME/.spirits/bin:$PATH"
```

可用 `VERSION=0.1.0 sh ...` 指定版本；用 `spirits --version` 查看版本（显示 spirits 版本及内置 Bun 版本）；卸载使用 `... | sh -s -- --uninstall`（安装器只打印 `rm` 命令，不会自动删除文件）。

安装器会解析最新的 `spirits-v*` 发布。若尚无发布，请从源码构建（参见“开发”）。

## 快速开始

```sh
spirits
```

让模型处理任务，它会通过 `tsrepl` 单元格工作：

```ts
// 跨单元格的状态放在 globalThis
globalThis.rows = await (await use("./load.ts")).load();

// 委派：子代理运行自己的 REPL 会话
return await rlm("汇总这些行并以 JSON 返回。");
```

详细说明与限制见 [`packages/spirits/README.md`](packages/spirits/README.md)。

## 已知限制

- 在 `await` 之后开始的同步循环无法中断：timeout 不会触发，整个进程会失去响应（需要重启）。
- 仅支持 Linux x86_64；不内置主题、资源、HTML 导出和 native prebuilds。
- 没有自动更新。升级需要重新运行安装器；`spirits update` 只显示 Pi 的更新提示。
- `rlm` 是同步且串行的。异步 fan-out 将在 M5 评估。
- 配置、会话与认证位于 `~/.spirits/agent/`（若设置了 `PI_CODING_AGENT_DIR` 则以该变量为准）。外部扩展放在 `~/.spirits/agent/extensions/`。

## 安全

模型生成的代码以与 spirits 进程相同的操作系统用户权限运行。vm 上下文和 `node:vm` 不是安全边界。对于不受信任的仓库或自动化场景，请遵循 Pi 的容器化指南，在隔离环境中运行。`use()` 的远程导入默认被拒绝。

## 开发

要求：Bun >= 1.4.0（建议 1.4.2 或更高）。不支持 Node.js。

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
npm ci --ignore-scripts   # 仅从源码运行 Pi 时需要
cd packages/spirits
bun install --frozen-lockfile
bun test
bun run check
```

运行开发构建：

```sh
# 在仓库根目录
bun packages/spirits/bin/spirits.ts

# 或将扩展加载到源码版 Pi
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

设置 `SPIRITS_DEV=1` 可将每个单元格的 description、耗时和结果类型输出到 stderr。

## 文档

- 总体设计：[`docs/spirits-design.md`](docs/spirits-design.md)
- 各阶段设计：[`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md)、[`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md)、[`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md)、[`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md)、[`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- 包详情：[`packages/spirits/README.md`](packages/spirits/README.md)
- 上游 Pi：[pi.dev](https://pi.dev)、[earendil-works/pi](https://github.com/earendil-works/pi)

## 许可证

MIT。上游 Pi 的版权声明保留在 [`LICENSE`](LICENSE) 中。Prime Agent 仅作为架构参考，未复制其代码。

## 致谢

- [Pi](https://github.com/earendil-works/pi)，作者 Mario Zechner 及贡献者 — 上游代理运行框架。
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)，由 Prime Intellect 开发 — RLM 式执行模型的参考架构。
