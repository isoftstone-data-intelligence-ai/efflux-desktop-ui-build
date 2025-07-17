const { app, BrowserWindow } = require('electron');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const { checkPortAvailable } = require('./utils');

const dev = false;
const port = 38066;

console.log(__dirname);

const nextApp = next({ dev, dir: path.join(__dirname, '../web-ui') }); // 指向 Next.js 项目目录
const handle = nextApp.getRequestHandler();

async function startServer(mainWindow) {
  console.log('4444444444444');
  console.log('当前 Node.js 版本:', process.version);

  const isAvailable = await checkPortAvailable('localhost', port, 2000);

  if (isAvailable) {
    // 端口有服务存活，直接进入
    console.log(`> 端口 ${port} 已有服务存活，直接连接`);
    mainWindow.loadURL(`http://localhost:${port}`);
    return 
  }


  // 端口没有服务，启动新的服务器
  console.log(`> 端口 ${port} 没有服务，启动新服务器`);
  nextApp.prepare().then(() => {
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });

    server.listen(port, (err) => {
      if (err) throw err;
      console.log(`> Ready on http://localhost:${port}`);
      mainWindow.loadURL(`http://localhost:${port}`);
    });
  });
}

module.exports = {
  startServer,
};
