const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 示例：向主进程发送消息
    sendMessage: (channel, data) => {
        ipcRenderer.send(channel, data);
    },
    // 示例：从主进程接收消息
    receiveMessage: (channel, func) => {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
});