# HotFlow

一个可继续扩展的短视频热点工作台，当前已经从“纯前端演示”升级成了“前端 + Python API”结构。

现在这套版本支持两件核心事：

1. 从真实数据源拉取热点视频
2. 基于选中的热点，生成完整内容包和视频预览

内容包包含：

- 标题
- 开头引子
- 完整口播文案
- 封面文案
- 分镜建议
- 结尾 CTA
- 话题标签
- 页面内视频预览
- 一键复制标题 / 口播 / 封面 / CTA
- 按关键词跨平台搜索热点
- 按“仿爆款强度”生成更接近选中爆款的内容

## 项目结构

- [index.html](/Users/andrewtan/Documents/New%20project/index.html): 前端页面
- [app.js](/Users/andrewtan/Documents/New%20project/app.js): 前端逻辑
- [styles.css](/Users/andrewtan/Documents/New%20project/styles.css): 页面样式
- [server.py](/Users/andrewtan/Documents/New%20project/server.py): 本地 API 与静态文件服务
- [.env.example](/Users/andrewtan/Documents/New%20project/.env.example): 配置示例
- [data/live_trends.example.json](/Users/andrewtan/Documents/New%20project/data/live_trends.example.json): 真实数据导入格式示例

## 运行方式

在终端进入项目目录后执行：

```bash
cd "/Users/andrewtan/Documents/New project"
python3 server.py
```

然后打开：

[http://localhost:8000](http://localhost:8000)

如果提示 `Address already in use`，说明 `8000` 端口被占用了，可以直接换一个端口启动：

```bash
HOTFLOW_PORT=8001 python3 server.py
```

然后打开：

[http://localhost:8001](http://localhost:8001)

## 做成正式网站

当前项目已经兼容 Vercel：

- 静态页面直接部署到根目录
- 热点接口在 [api/trends.py](/Users/andrewtan/Documents/New%20project/api/trends.py)
- 生成接口在 [api/generate.py](/Users/andrewtan/Documents/New%20project/api/generate.py)
- Vercel 配置在 [vercel.json](/Users/andrewtan/Documents/New%20project/vercel.json)

最省事的上线路径：

1. 把项目上传到 GitHub
2. 在 Vercel 导入这个仓库
3. 在 Vercel 里配置环境变量
4. 部署完成后绑定你的自定义域名

### 需要在 Vercel 配的环境变量

- `OPENAI_API_KEY`
- `HOTFLOW_OPENAI_MODEL`
- `HOTFLOW_REMOTE_JSON_URL`
- `HOTFLOW_REMOTE_JSON_HEADERS`
- `APIFY_TOKEN`
- `APIFY_DOUYIN_ACTOR_ID`
- `APIFY_XIAOHONGSHU_ACTOR_ID`
- `APIFY_WECHAT_CHANNELS_ACTOR_ID`

你可以只配其中一部分，至少要有一个真实数据源。

### Vercel 上线步骤

1. 把代码推到 GitHub
2. 登录 Vercel，点 `Add New Project`
3. 选中这个仓库并导入
4. Framework Preset 选 `Other`
5. Build Command 留空
6. Output Directory 留空
7. 部署
8. 部署成功后，在项目设置里添加自定义域名

### 本地和线上的区别

- 本地：继续用 [server.py](/Users/andrewtan/Documents/New%20project/server.py)
- 线上 Vercel：使用 `api/` 目录下的 Python Functions

## 真实数据源接法

后端目前支持三种接法：

### 1. 本地 JSON 导入

把你从第三方采集器、脚本或表格导出的真实热点数据整理成 JSON，放到：

`data/live_trends.json`

格式可以参考：

[data/live_trends.example.json](/Users/andrewtan/Documents/New%20project/data/live_trends.example.json)

示例文件里现在已经放了抖音、小红书、视频号多条热点，你复制成 `live_trends.json` 后就能直接体验全平台搜索。

### 2. 远程 JSON 接口

如果你已经有自己的抓取服务、云函数、Apify webhook 或别的聚合器，可以在 `.env` 里配置：

```bash
HOTFLOW_REMOTE_JSON_URL=https://your-api.example.com/trends
HOTFLOW_REMOTE_JSON_HEADERS={"Authorization":"Bearer xxx"}
```

接口只要返回一个 JSON 数组即可，字段会自动做归一化。

### 3. Apify Actor

如果你后面用 Apify 跑抖音、小红书、视频号采集，可以在 `.env` 里填：

```bash
APIFY_TOKEN=your_token
APIFY_DOUYIN_ACTOR_ID=your_actor_id
APIFY_XIAOHONGSHU_ACTOR_ID=your_actor_id
APIFY_WECHAT_CHANNELS_ACTOR_ID=your_actor_id
```

也可以给每个平台单独传入 Actor 输入：

```bash
APIFY_DOUYIN_INPUT={"limit":10}
APIFY_XIAOHONGSHU_INPUT={"limit":10}
APIFY_WECHAT_CHANNELS_INPUT={"limit":10}
```

## AI 文案生成

如果你想让它真正调用模型生成内容，在 `.env` 里填：

```bash
OPENAI_API_KEY=your_key
HOTFLOW_OPENAI_MODEL=gpt-5.4-mini
```

没配 API Key 时，系统会自动退回模板生成，页面仍然可以正常演示。

## 注意

这个版本已经去掉“前端硬编码热点池”的逻辑，但真实热点是否能拉到，取决于你有没有配置可用的数据源。

## 关于“实时刷新爆款”

页面现在已经支持：

- 按播放量 / 点赞量 / 分享量 / 综合热度排序
- 自动刷新
- 每个类别当前爆款榜

但要注意：

如果你没有接 `HOTFLOW_REMOTE_JSON_URL` 或 Apify Actor，它刷新到的仍然只是本地 `data/live_trends.json`。

也就是说：

- 你想要真正的实时爆款：必须接实时采集源
- 你现在看到的自动刷新：只是自动重新拉一次当前配置的数据源
