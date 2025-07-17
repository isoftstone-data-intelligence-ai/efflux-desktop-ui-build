const { app, BrowserWindow, Menu, screen, dialog,shell,ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const { execSync } = require('child_process');

// 日志记录功能
function setupLogging() {
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

// 在应用准备就绪前设置日志
setupLogging();

// efflux_desktop 进程对象
let effluxProcess = null;

var isDev = require('electron-is-dev');
var isDev = false;

let mainWindow;
var time;

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
      webSecurity: false,  // 关闭 web 安全，禁用同源策略
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);

  // 加载 loading
  mainWindow.loadURL(`file://${path.join(__dirname, 'loading.html')}`);
}

app.commandLine.appendSwitch('disable-web-security');

// 获取 efflux_desktop 可执行文件路径
function getEffluxDesktopPath() {
  // 调试模式下的路径 - efflux_desktop 在项目根目录下
  if (isDev) {
    const devPath = path.join(__dirname, '..', 'efflux_desktop');
    console.log('开发模式路径:', devPath);
    console.log('文件是否存在:', fs.existsSync(devPath));
    return devPath;
  }
  
  // 打包模式下的路径
  console.log('=== 查找 efflux_desktop 可执行文件 ===');
  console.log('process.resourcesPath:', process.resourcesPath);
  console.log('app.getAppPath():', app.getAppPath());
  console.log('__dirname:', __dirname);
  
  // 由于 asar: false，文件结构不同
  // 尝试多个可能的路径
  const possiblePaths = [
    // 1. resources 目录（extraResources 配置的路径）
    path.join(process.resourcesPath, 'efflux_desktop'),
    // 2. app.asar.unpacked 目录（如果存在）
    path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'efflux_desktop'),
    // 3. 应用目录下
    path.join(app.getAppPath(), 'efflux_desktop'),
    // 4. 当前目录下
    path.join(__dirname, 'efflux_desktop'),
    // 5. 上级目录
    path.join(__dirname, '..', 'efflux_desktop'),
    // 6. 上上级目录
    path.join(__dirname, '..', '..', 'efflux_desktop'),
    // 7. 应用根目录的上级
    path.join(app.getAppPath(), '..', 'efflux_desktop')
  ];
  
  // 检查文件是否存在
  for (let i = 0; i < possiblePaths.length; i++) {
    const execPath = possiblePaths[i];
    console.log(`检查路径 ${i + 1}: ${execPath}`);
    console.log(`  文件是否存在: ${fs.existsSync(execPath)}`);
    
    if (fs.existsSync(execPath)) {
      // 检查文件权限
      try {
        const stats = fs.statSync(execPath);
        console.log(`  文件大小: ${stats.size} bytes`);
        console.log(`  文件权限: ${stats.mode.toString(8)}`);
        console.log(`  是否为文件: ${stats.isFile()}`);
        
        // 在非Windows系统上检查执行权限
        if (process.platform !== 'win32') {
          const isExecutable = (stats.mode & 0o111) !== 0;
          console.log(`  是否可执行: ${isExecutable}`);
          
          if (!isExecutable) {
            console.warn(`  警告: 文件存在但不可执行，尝试添加执行权限`);
            try {
              fs.chmodSync(execPath, 0o755);
              console.log(`  已添加执行权限`);
            } catch (chmodErr) {
              console.error(`  添加执行权限失败:`, chmodErr);
            }
          }
        }
        
        console.log(`找到 efflux_desktop 可执行文件: ${execPath}`);
        return execPath;
      } catch (statErr) {
        console.error(`  获取文件信息失败:`, statErr);
      }
    }
  }
  
  // 如果都找不到，返回默认路径
  console.warn('未找到 efflux_desktop 可执行文件，使用默认路径');
  const defaultPath = path.join(process.resourcesPath, 'efflux_desktop');
  console.log('默认路径:', defaultPath);
  return defaultPath;
}

// 获取系统环境变量
function getSystemEnv() {
  try {
    let env = {};
    
    // 在 Windows 上获取用户和系统环境变量
    if (process.platform === 'win32') {
      // 获取用户环境变量
      try {
        const userOutput = execSync('cmd /c "set"', { encoding: 'utf8' });
        userOutput.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim();
          }
        });
      } catch (error) {
        console.warn('获取用户环境变量失败:', error.message);
      }
      
      // 获取系统环境变量
      try {
        const systemOutput = execSync('cmd /c "set /p"', { encoding: 'utf8' });
        systemOutput.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            const keyName = key.trim();
            const value = valueParts.join('=').trim();
            // 如果用户环境变量中没有，则使用系统环境变量
            if (!env[keyName]) {
              env[keyName] = value;
            }
          }
        });
      } catch (error) {
        console.warn('获取系统环境变量失败:', error.message);
      }
      
      // 尝试获取完整的 PATH（包括用户和系统）
      try {
        const pathOutput = execSync('cmd /c "echo %PATH%"', { encoding: 'utf8' });
        const fullPath = pathOutput.trim();
        if (fullPath && fullPath !== '%PATH%') {
          env.PATH = fullPath;
        }
      } catch (error) {
        console.warn('获取完整 PATH 失败:', error.message);
      }
      
    } else {
      // 在 Unix 系统上获取环境变量
      try {
        const output = execSync('env', { encoding: 'utf8' });
        output.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim();
          }
        });
      } catch (error) {
        console.warn('获取 Unix 环境变量失败:', error.message);
      }
    }
    
    // 如果获取失败或为空，使用当前进程环境变量
    if (Object.keys(env).length === 0) {
      console.warn('获取系统环境变量失败，使用当前进程环境变量');
      return process.env;
    }
    
    return env;
  } catch (error) {
    console.warn('获取系统环境变量失败，使用当前进程环境变量:', error.message);
    return process.env;
  }
}

// 获取用户 PATH 环境变量
function getUserPath() {
  try {
    if (process.platform === 'win32') {
      // 在 Windows 上获取用户 PATH
      const output = execSync('powershell -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"', { encoding: 'utf8' });
      return output.trim();
    } else {
      // 在 Unix 系统上，用户环境变量通常在 shell 配置文件中
      // 尝试从常见的 shell 配置文件获取
      const home = process.env.HOME || process.env.USERPROFILE;
      if (home) {
        const shellConfigs = [
          path.join(home, '.bashrc'),
          path.join(home, '.bash_profile'),
          path.join(home, '.zshrc'),
          path.join(home, '.profile'),
          path.join(home, '.bash_login'),
          path.join(home, '.zprofile')
        ];
        
        let userPath = '';
        
        for (const config of shellConfigs) {
          if (fs.existsSync(config)) {
            try {
              console.log(`读取配置文件: ${config}`);
              const content = fs.readFileSync(config, 'utf8');
              
              // 查找 PATH 相关的配置
              const pathMatches = content.match(/export\s+PATH\s*=\s*([^#\n]+)/g);
              if (pathMatches) {
                for (const match of pathMatches) {
                  const pathValue = match.replace(/export\s+PATH\s*=\s*/, '').trim().replace(/['"]/g, '');
                  console.log(`在 ${config} 中找到 PATH: ${pathValue}`);
                  userPath += pathValue + ':';
                }
              }
              
              // 查找 PATH 追加的配置 (PATH=$PATH:...)
              const pathAppendMatches = content.match(/export\s+PATH\s*=\s*\$PATH:([^#\n]+)/g);
              if (pathAppendMatches) {
                for (const match of pathAppendMatches) {
                  const pathValue = match.replace(/export\s+PATH\s*=\s*\$PATH:/, '').trim().replace(/['"]/g, '');
                  console.log(`在 ${config} 中找到 PATH 追加: ${pathValue}`);
                  userPath += pathValue + ':';
                }
              }
              
            } catch (error) {
              console.warn(`读取配置文件失败 ${config}:`, error.message);
            }
          }
        }
        
        // 移除末尾的冒号
        if (userPath.endsWith(':')) {
          userPath = userPath.slice(0, -1);
        }
        
        if (userPath) {
          console.log(`合并后的用户 PATH: ${userPath}`);
          return userPath;
        }
      }
    }
  } catch (error) {
    console.warn('获取用户 PATH 失败:', error.message);
  }
  return '';
}

// 从 shell 配置文件读取环境变量
function getShellEnvVars() {
  const envVars = {};
  const home = process.env.HOME || process.env.USERPROFILE;
  
  if (!home) {
    return envVars;
  }
  
  const shellConfigs = [
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.zshrc'),
    path.join(home, '.profile'),
    path.join(home, '.bash_login'),
    path.join(home, '.zprofile')
  ];
  
  for (const config of shellConfigs) {
    if (fs.existsSync(config)) {
      try {
        console.log(`读取环境变量配置文件: ${config}`);
        const content = fs.readFileSync(config, 'utf8');
        
        // 查找所有 export 语句
        const exportMatches = content.match(/export\s+([^=]+)=([^#\n]+)/g);
        if (exportMatches) {
          for (const match of exportMatches) {
            const parts = match.replace(/export\s+/, '').split('=');
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts.slice(1).join('=').trim().replace(/['"]/g, '');
              
              // 处理 PATH 的特殊情况
              if (key === 'PATH') {
                if (!envVars.PATH) {
                  envVars.PATH = value;
                } else {
                  envVars.PATH += ':' + value;
                }
              } else {
                envVars[key] = value;
              }
              
              console.log(`在 ${config} 中找到环境变量: ${key}=${value}`);
            }
          }
        }
        
      } catch (error) {
        console.warn(`读取配置文件失败 ${config}:`, error.message);
      }
    }
  }
  
  return envVars;
}

// 应用初始化函数
async function initializeApp() {
  createWindow();

  // 先检查 38080 端口是否已经可用
  console.log('检查 38080 端口是否已经可用...');
  const portAlreadyAvailable = await checkPortAvailable('127.0.0.1', 38080, 3000);
  
  if (portAlreadyAvailable) {
    console.log('38080 端口已可用，直接渲染页面');
    renderPage();
  } else {
    console.log('38080 端口不可用，启动 efflux_desktop...');
    // 启动 efflux_desktop 可执行文件
    const execPath = getEffluxDesktopPath();
    console.log(`尝试启动: ${execPath}`);
    
    // 检查文件是否存在
    if (!fs.existsSync(execPath)) {
      console.error(`错误: efflux_desktop 文件不存在: ${execPath}`);
      console.error('请检查打包配置和文件路径');
      renderPage(); // 即使启动失败也继续渲染页面
      return;
    }
    
    // 检查文件权限
    try {
      const stats = fs.statSync(execPath);
      console.log(`文件大小: ${stats.size} bytes`);
      console.log(`文件权限: ${stats.mode.toString(8)}`);
      
      if (process.platform !== 'win32') {
        const isExecutable = (stats.mode & 0o111) !== 0;
        console.log(`是否可执行: ${isExecutable}`);
        
        if (!isExecutable) {
          console.warn('文件不可执行，尝试添加执行权限...');
          fs.chmodSync(execPath, 0o755);
          console.log('已添加执行权限');
        }
      }
    } catch (statErr) {
      console.error('获取文件信息失败:', statErr);
    }
    
    // 启动进程
    try {
      // 获取系统环境变量，确保包含用户安装的 Node.js 路径
      const env = getSystemEnv();
      
      // 获取用户 PATH 并合并
      const userPath = getUserPath();
      if (userPath) {
        console.log('用户 PATH:', userPath);
        // 将用户 PATH 添加到系统 PATH 前面
        env.PATH = userPath + path.delimiter + (env.PATH || '');
      }
      
      // 确保一些重要的环境变量存在
      env.PWD = process.cwd();
      env.LANG = env.LANG || 'en_US.UTF-8';
      env.LC_ALL = env.LC_ALL || 'en_US.UTF-8';
      
      console.log('使用合并后的环境变量');
      console.log('完整 PATH:', env.PATH);
      console.log('HOME:', env.HOME);
      console.log('PWD:', env.PWD);
      
      effluxProcess = spawn(execPath, [], { 
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env,  // 使用合并后的环境变量
        cwd: path.dirname(execPath)  // 设置工作目录为可执行文件所在目录
      });
      
      console.log(`efflux_desktop 进程已启动，PID: ${effluxProcess.pid}`);
      
      effluxProcess.on('error', (err) => {
        console.error('Failed to start efflux_desktop:', err);
        console.error('错误代码:', err.code);
        console.error('错误消息:', err.message);
        console.error('尝试的路径:', execPath);
      });
      
      effluxProcess.on('exit', (code, signal) => {
        console.log(`efflux_desktop 进程退出，代码: ${code}, 信号: ${signal}`);
      });
      
      effluxProcess.stdout && effluxProcess.stdout.on('data', (data) => {
        console.log(`[efflux_desktop]: ${data}`);
      });
      effluxProcess.stderr && effluxProcess.stderr.on('data', (data) => {
        console.error(`[efflux_desktop error]: ${data}`);
      });
      
    } catch (spawnErr) {
      console.error('启动 efflux_desktop 时发生异常:', spawnErr);
      console.error('异常类型:', spawnErr.constructor.name);
      console.error('异常消息:', spawnErr.message);
    }

    // 等待 127.0.0.1:38080 端口可用
    console.log('等待 efflux_desktop 服务启动...');
    const portAvailable = await waitForPort('127.0.0.1', 38080);
    
    if (portAvailable) {
      console.log('efflux_desktop 服务已启动，开始渲染页面');
      renderPage();
    } else {
      console.log('efflux_desktop 服务启动超时，但仍继续渲染页面');
      renderPage();
    }
  }
}

app.whenReady().then(async () => {
  await initializeApp();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await initializeApp();
    }
  });
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    console.log('Application is quitting...');
    isQuitting = true;
    // 关闭 efflux_desktop 进程
    if (effluxProcess && !effluxProcess.killed) {
      try {
        process.kill(-effluxProcess.pid, 'SIGTERM'); // 使用负号杀掉整个进程组
      } catch (e) {
        console.error('Failed to kill efflux_desktop:', e);
      }
    }
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  console.log('All windows closed');
  if (process.platform!== 'darwin') {
    if (!isQuitting) {
      isQuitting = true;
      // 关闭 efflux_desktop 进程
      if (effluxProcess && !effluxProcess.killed) {
        try {
          process.kill(-effluxProcess.pid, 'SIGTERM');
        } catch (e) {
          console.error('Failed to kill efflux_desktop:', e);
        }
      }
      app.quit();
    }
  }
});

function renderPage() {
  if (time) {
    clearTimeout(time);
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
        contextIsolation: true,
        webSecurity: false,
        webviewTag:true,
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

// 打开日志文件
ipcMain.on('openLogFile', (event, arg) => {
    const logDir = path.join(app.getPath('userData'), 'logs');
    const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    
    if (fs.existsSync(logFile)) {
        shell.openPath(logFile);
        console.log('已打开日志文件:', logFile);
    } else {
        console.error('日志文件不存在:', logFile);
        // 打开日志目录
        shell.openPath(logDir);
    }
})

// 获取日志文件路径
ipcMain.handle('getLogFilePath', (event, arg) => {
    const logDir = path.join(app.getPath('userData'), 'logs');
    const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    return logFile;
})

// 主进程监听消息
ipcMain.on('message', (event, arg) => {
    console.log('1111111111')
})