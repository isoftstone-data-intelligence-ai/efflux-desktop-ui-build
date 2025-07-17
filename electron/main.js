const { app, BrowserWindow, Menu, screen, dialog,shell,ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const { execSync } = require('child_process');
const { startServer } = require('./nextServer');
const { checkPortAvailable,waitForPort,setupLogging } = require('./utils');



// efflux_desktop 进程对象
let effluxProcess = null;
let effluxProcessPid = null; // 存储真实的进程 PID

var isDev = require('electron-is-dev');
var isDev = false;

let mainWindow;
var time;

// 在应用准备就绪前设置日志
setupLogging(isDev);

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
      disableWebSecurity: true,
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
  // 根据平台确定可执行文件名
  const execName = process.platform === 'win32' ? 'efflux_desktop.exe' : 'efflux_desktop';
  
  // 调试模式下的路径 - efflux_desktop 在项目根目录下
  if (isDev) {
    const devPath = path.join(__dirname, '..', execName);
    console.log('开发模式路径:', devPath);
    console.log('文件是否存在:', fs.existsSync(devPath));
    return devPath;
  }
  
  // 打包模式下的路径
  console.log('=== 查找 efflux_desktop 可执行文件 ===');
  console.log('可执行文件名:', execName);
  console.log('process.resourcesPath:', process.resourcesPath);
  console.log('app.getAppPath():', app.getAppPath());
  console.log('__dirname:', __dirname);
  
  // 由于 asar: false，文件结构不同
  // 尝试多个可能的路径
  const possiblePaths = [
    // 1. resources 目录（extraResources 配置的路径）
    path.join(process.resourcesPath, execName),
    // 2. app.asar.unpacked 目录（如果存在）
    path.join(app.getAppPath(), '..', 'app.asar.unpacked', execName),
    // 3. 应用目录下
    path.join(app.getAppPath(), execName),
    // 4. 当前目录下
    path.join(__dirname, execName),
    // 5. 上级目录
    path.join(__dirname, '..', execName),
    // 6. 上上级目录
    path.join(__dirname, '..', '..', execName),
    // 7. 应用根目录的上级
    path.join(app.getAppPath(), '..', execName)
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
  const defaultPath = path.join(process.resourcesPath, execName);
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
      // 在 Unix 系统上先获取系统环境变量，然后通过 source 加载用户配置
      try {
        // 首先获取系统环境变量
        console.log('获取系统环境变量...');
        const systemEnvOutput = execSync('env', { encoding: 'utf8' });
        systemEnvOutput.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim();
          }
        });
        console.log('系统环境变量获取完成');
        
        // 然后通过 source 加载用户配置文件
        const home = process.env.HOME || process.env.USERPROFILE;
        if (home) {
          // 尝试不同的 shell 配置文件
          const shellConfigs = [
            path.join(home, '.bash_profile'),
            path.join(home, '.bashrc'),
            path.join(home, '.zshrc'),
            path.join(home, '.profile')
          ];
          
          for (const config of shellConfigs) {
            if (fs.existsSync(config)) {
              try {
                console.log(`使用 source 加载配置文件: ${config}`);
                
                // 使用 bash 或 zsh 来 source 配置文件并获取环境变量
                let shellCommand;
                if (config.includes('.zshrc')) {
                  shellCommand = `zsh -c "source ${config} && env"`;
                } else {
                  shellCommand = `bash -c "source ${config} && env"`;
                }
                
                const output = execSync(shellCommand, { encoding: 'utf8' });
                output.split('\n').forEach(line => {
                  const [key, ...valueParts] = line.split('=');
                  if (key && valueParts.length > 0) {
                    const keyName = key.trim();
                    const value = valueParts.join('=').trim();
                    
                    // 对于 PATH，进行合并而不是覆盖
                    if (keyName === 'PATH') {
                      if (!env.PATH) {
                        env.PATH = value;
                      } else {
                        env.PATH = value + ':' + env.PATH;
                      }
                    } else {
                      // 用户配置文件的变量优先级更高
                      env[keyName] = value;
                    }
                  }
                });
                
                console.log(`成功加载配置文件: ${config}`);
                
              } catch (error) {
                console.warn(`source ${config} 失败:`, error.message);
              }
            }
          }
        }
        
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
      // 获取系统环境变量，包括通过 source 加载的 shell 配置文件
      const env = getSystemEnv();
      
      // 确保重要的系统路径在 PATH 中
      const importantPaths = [];
      
      if (process.platform === 'win32') {
        // Windows 重要路径
        importantPaths.push(
          'C:\\Program Files\\nodejs',
          'C:\\Program Files (x86)\\nodejs',
          path.join(process.env.APPDATA || '', 'npm'),
          path.join(process.env.USERPROFILE || '', 'AppData\\Roaming\\npm')
        );
      } else {
        // Unix 系统重要路径
        importantPaths.push(
          '/usr/local/bin',      // 用户安装的软件
          '/usr/local/sbin',     // 用户安装的系统管理工具
          '/usr/bin',            // 系统软件
          '/usr/sbin',           // 系统管理工具
          '/opt/homebrew/bin',   // Homebrew (Apple Silicon Mac)
          '/opt/local/bin',      // MacPorts
          '/opt/nodejs/bin',     // 某些 Linux 发行版的 Node.js
          path.join(process.env.HOME || '', '.npm-global/bin'),
          path.join(process.env.HOME || '', '.nvm/versions/node/current/bin'),
          path.join(process.env.HOME || '', '.local/bin')
        );
      }
      
      // 检查并添加重要的路径
      const existingImportantPaths = importantPaths.filter(p => fs.existsSync(p));
      if (existingImportantPaths.length > 0) {
        console.log('添加重要系统路径:', existingImportantPaths);
        
        // 将重要路径添加到 PATH 的开头
        const pathDelimiter = process.platform === 'win32' ? ';' : ':';
        const currentPath = env.PATH || '';
        const newPath = existingImportantPaths.join(pathDelimiter) + pathDelimiter + currentPath;
        env.PATH = newPath;
        
        console.log('更新后的 PATH:', env.PATH);
      }
      
      // 确保一些重要的环境变量存在
      env.PWD = process.cwd();
      env.LANG = env.LANG || 'en_US.UTF-8';
      env.LC_ALL = env.LC_ALL || 'en_US.UTF-8';
      
      console.log('使用 source 加载的环境变量');
      console.log('完整 PATH:', env.PATH);
      console.log('HOME:', env.HOME);
      console.log('PWD:', env.PWD);
      
      // Windows 下使用不同的配置来隐藏控制台窗口
      const spawnOptions = {
        detached: true,
        env: env,  // 使用 source 加载的环境变量
        cwd: path.dirname(execPath),  // 设置工作目录为可执行文件所在目录
      };
      
      if (process.platform === 'win32') {
        // Windows 下隐藏控制台窗口
        spawnOptions.windowsHide = true;
        spawnOptions.stdio = ['ignore', 'pipe', 'pipe'];
        // 尝试使用 CREATE_NO_WINDOW 标志
        spawnOptions.windowsVerbatimArguments = true;
      } else {
        // 其他平台保持原有配置
        spawnOptions.stdio = ['pipe', 'pipe', 'pipe'];
      }
      
      // 在 Windows 上尝试使用 exec 来启动程序
      if (process.platform === 'win32') {
        try {
          console.log('Windows 平台，尝试使用 PowerShell Start-Process 启动程序...');
          const { exec } = require('child_process');
          
          // 使用 PowerShell Start-Process 命令在后台启动程序并获取 PID
          const command = `powershell -WindowStyle Hidden -Command "$process = Start-Process -FilePath '${execPath}' -WindowStyle Hidden -PassThru; Write-Output $process.Id"`;
          console.log('执行命令:', command);
          
          effluxProcess = exec(command, {
            env: env,
            cwd: path.dirname(execPath),
            windowsHide: true
          });
          
          // 从输出中获取真实的进程 PID
          effluxProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output && !isNaN(parseInt(output))) {
              effluxProcessPid = parseInt(output);
              console.log(`获取到 efflux_desktop 真实 PID: ${effluxProcessPid}`);
            }
          });
          
          console.log(`使用 PowerShell 启动 efflux_desktop`);
          
        } catch (execErr) {
          console.error('PowerShell 启动失败，尝试使用 start 命令:', execErr);
          try {
            const { exec } = require('child_process');
            
            // 使用 start /B 命令在后台启动程序
            const command = `start /B "" "${execPath}"`;
            console.log('执行命令:', command);
            
            effluxProcess = exec(command, {
              env: env,
              cwd: path.dirname(execPath),
              windowsHide: true
            });
            
            console.log(`使用 start 命令启动 efflux_desktop`);
            
          } catch (startErr) {
            console.error('start 命令启动失败，回退到 spawn:', startErr);
            effluxProcess = spawn(execPath, [], spawnOptions);
            effluxProcessPid = effluxProcess.pid;
          }
        }
      } else {
        effluxProcess = spawn(execPath, [], spawnOptions);
        effluxProcessPid = effluxProcess.pid;
      }
      
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
    killEffluxProcess();
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  console.log('All windows closed');
  if (process.platform!== 'darwin') {
    if (!isQuitting) {
      isQuitting = true;
      // 关闭 efflux_desktop 进程
      killEffluxProcess();
      app.quit();
    }
  }
});

function renderPage() {
  if (time) {
    clearTimeout(time);
  }

  startServer(mainWindow)

  if(isDev){
    mainWindow.webContents.openDevTools();
  }

  // 拦截新窗口事件
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {

    if(url.indexOf('/slides?chatId=')!==-1){

    }else{
       // 外部链接
      if (isExternalUrl(url)) {
        shell.openExternal(url)
        return 
      }
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

// 杀死 efflux_desktop 进程的函数
function killEffluxProcess() {
  if (effluxProcessPid) {
    try {
      console.log(`尝试杀死 efflux_desktop 进程，PID: ${effluxProcessPid}`);
      
      // 在 Windows 上使用多种方法杀死进程
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        
        // 方法1: 使用 taskkill /F /PID
        try {
          exec(`taskkill /F /PID ${effluxProcessPid}`, (error, stdout, stderr) => {
            if (error) {
              console.error('taskkill 失败:', error.message);
            } else {
              console.log('taskkill 成功:', stdout);
            }
          });
        } catch (e) {
          console.error('taskkill 异常:', e);
        }
        
        // 方法2: 使用 PowerShell Stop-Process
        try {
          exec(`powershell -Command "Stop-Process -Id ${effluxProcessPid} -Force"`, (error, stdout, stderr) => {
            if (error) {
              console.error('PowerShell Stop-Process 失败:', error.message);
            } else {
              console.log('PowerShell Stop-Process 成功');
            }
          });
        } catch (e) {
          console.error('PowerShell Stop-Process 异常:', e);
        }
        
      } else {
        // 在 Unix 系统上使用 SIGTERM
        try {
          process.kill(effluxProcessPid, 'SIGTERM');
          console.log(`已发送 SIGTERM 信号到进程 ${effluxProcessPid}`);
        } catch (e) {
          console.error('SIGTERM 失败:', e);
          // 如果 SIGTERM 失败，尝试 SIGKILL
          try {
            process.kill(effluxProcessPid, 'SIGKILL');
            console.log(`已发送 SIGKILL 信号到进程 ${effluxProcessPid}`);
          } catch (killErr) {
            console.error('SIGKILL 也失败:', killErr);
          }
        }
      }
      
    } catch (e) {
      console.error('杀死 efflux_desktop 进程时发生异常:', e);
    }
  }
  
  // 备用方法：通过进程名查找并杀死
  try {
    console.log('使用备用方法：通过进程名查找并杀死 efflux_desktop');
    const { exec } = require('child_process');
    
    if (process.platform === 'win32') {
      // Windows: 使用 taskkill /F /IM
      exec('taskkill /F /IM efflux_desktop.exe', (error, stdout, stderr) => {
        if (error) {
          console.error('通过进程名杀死失败:', error.message);
        } else {
          console.log('通过进程名杀死成功:', stdout);
        }
      });
    } else {
      // Unix: 使用 pkill
      exec('pkill -f efflux_desktop', (error, stdout, stderr) => {
        if (error) {
          console.error('通过进程名杀死失败:', error.message);
        } else {
          console.log('通过进程名杀死成功');
        }
      });
    }
  } catch (e) {
    console.error('备用杀死方法异常:', e);
  }
  
  // 同时尝试杀死 spawn/exec 进程
  if (effluxProcess && !effluxProcess.killed) {
    try {
      effluxProcess.kill('SIGTERM');
      console.log('已杀死 spawn/exec 进程');
    } catch (e) {
      console.error('杀死 spawn/exec 进程失败:', e);
    }
  }
}