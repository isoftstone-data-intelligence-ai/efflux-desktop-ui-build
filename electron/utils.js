const { app, BrowserWindow, Menu, screen, dialog,shell,ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');


// 检查端口是否可用的函数
function checkPortAvailable(host, port, timeout = 5000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;
  
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      }, timeout);
  
      socket.connect(port, host, () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(true);
        }
      });
  
      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
        }
      });
    });
}

module.exports = {
  checkPortAvailable,
};
