// 本機伺服器：提供 public/ 網頁，並（若電腦有安裝 ffmpeg）提供不受瀏覽器記憶體限制的轉檔 API
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 5500;
const LAN = process.argv.includes('--lan');          // 加 --lan 讓同網路的手機也能連
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'; // 也可用環境變數指定 ffmpeg 完整路徑
const TMP = path.join(os.tmpdir(), 'mov2mp4');
const TTL_MS = 30 * 60 * 1000;                       // 轉好的檔案保留 30 分鐘

fs.mkdirSync(TMP, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// ---- 偵測 ffmpeg ----
const probe = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
const HAS_FFMPEG = !probe.error && probe.status === 0;

// ---- 暫存檔清理 ----
const rm = f => fs.unlink(f, () => {});
function sweep() {
  const now = Date.now();
  for (const f of fs.readdirSync(TMP)) {
    const p = path.join(TMP, f);
    try { if (now - fs.statSync(p).mtimeMs > TTL_MS) rm(p); } catch (_) {}
  }
}
for (const f of fs.readdirSync(TMP)) rm(path.join(TMP, f)); // 啟動時清空上次殘留
setInterval(sweep, 5 * 60 * 1000).unref();

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

// ---- API ----
function apiConvert(req, res) {
  if (!HAS_FFMPEG) return json(res, 501, { error: '伺服器電腦沒有安裝 ffmpeg' });
  const id = crypto.randomUUID();
  const inPath = path.join(TMP, id + '.in');
  const outPath = path.join(TMP, id + '.mp4');
  const ws = fs.createWriteStream(inPath);
  let aborted = false;

  req.on('aborted', () => { aborted = true; ws.destroy(); rm(inPath); });
  req.pipe(ws);

  ws.on('finish', () => {
    if (aborted) return;
    // 只保留影像與音訊（排除 iPhone MOV 的中繼資料軌），不重新編碼。
    // -strict unofficial：ffmpeg 預設不會把 Dolby Vision 設定區塊（dvvC）寫進 MP4，
    // 不加的話 iPhone HDR 影片會遺失 Dolby Vision 標記（HLG 基礎層仍在）。
    const ff = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-i', inPath,
      '-map', '0:v', '-map', '0:a?', '-c', 'copy',
      '-map_metadata', '0',          // 保留拍攝時間（相簿 App 用來排序）；不含定位與機型等資料
      '-strict', 'unofficial', '-movflags', '+faststart', outPath]);
    let log = '';
    ff.stderr.on('data', d => { log += d.toString(); if (log.length > 20000) log = log.slice(-10000); });
    ff.on('error', e => { rm(inPath); json(res, 500, { error: 'ffmpeg 執行失敗：' + e.message }); });
    ff.on('close', code => {
      rm(inPath);                                     // 原始上傳檔立即刪除
      if (code !== 0) {
        rm(outPath);
        const tail = log.trim().split('\n').slice(-3).join(' / ');
        return json(res, 500, { error: '轉換失敗（可能檔案損毀）：' + tail });
      }
      const m = /Stream #\d+:\d+.*Video:\s*(\w+)/.exec(log);
      json(res, 200, { id, size: fs.statSync(outPath).size, codec: m ? m[1].toLowerCase() : '' });
    });
  });
  ws.on('error', e => json(res, 500, { error: '寫入暫存檔失敗：' + e.message }));
}

function apiDownload(req, res, id, name) {
  if (!/^[0-9a-f-]{36}$/.test(id)) { res.writeHead(400); return res.end('Bad id'); }
  const p = path.join(TMP, id + '.mp4');
  fs.stat(p, (err, st) => {
    if (err) { res.writeHead(404); return res.end('檔案已過期或不存在，請重新轉換'); }
    const safe = (name || 'video.mp4').replace(/[\r\n"]/g, '_');
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(safe)}`,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(p).pipe(res);
  });
}

// ---- 路由 ----
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && u.pathname === '/api/status') return json(res, 200, { ffmpeg: HAS_FFMPEG });
  if (req.method === 'POST' && u.pathname === '/api/convert') return apiConvert(req, res);
  if (req.method === 'GET' && u.pathname.startsWith('/api/download/'))
    return apiDownload(req, res, u.pathname.slice('/api/download/'.length), u.searchParams.get('name'));

  let urlPath = decodeURIComponent(u.pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.requestTimeout = 0;   // 大檔上傳不要被逾時中斷
server.listen(PORT, HOST, () => {
  // 注意：這行文字格式會被 launch.json 的 serverReadyAction 用來自動開啟瀏覽器
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(HAS_FFMPEG ? '已偵測到 ffmpeg：可使用「伺服器模式」（無檔案大小限制）'
                         : '未偵測到 ffmpeg：「伺服器模式」不可用（安裝 ffmpeg 後重新啟動即可）');
  if (LAN) {
    for (const list of Object.values(os.networkInterfaces()))
      for (const n of list)
        if (n.family === 'IPv4' && !n.internal) console.log(`手機請連：http://${n.address}:${PORT}`);
  }
});