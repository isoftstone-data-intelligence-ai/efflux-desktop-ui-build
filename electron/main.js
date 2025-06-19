const { app, BrowserWindow, Menu, screen, dialog,shell,ipcMain } = require('electron');
const path = require('path');
var isDev = require('electron-is-dev');
var isDev = true;

let mainWindow;
var time;

function createWindow() {
  // 获取主屏幕信息
  const { workAreaSize } = screen.getPrimaryDisplay();
  const { width, height } = workAreaSize;

  var minWidth = 1280;
  var minHeight = 600;

  // 计算 80% 的宽度和高度
  let windowWidth = Math.round(width * 0.85);
  let windowHeight = Math.round(height * 0.85);

  if (windowWidth < minWidth) windowWidth = minWidth;
  if (windowHeight < minHeight) windowHeight = minHeight;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: minWidth,
    minHeight: minHeight,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);

  // 加载 loading
  // mainWindow.loadURL(`file://${path.join(__dirname, 'loading.html')}`);

  time = setTimeout(() => {
    renderPage();
  }, 0);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    console.log('Application is quitting...');
    isQuitting = true;
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  console.log('All windows closed');
  if (process.platform!== 'darwin') {
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  }
});
    

function renderPage() {
  if (time) {
    clearInterval(time);
  }

  var url = isDev ? 'http://localhost:3000' : `http://47.236.204.213:3003`;
  mainWindow.loadURL(url);

  if(isDev){
    mainWindow.webContents.openDevTools();
  }

  // 拦截新窗口事件
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {

    // 外部链接
    if (!isExternalUrl(url)) {
      shell.openExternal(url)
      return 
    }

     // 在应用内新窗口打开内部链接
     const newWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    newWindow.loadURL(url);
    return { action: 'deny' }; // 始终拒绝默认行为
  });
}

function isExternalUrl(url) {
  return url.startsWith('http:') || url.startsWith('https:');
}

 // 找个地方调用打开控制台
ipcMain.on('openDevTools', (event, arg) => {
    mainWindow.webContents.openDevTools();
})

// 主进程监听消息
ipcMain.on('message', (event, arg) => {
    console.log('1111111111')
})