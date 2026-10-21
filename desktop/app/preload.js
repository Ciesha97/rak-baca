// Jembatan aman: halaman hanya bisa menerima berkas yang dibuka pengguna lewat sistem operasi
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rakDesktop', {
  onOpen: cb => ipcRenderer.on('rak:open', (e, list) => cb(list.map(f => ({ name: String(f.name), data: f.data, mtime: f.mtime })))),
  ready: () => ipcRenderer.send('rak:ready'),
});
