# 走台提示计划（Cue Sheet）

供剧场排练使用的走台提示计划 Web 应用。编导按**场次**录入提示动作（开始秒数、持续秒数、占用的一项设备/岗位、前置动作），页面实时显示草稿时间轴与可定位的冲突；无冲突的草稿可发布为**不可变版本**，排练视图只读取最新已发布版本。

技术栈：**TypeScript + React（Vite）+ Node.js（Express）+ SQLite（better-sqlite3）**。

## 功能与规则

- 按场次独立编排与校验，场次之间互不影响。
- 动作占用区间为**左闭右开** `[start, start+duration)`，单位秒；首尾相接不算重叠。
- 同一设备/岗位的时间区间不得重叠；前置动作必须先结束，本动作才能开始。
- 以下**结构性错误会阻止保存草稿**，并逐条说明原因：
  - 开始时刻为负 / 非数字；
  - 持续时长非正 / 非数字；
  - 缺少编号、编号重复、缺少资源；
  - 前置动作引用缺失；
  - 前置依赖形成环形（含自依赖）。
- 资源重叠、前置时序错误属于**冲突**：草稿可以保存，但**不能发布**。
- 草稿带单调递增的修订号 `rev`（乐观锁）：编辑器先读取 `rev`，保存时带上；若期间草稿已被他人更新，服务端返回 **409 冲突且不覆盖**较新草稿，前端提示后可重新载入。
- 只有**完全无冲突**的草稿才能发布；每次发布生成只增不改的版本号（SQLite 触发器禁止 UPDATE/DELETE）。
- 排练视图只调用「最新已发布版本」接口；发布失败不会影响它。尚未发布时显示明确的空状态，并引导去发布。
- 冲突列表中的每条问题都带「定位」按钮，可滚动定位到对应动作行；时间轴上冲突动作以红色高亮。

## 一条命令启动（Docker）

需要本机装有 Docker 与 Docker Compose v2。

```bash
docker compose up --build
```

该命令会自动：

1. 安装全部前后端依赖（工作区 monorepo）；
2. 编译共享校验库、后端与前端；
3. 启动服务，并在首次启动时**自动建库建表**（SQLite 文件位于数据卷）；
4. 在库为空时插入一个示例空场次（可用 `SEED_SAMPLE=false` 关闭）。

启动后访问：

- 应用首页（编导工作台与场次列表）：<http://localhost:8080/>
- 某场次的编辑器：首页进入，或 `http://localhost:8080/scenes/<场次ID>`
- 排练视图：`http://localhost:8080/rehearsal/<场次ID>`
- 健康/接口前缀：`http://localhost:8080/api/...`

停止：`Ctrl+C`（加 `-d` 可后台运行；`docker compose down` 停止，`-v` 会同时删除数据卷）。

## 配置（环境变量）

在 `docker-compose.yml` 中修改即可：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务监听端口（容器内）。改宿主机端口请改 compose 的 `ports` 左侧。 |
| `DB_PATH` | `/app/data/cue-sheet.sqlite` | SQLite 数据库文件路径；目录已挂载为命名卷 `cue-sheet-data`。 |
| `STATIC_DIR` | `/app/web/dist` | 前端静态资源目录。 |
| `SEED_SAMPLE` | `true` | 首次启动且无场次时是否插入一个示例空场次。 |
| `APP_ROOT` | 自动推断 | 应用根目录（本地非容器运行时使用）。 |

## 本地开发（不用 Docker）

要求 Node.js ≥ 20。

```bash
npm install          # 安装全部工作区依赖

# 终端 1：后端（http://localhost:8080，自动打开 SQLite）
npm run dev:server

# 终端 2：前端 Vite（http://localhost:5173，/api 代理到 8080）
npm run dev:web
```

本地不设置 `DB_PATH` 时，数据库默认写到仓库根目录 `data/cue-sheet.sqlite`（已被 gitignore）。

生产式本地构建与运行：

```bash
npm run build
npm start            # node dist/server/src/index.js，同时托管 web/dist
```

共享校验逻辑有一套内置测试（左闭右开、环检测、各类阻止/冲突规则）：

```bash
npm test -w shared
```

## HTTP 接口摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scenes` | 场次列表（含最新版本号） |
| POST | `/api/scenes` | 新建场次（同时建立 `rev=0` 空草稿） |
| GET | `/api/scenes/:id/draft` | 读取草稿与当前 `rev`、校验结果 |
| PUT | `/api/scenes/:id/draft` | 保存草稿；body：`{baseRev, cues}`。结构错误 → 422；修订号过期 → 409 |
| POST | `/api/scenes/:id/validate` | 只校验不落库 |
| POST | `/api/scenes/:id/publish` | 草稿无冲突时发布为新版本，否则 422（失败不产生版本） |
| GET | `/api/scenes/:id/published/latest` | **排练视图使用**：最新已发布版本；未发布返回 `{published:false}` |
| GET | `/api/scenes/:id/published` | 已发布版本清单 |

Cue 对象示例：

```json
{
  "id": "Q3",
  "name": "追光收",
  "start": 32,
  "duration": 6,
  "resource": "追光1",
  "prerequisite": "Q1"
}
```

## 目录结构

```
shared/   前后端共用的领域类型与校验器（含单元测试）
server/   Express + better-sqlite3，API、乐观锁、不可变发布
web/      React + Vite：场次首页、编导编辑器、排练视图
Dockerfile / docker-compose.yml   一条命令启动
```
