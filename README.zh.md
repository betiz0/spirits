# spirits

[English](README.md) | [日本語](README.ja.md) | **简体中文** | [Deutsch (Schweiz)](README.de-CH.md)

spirits 是运行在官方 [Pi](https://github.com/earendil-works/pi) 固定 artifact 之上的扩展包与轻量启动器，用 TypeScript / Bun 重新实现 Prime Intellect 的 [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) 的执行模型。它不包含 Pi 的源码：`~/.spirits/managed-pi` 存放固定的官方 Pi 发布，编译后的 `spirits` 先校验这一套，再加载 spirits 扩展启动它。

spirits 不通过逐个工具调用的循环来驱动模型，而是把持久化的 TypeScript REPL（`tsrepl`）作为模型的主要接口：模型编写 TypeScript 单元格（cell），在单元格之间保持状态，调用宿主函数，并可以递归地启动子代理。代理还可以跨会话维护自己的记忆、技能和 code-mode 提示词（Continual Harness）。

> **状态：** M1–M4 已实现：持久化 REPL、单文件二进制分发、同步 `rlm`、Continual Harness。M5（Phase 2 增强）等待基于 dogfooding 的 Go/No-Go 判定。发布标签为 `spirits-v*`；目前仅支持 Linux x86_64。

## 功能

- **持久化 TypeScript REPL** — 主要工具是 `tsrepl`。单元格经 `Bun.Transpiler` 转换后在 `node:vm` 上下文中执行；对 `globalThis` 的赋值跨单元格持久。`return` / `out()` 设置返回值，`print()` 的输出会被捕获，错误会附带出错行和修正提示；`use()` 可导入 `node:` / `bun:` 内置模块和相对于 cwd 的模块；`tool()` 通过宿主工具执行管线调用其他工具。
- **递归子代理** — `await rlm("prompt")` 在进程内运行子代理并以字符串返回其最终回答。深度上限（默认 2）、同一 REPL 的调用串行化、中断向子代理传播，每次调用记录一条 `rlm_usage`（用于 token 与成本统计）。
- **Continual Harness** — `note()` 追加跨会话记忆，`goal()` 管理当前分支的目标，codemode 工具管理技能（`spirits_skill_*`），并可覆盖 code-mode 提示词（`spirits_prompt_set`）。
- **会话 TODO 与非破坏性清空** — `manage_todos` 管理与当前会话分支绑定的 TODO，并在编辑器和页脚之间显示面板；`/spirits-clear` 在保留模型、思考等级和扩展状态的同时开始新的对话分支。
- **双模型分流** — `/model spirits/auto` 只需选择一个模型，每个请求会被分流到 normal 或 strong。只有 OpenSpec 的评审与深度验证两个技能使用 strong(设置中的 `models.strong`)，其余仍用默认模型。
- **单文件二进制** — 启动器使用 `bun build --compile` 编译，不含 Pi 源码。首次启动会下载固定的主机套件并校验校验和，然后启动；目标机器无需安装 Bun 或 Node。

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

已安装的二进制用 `spirits update` 更新：

```sh
spirits update           # 换成最新 stable，并安装该版本的 managed 套件
spirits update self      # 同一含义的显式写法
spirits update --force   # 已是最新时也重新下载
```

`spirits update` 校验 SHA256，用原子 rename 替换 `~/.spirits/bin/spirits`，随后安装更新目标发布的 managed 套件。已安装版本等于或高于最新 stable（例如预发布版）时打印 `spirits <version> is already up to date`，不动二进制，但仍会安装套件。`PI_OFFLINE=1`（也接受 `true` / `yes`）会在不访问网络的情况下拒绝更新。更新请求在 10 秒没有收到数据即失败；用 `SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS`（正整数秒）覆盖。

`spirits update` 只接受上面这些形式。`--all`、`--extensions`、`--models`、`-h`、未知选项，以及 `self` / `pi` 之外的位置参数都会被拒绝并返回非零退出码，因为静默透传会让无法处理的标志看起来像更新成功。**从 0.7.x 迁移的用法是 `spirits update`**：`spirits update --all` 不再是自更新形式。

主机与 spirits 扩展包跟随 spirits 发布，所以 `spirits update` 也是更新它们的方式。下面两件事在它之外：

```sh
spirits managed-pi update                                # 不换二进制，只更新固定的主机套件
~/.spirits/managed-pi/current/pi/pi update --extensions  # 主机的 package 与 model catalog
```

第二条命令在主机可执行文件上运行：启动器总是把扩展包放在你的参数之前，所以 `spirits -- update ...` 是给模型的提示，而不是主机命令。主机的其他命令（`install`、`remove`、`uninstall`、`list`、`config`、`auth`、`mcp`）同理：`spirits <命令>` 会拒绝并打印应当运行的主机可执行文件路径。

重新运行 `install.sh` 依旧有效：解析最新版时若已安装版本匹配则跳过下载，打印 `spirits <version> is already up to date`。用 `VERSION=x.y.z` 可强制重新下载并安装。0.1.0 二进制早于自更新功能，从 0.1.0 升级需要先跑一次 `install.sh`；之后就可以用 `spirits update`。

主题由主机 artifact 提供。启动器不再放置 `~/.spirits/bin/theme/`；旧版本留下的目录不会被使用，可以删除。

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

## 内置技能

spirits 内置了一组安装后即可使用的技能。启动时会写入 `<agentDir>/bundled-skills/<spirits 版本>/`，并交给 pi 的技能搜索；不会写入 `<agentDir>/skills/`。

- 内置技能需要显式启动，例如 `/skill:sprt-architecture-guards`。大多数内置技能带有 `disable-model-invocation: true`，模型不会自动选择；`sprt-opsx-review-change` 是例外，模型可以自动选择。
- 如果 `<agentDir>/skills/<名称>/` 中存在同名用户技能，则始终优先使用用户版本。pi 采用用户版本并显示冲突警告，内置副本会被跳过。
- 使用 `SPIRITS_BUNDLED_SKILLS=0` 可禁用全部内置技能(未设置或其他值表示启用)。禁用时既不写入也不提供技能路径。
- 更新 spirits 后，要获取新的内置内容需要重新启动 spirits。内置内容嵌在运行中的二进制文件里，因此 `/reload` 只会重新写入当前运行版本的目录树。旧版本目录只有在 7 天以上未被使用时，才会在写入时被删除。
- `bundled-skills/` 由 spirits 管理。请勿编辑其中的文件；自己的技能请放在 `<agentDir>/skills/`。

## 模型分流

OpenSpec 工作流中只有两个步骤需要更强的模型：评审变更的 `sprt-opsx-review-change` 和深度验证的 `sprt-opsx-verify-deep`。与其手动切换模型再忘记切回，不如选择一个模型，由 spirits 按请求分流。

- 用 `/model spirits/auto` 选择分流模型。默认模型设置、`--model` 和 `/model` 的行为都不变；直接选择物理模型的会话不会被分流。
- strong 的目标写在 `settings.json`(`~/.spirits/agent/settings.json`，或项目的 `.pi/settings.json`)：

  ```json
  { "models": { "strong": "anthropic/claude-opus-4-7" } }
  ```

  只写模型 ID(`"claude-opus-4-7"`)时，用当时的默认 provider 解析。但 `models.strong` 请写成 `provider/id`：`save` 可能把默认 provider 改成 `spirits`，那样省掉 provider 的 strong 就解析不出来了。`models` 是 spirits 的键，pi 保存其他设置时会保留它。
- propose、apply、verify、archive 走 normal，路由到默认 provider 与默认模型。默认无法解析时改用最近一次成功响应的模型，并提示一次。运行 `sprt-opsx-review-change` 或 `sprt-opsx-verify-deep` 期间的请求走 strong，run settle 后回到**当前锁定的角色**(Escape 中断或出错也会回到)。
- 用 `/spirits-role <normal|strong>` 锁定角色：锁定在后续输入中持续生效，锁定另一个角色时切换。`/reload` 和重新打开都会读回会话自己的 role 记录，所以本会话锁定的角色会跨过它们保留；`models.role` 只是没有 role 记录的会话的默认值。选择物理模型期间不分流，徽章显示 `[off]`（`/spirits-role status` 会点名导致 off 的模型）；锁定从切回 `spirits/auto` 之后的请求开始生效。要选中那个模型，可能需要切换 model selector 的选择范围（`Tab`）或者用 `/scoped-models`：把会话限定在自己的模型列表里时，列表外的模型不会出现在 selector 中。
- 用 `/spirits-role save`，或者从设置列表（`/spirits-role` 不带参数）保存会话当前持有的选择。列表按 `use normal`、`use strong`、`save` 的顺序打开。`use` 行一次 Enter 先锁定会话再保存，等同于先执行 `/spirits-role <normal|strong>` 再执行 `/spirits-role save` 的两次写入；`save` 只写默认值，不动锁定。这些行在操作前显示与 global 设置的差异，在操作后显示写进文件的内容。保存成立或没有差异时，列表关闭并发送信息通知；失败时，以及锁定成立但保存失败时，列表保持打开并把原因留在这两行上。操作行只响应 Enter：Space、鼠标点击、`save` 后面的空行，以及你把列表确认键改到别处时的任何键，都不会动文件。正在运行的会话什么都不变——model selector、锁定、对话都停在原处。只保存就关闭列表时不会重载；`use` 行和普通的设置变更在关闭列表时重载一次，如果宿主拒绝重载，通知会说明保存已成立、重载未完成。
- `save` 写的是 **pi 的 global 设置文件**（`~/.spirits/agent/settings.json`），不写 project 文件，也不写会话记录。这些键是**新会话**启动时的默认值，而 pi 取模型的顺序是：先看 `--models` / `--model` 和会话自己的选择范围，再看 `defaultProvider` / `defaultModel`，`models.role` 则是没有 role 记录的会话的默认锁定。project 的 `.pi/settings.json` 在那里仍然继续覆盖它们，所以保存之后，普通列表行和 `/spirits-role status` 依旧报告 project 的生效值，文件里的值只出现在 `save` 这一行。
- 保存 `spirits/auto` 需要 global 文件自己能解析的 `models.normal`，因为还没问过任何问题的会话没有可依赖的成功响应。没有它时，`save` 只写角色，不碰 `defaultProvider` / `defaultModel`，并在这一行和通知里说明原因。**物理**模型总是能保存：以物理模型启动的会话就是没有分流的普通会话。想让新会话不经分流就能应答，就往默认值里留一个物理模型——`save` 的安全检查之外的 virtual 默认值会让 normal 无可解析，新会话的第一个请求会以错误结束。
- 不是交互终端的地方做的是同一次写入，只是不说话：`--print` 模式下的 `/spirits-role save` 更新文件且不输出任何东西。要核对请看那个文件，或者在会读取该设置的会话里看 `/spirits-role status`。
- 没有 `models.strong` 时静默保持 normal。已配置但不可用的目标(ID 不存在、provider 没有凭据)会回退到 normal，并在同一个 run 内只提示一次。
- 徽章显示**下一个请求**将运行的角色，不是最近一次请求的记录。重画的时机是它背后的状态可能改变的那一刻：会话开始、你发送输入、在分支之间移动、锁定角色、一个 run 落幕时，以及主机的模型或 thinking 级别选择改变时。状态有 `[normal]` 和 `[strong]`，能解析到级别时紧随其后（`[strong high]`），选择物理模型期间是 `[off]`，分流生效但没有任何模型可解析时是 `[!]`。
- 角色旁边，在另一个 status key 上，页脚用不带 provider 的模型 ID 写出将会应答的物理模型，超过 24 字符时截成前 23 字符加 `…`（`abcdefghijklmnopqrstuvw…`）。分流无效或没有可应答的模型时这里什么都不写，因为主机自己的统计行已经写出了会话所在的模型。
- 跨 run 延续的步骤，在你重新打开当时正处于该步骤的会话时（`--resume`、fork，或者从分支末尾开始）会回来，徽章也由它绘制，所以重开后的第一个输入就按该步骤定下的角色运行。手工编辑 `settings.json` 要经过扩展重载（`/reload`）才影响徽章与分流，因为运行中的扩展只在加载时读取一次设置。
- `/spirits-role status` 显示分流状态、锁定、进行中的步骤、最近一次请求，以及 normal / strong 的解析结果。

## 已知限制

- 在 `await` 之后开始的同步循环无法中断：timeout 不会触发，整个进程会失去响应（需要重启）。
- 仅支持 Linux x86_64。
- role 徽章画在扩展的 status 行上，因此与主机的模型显示不在同一行，也不共享其显示位置与是否清除。role 命令是 `/spirits-role ...`；主机的 `/model` 没有 role 参数。
- 在选择物理模型的会话里启动一个期待角色的步骤时会先询问：询问会说清这个角色现在不会被使用，并给出重新启用分流的做法，等待 10 秒。倒计时结束或者选择继续，输入就会发送；选择停止或者按 Escape，输入不发送，步骤回到该输入之前的状态。询问只出现在交互式终端，由扩展发出的输入不会触发，所以脚本驱动的会话不会被拦下。
- 主机的命令无法通过 `spirits` 运行：`spirits update <其他参数>`、`spirits install`、`spirits list` 等会被拒绝并给出主机可执行文件路径。启动器先加载扩展包，而主机只在自身第一个参数是命令时才 dispatch。
- 没有自动更新。升级用 `spirits update` 或重新运行安装器。
- 首次启动需要网络：把固定的主机 tarball（Pi 1.5.0 为 58,876,253 字节）与 spirits 扩展包下载到 `~/.spirits/managed-pi`，安装后占用 182 MB。之后在本地校验已安装的套件，损坏时用 `spirits managed-pi repair` 重建。`PI_OFFLINE=1` 作用于 `spirits update`，不作用于 managed 套件。
- `rlm` 是同步且串行的。异步 fan-out 将在 M5 评估。
- 配置、会话与认证位于 `~/.spirits/agent/`（若设置了 `SPIRITS_CODING_AGENT_DIR` 则以该变量为准）。外部扩展放在 `~/.spirits/agent/extensions/`。
- **BREAKING**：不再读取旧的 `PI_CODING_AGENT_DIR`。默认路径 `~/.spirits/agent/` 不变，现有数据可继续使用。
- **BREAKING**：编译后的二进制文件不再读取启动目录中的 `.env`、`.env.local` 或 `.env.<NODE_ENV>` 文件。请在 shell 中用 `export` 设置 API 密钥等环境变量，或在启动命令前指定。
- install 遥测与 Pi 名义的 provider 请求头默认关闭。无法通过 `settings.json` 开启；请使用 `PI_TELEMETRY=1` 显式启用。

## 安全

模型生成的代码以与 spirits 进程相同的操作系统用户权限运行。vm 上下文和 `node:vm` 不是安全边界。对于不受信任的仓库或自动化场景，请遵循 Pi 的容器化指南，在隔离环境中运行。`use()` 的远程导入默认被拒绝。

## 开发

要求：Bun >= 1.4.0（建议 1.4.2 或更高）。Node.js 只用于 lockfile 门禁和少量脚本。

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
bun install --frozen-lockfile   # 一个 workspace，一个 bun.lock
bun run check                   # biome + scripts 的 tsc + packages/spirits 的 tsc，不改写文件
bun run fix                     # 会改写文件的版本
cd packages/spirits && bun test
```

运行开发构建：

```sh
# 在仓库根目录
bun packages/spirits/bin/spirits.ts
```

源码运行不会获取任何东西，因此需要先有 managed 套件：

```sh
bun packages/spirits/bin/spirits.ts managed-pi install
# 或者指向本地构建的两个产物
SPIRITS_MANAGED_PI_MANIFEST_URL=http://host/manifest.json bun packages/spirits/bin/spirits.ts -- --version
```

主机类型取自被钉住的 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui` devDependencies，所以 `tsc` 是针对主机自带的声明检查扩展。构建启动器不需要 Pi 源码：`bun scripts/build-binaries.ts --version <version>` 只编译 `packages/spirits/bin/spirits.ts`。

设置 `SPIRITS_DEV=1` 可将每个单元格的 description、耗时和结果类型输出到 stderr。

## 文档

- 总体设计：[`docs/spirits-design.md`](docs/spirits-design.md)
- 启动路径与 managed 套件：[`docs/spirits-default-launch.md`](docs/spirits-default-launch.md)、[`docs/spirits-managed-pi.md`](docs/spirits-managed-pi.md)
- 主机版本升级与回滚：[`docs/spirits-host-upgrade.md`](docs/spirits-host-upgrade.md)
- 各阶段设计:[`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md)、[`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md)、[`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md)、[`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md)、[`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- 包详情：[`packages/spirits/README.md`](packages/spirits/README.md)
- 主机 Pi：[pi.dev](https://pi.dev)、[earendil-works/pi](https://github.com/earendil-works/pi)

## 许可证

MIT。上游 Pi 的版权声明保留在 [`LICENSE`](LICENSE) 中；该文件也记录了 spirits 是运行在 Pi 之上的独立作品，而非其源码的衍生作品。Prime Agent 仅作为架构参考，未复制其代码。

## 致谢

- [Pi](https://github.com/earendil-works/pi)，作者 Mario Zechner 及贡献者 — 上游代理运行框架。
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)，由 Prime Intellect 开发 — RLM 式执行模型的参考架构。
