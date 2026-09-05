# Tetra Colors

Tetra Colors 是一款开源、自托管的多人浏览器卡牌游戏。它不需要账号，输入昵称即可创建房间，再把 5 位房间码发给朋友。当前界面为简体中文，手机和桌面浏览器都能直接游玩。

- 在线版本：<https://tetra-colors.gt610.dpdns.org>
- 开源许可：[AGPL-3.0](LICENSE)

## 目前已有功能

- 每个房间支持 2 至 6 个席位。房主可以邀请真人玩家，也可以添加轻松、标准或敏锐难度的电脑玩家。
- 一局从每人 7 张牌开始，包含数字牌、跳过、反向、抽二、换色和换色抽四。服务端会检查出牌是否合法，包括换色抽四的使用限制。
- 每个回合限时 30 秒。玩家可以点击牌堆抽牌；抽到可出的牌后，可以出牌或结束回合。
- 开局发牌、抽牌和出牌都有桌面动画，跳过、换向与换色也有对应反馈。动画播放期间会暂时锁定操作，避免画面和实际牌局错位。
- 手牌会按可用宽度自动重叠。手机支持左右滑动，桌面端可使用横向滚动条；牌很多时仍能看到每张牌的可操作区域。
- 四种颜色各自配有几何图形，不能出的牌会降低亮度。界面支持系统的“减少动态效果”设置。
- 断线后的 30 秒内可以凭当前标签页保存的会话回到原座位。超过时间后，进行中的座位会交给电脑接管；房间不再有真人席位时会自动销毁。

## 基本玩法

1. 输入昵称并创建房间，或使用朋友给出的房间码加入。
2. 房间至少有两个席位后，房主即可开始对局。
3. 轮到自己时，打出与当前颜色、数字或动作类型相同的牌。换色牌可以指定接下来的颜色。
4. 没有可出的牌就点击牌堆。抽到的牌可以立即打出时，本回合只能选择这张牌或结束回合。
5. 最先清空手牌的玩家获胜。房主可以保留原有席位再开一局。

## 本地运行与实时预览

本地需要安装 [Bun](https://bun.sh/)。先安装依赖并启动 Worker。

```sh
git clone https://github.com/GT-610/tetra-colors.git
cd tetra-colors
bun install
bun run dev
```

Wrangler 通常会在 `http://127.0.0.1:8787` 提供完整应用。需要边改边看时，让 Worker 保持运行，再开一个终端启动 Vite。

```sh
bun run client:dev
```

浏览器打开 Vite 输出的地址，通常是 `http://localhost:5173`。React 和 CSS 修改会直接热更新，`/api` 与 `/ws` 请求会转发到 8787 端口的本地 Worker。

## 代码从哪里看起

- `src/logic/` 保存纯游戏规则。这里不依赖 Worker 运行时，随机数通过参数传入，适合单独测试。
- `src/protocol.ts` 定义客户端和服务端共用的消息格式。
- `src/room-do.ts` 管理权威房间状态，包括校验、计时、电脑玩家和每位玩家收到的牌局快照。
- `src/worker.ts` 处理静态资源、HTTP API 与 WebSocket 路由。
- `client/` 是 React 客户端，只发送玩家意图并显示服务端快照。

牌局结果始终由服务端决定。其他玩家的手牌只会以数量出现在个人快照中，客户端拿不到隐藏牌。房间使用 Durable Object 保存活动状态，并通过事件驱动的 WebSocket 同步，不需要轮询。

项目不会创建账号或跨房间身份，也不会收集分析数据或进行用户跟踪。页面没有广告，图片和字体也不依赖外部资源。昵称及房间会话只服务于当前房间。

## 检查与部署

提交前需运行下面这些检查。

```sh
bun run typecheck
bun run lint
bun run test
git diff --check
```

`bun run test` 会先构建客户端。测试覆盖纯规则和协议解析，也会运行真实房间、WebSocket 与限流场景，并用模拟牌局检查状态。需要单独检查生产构建时，可以运行 `bun run build`。

自托管到 Cloudflare 时，先在 `wrangler.jsonc` 中修改 Worker 名称，再登录并部署。

```sh
bunx wrangler login
bun run deploy
```

Durable Object 绑定和迁移已经写在配置中。当前在线版本由 Cloudflare 在 `main` 更新后自动构建；Fork 用户可以为自己的仓库配置 Git 集成，也可以继续使用 Wrangler 手动部署。密钥只应放在环境变量或部署平台的密钥设置中。

更多脚本和仓库约定见 [package.json](package.json) 与 [AGENTS.md](AGENTS.md)。

## License

Tetra Colors 使用 GNU Affero General Public License v3.0，完整条款见 [LICENSE](LICENSE)。
