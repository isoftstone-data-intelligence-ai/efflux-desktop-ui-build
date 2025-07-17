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


// 等待端口可用的函数
async function waitForPort(host, port, maxAttempts = 60, interval = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`检查端口 ${host}:${port} 是否可用... (尝试 ${i + 1}/${maxAttempts})`);
    const isAvailable = await checkPortAvailable(host, port, 2000);
    if (isAvailable) {
      console.log(`端口 ${host}:${port} 已可用`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  console.log(`端口 ${host}:${port} 在 ${maxAttempts} 次尝试后仍未可用`);
  return false;
}


// 日志记录功能
function setupLogging(isDev) {
  const logDir = path.join(app.getPath('userData'), 'logs');
  const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
  
  // 确保日志目录存在
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // 重写 console.log 和 console.error
  const originalLog = console.log;
  const originalError = console.error;
  
  function writeToFile(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    
    try {
      fs.appendFileSync(logFile, logEntry);
    } catch (err) {
      // 如果写入日志文件失败，至少保留原始控制台输出
      originalError('Failed to write to log file:', err);
    }
  }
  
  console.log = function(...args) {
    originalLog(...args);
    writeToFile('INFO', ...args);
  };
  
  console.error = function(...args) {
    originalError(...args);
    writeToFile('ERROR', ...args);
  };
  
  console.warn = function(...args) {
    originalLog(...args);
    writeToFile('WARN', ...args);
  };
  
  // 记录应用启动信息
  console.log('=== 应用启动 ===');
  console.log('应用路径:', app.getAppPath());
  console.log('用户数据路径:', app.getPath('userData'));
  console.log('日志文件路径:', logFile);
  console.log('是否为开发模式:', isDev);
  console.log('平台:', process.platform);
  console.log('架构:', process.arch);
}


module.exports = {
  checkPortAvailable,
  waitForPort,
  setupLogging,
};
