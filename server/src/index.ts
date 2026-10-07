import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 推断应用根目录：
// - 开发态 src/index.ts        -> <root>/server
// - 生产态 dist/server/src/... -> <root>/server/dist
function inferAppRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const base = path.basename(dir);
    if (base === 'src' || base === 'server' || base === 'dist' || base === 'shared') {
      dir = path.dirname(dir);
    } else {
      break;
    }
  }
  return dir;
}

const appRoot = process.env.APP_ROOT
  ? process.env.APP_ROOT
  : inferAppRoot(__dirname);

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? path.join(appRoot, 'data', 'cue-sheet.sqlite');
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(appRoot, 'web', 'dist');

openDatabase(DB_PATH);

// 首次启动且无任何场次时，放入一个示例空场次，便于直接开始使用
const { listScenes, createScene } = await import('./db.js');
if (process.env.SEED_SAMPLE !== 'false' && listScenes().length === 0) {
  createScene('示例场次（可重命名前先在此走台）');
  console.log('已初始化示例场次');
}

const app = createApp(STATIC_DIR);
app.listen(PORT, () => {
  console.log(`走台提示计划服务已启动: http://localhost:${PORT}`);
  console.log(`数据库: ${DB_PATH}`);
});
