const { app, BrowserWindow, shell, Menu, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
if (!app.requestSingleInstanceLock()) app.quit();
let win = null, ready = false;
const PAGE = pathToFileURL(path.join(__dirname, 'index.html')).href;
const MAX = 1024 * 1024 * 1024;
let pending = [];

/* berkas dari "Buka dengan…", seret ke ikon, atau baris perintah */
function filesFrom(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-')).map(a => path.resolve(a)).filter(p => {
    try { const s = fs.statSync(p); return s.isFile() && s.size > 0 && s.size <= MAX; } catch (e) { return false; }
  });
}
async function send(paths) {
  if (!paths.length) return;
  if (!ready || !win) { pending.push(...paths); return; }
  const list = [];
  for (const p of paths) {
    try { const s = await fs.promises.stat(p); list.push({ name: path.basename(p), data: await fs.promises.readFile(p), mtime: s.mtimeMs }); }
    catch (e) { console.error('gagal membaca', p, e); }
  }
  if (list.length) win.webContents.send('rak:open', list);
  if (win.isMinimized()) win.restore();
  win.focus();
}
/* hanya halaman aplikasi sendiri yang boleh meminta berkas */
ipcMain.on('rak:ready', e => {
  if (!e.senderFrame || e.senderFrame.url.split('#')[0] !== PAGE) return;
  ready = true;
  const p = pending; pending = [];
  send(p);
});

function create() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 500, title: 'Rak Baca',
    icon: path.join(__dirname, 'icon.png'), backgroundColor: '#f3efe6', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  // tautan luar dari dokumen dibuka di peramban, bukan di jendela aplikasi
  const external = url => { if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (url.split('#')[0] !== PAGE) { e.preventDefault(); external(url); } });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if ((i.control || i.meta) && i.shift && i.key.toLowerCase() === 'i') e.preventDefault();
  });
  win.on('closed', () => { win = null; ready = false; });
}
app.on('second-instance', (e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } send(filesFrom(argv)); });
app.on('open-file', (e, p) => { e.preventDefault(); send([p]); });
app.whenReady().then(() => {
  // aplikasi tidak butuh kamera, mikrofon, lokasi, dsb.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
  pending.push(...filesFrom(process.argv));
  create();
});
app.on('window-all-closed', () => app.quit());
