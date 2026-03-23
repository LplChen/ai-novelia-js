// ==UserScript==
// @name         Novelia 文库刷新助手
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动刷新文库元数据。支持后台运行，自动翻页，可动态调整并发窗口数量。
// @author       Gemini Business
// @match        https://n.novelia.cc/wenku*
// @match        https://n.novelia.cc/wenku-edit/*
// @grant        GM_addStyle
// @grant        window.close
// @grant        window.focus
// ==/UserScript==

(function() {
    'use strict';

    // --- 基础配置 ---
    const DEFAULT_CONFIG = {
        defaultConcurrency: 2,   // 默认并发
        stepDelayMin: 1000,      // 最小延迟 (毫秒)
        stepDelayMax: 3000,      // 最大延迟
        workerSize: { w: 400, h: 300 },
        autoNextPage: true
    };

    const CHANNEL_NAME = 'novelia_task_channel_v4';
    const channel = new BroadcastChannel(CHANNEL_NAME);

    // --- 辅助函数 ---
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const randomDelay = () => sleep(Math.floor(Math.random() * (DEFAULT_CONFIG.stepDelayMax - DEFAULT_CONFIG.stepDelayMin + 1) + DEFAULT_CONFIG.stepDelayMin));
    const isEditPage = location.href.includes('/wenku-edit/');

    // ========================================================================
    // A: 工蜂逻辑 (运行在编辑页)
    // ========================================================================
    if (isEditPage) {
        if (window.name && window.name.startsWith('novelia_worker_')) {
            const workerId = window.name;
            (async function() {
                try {
                    document.title = `[工作中] ${workerId}`;

                    // 1. 刷新
                    const refreshBtn = await waitForElement("//button[contains(., '刷新分卷')]", 8000);
                    if (!refreshBtn) throw new 错误("无刷新按钮");
                    await randomDelay();
                    refreshBtn.click();

                    // 2. 等待导入
                    await waitForCondition(() => document.body.innerText.includes("智能导入完成"), 60000, 1500);
                    await sleep(500);

                    // 3. 提交
                    const submitBtn = await waitForElement("//button[contains(., '提交')]", 5000);
                    if (!submitBtn) throw new 错误("无提交按钮");
                    submitBtn.click();

                    // 4. 等待成功
                    await waitForCondition(() => document.body.innerText.includes("编辑文库成功") || document.body.innerText.includes("成功"), 15000, 500);

                    channel.postMessage({ type: 'DONE', workerId, status: 'success' });
                } catch (e) {
                    channel.postMessage({ type: 'DONE', workerId, status: 'fail', msg: e.message });
                }
            })();
        }
        return;
    }

    // ========================================================================
    // B: 主控台逻辑 (列表页)
    // ========================================================================

    const state = {
        isRunning: false,
        isNavigating: false,
        queue: [],
        workers: [], // { id: 0, window: null, busy: false }
        stats: { success: 0, fail: 0 },
        logs: []
    };

    // 获取当前设定的并发数
    function getCurrentConcurrency() {
        const input = document.getElementById('inp-concurrency');
        let val = input ? parseInt(input.value) : DEFAULT_CONFIG.defaultConcurrency;
        if (isNaN(val) || val < 1) val = 1;
        return val;
    }

    // 确保 Worker 池足够大
    function ensureWorkerPool() {
        const target = getCurrentConcurrency();
        // 只增不减，多余的worker我们只是不分配任务，而不是从数组删除，以保持ID稳定
        while (state.workers.length < target) {
            state.workers.push({ id: state.workers.length, window: null, busy: false });
        }
    }

    // 消息处理
    channel.onmessage = (ev) => {
        if (!state.isRunning || state.isNavigating) return;
        const data = ev.data;
        if (data.type === 'DONE') {
            const wIndex = parseInt(data.workerId.replace('novelia_worker_', ''));
            const worker = state.workers[wIndex];
            if (worker) {
                worker.busy = false;
                if (data.status === 'success') {
                    state.stats.success++;
                    addLog(`窗口${wIndex}: 成功`, '#4caf50');
                } else {
                    state.stats.fail++;
                    addLog(`窗口${wIndex}: 失败 - ${data.msg}`, '#f44336');
                }
                updateUI();
                scheduleNext(); // 任务完成，触发调度
            }
        }
    };

    // --- 核心调度 ---

    function scanBooks() {
        const links = document.querySelectorAll('a[href^="/wenku/"]');
        const newIds = new Set();
        links.forEach(link => {
            const m = link.getAttribute('href').match(/\/wenku\/([a-zA-Z0-9]+)(\?|$)/);
            if (m) newIds.add(m[1]);
        });
        return Array.from(newIds);
    }

    function scheduleNext() {
        if (!state.isRunning || state.isNavigating) return;

        // 1. 动态扩容池子
        ensureWorkerPool();
        const maxWorkers = getCurrentConcurrency();

        // 2. 检查是否全部完成
        // 注意：这里只检查 active 的 worker 是否空闲
        const activePool = state.workers.slice(0, maxWorkers);
        const allActiveIdle = activePool.every(w => !w.busy);
        const queueEmpty = state.queue.length === 0;

        // 如果队列空了，且正在工作的工蜂也都停了
        if (queueEmpty && allActiveIdle) {
            // 再次检查是否有更高ID的 worker 还在跑 (比如刚调小了并发数)
            const anyWorkerBusy = state.workers.some(w => w.busy);
            if (!anyWorkerBusy) {
                addLog("本页处理完毕，准备翻页...", "blue");
                handleNextPage();
            }
            return;
        }

        // 3. 清理多余的闲置窗口 (当用户调小并发数时)
        for (let i = maxWorkers; i < state.workers.length; i++) {
            const w = state.workers[i];
            if (!w.busy && w.window && !w.window.closed) {
                w.window.close();
                w.window = null;
                // addLog(`收缩: 关闭窗口 ${i}`);
            }
        }

        // 4. 分配任务
        // 只在允许的并发范围内寻找空闲工蜂
        const idleWorker = activePool.find(w => !w.busy);

        if (idleWorker && state.queue.length > 0) {
            const bookId = state.queue.shift();
            runWorker(idleWorker, bookId);
            // 递归尝试填满所有并发槽
            scheduleNext();
        }
    }

    function runWorker(worker, bookId) {
        worker.busy = true;
        const url = `https://n.novelia.cc/wenku-edit/${bookId}`;
        const winName = `novelia_worker_${worker.id}`;

        // 窗口复用策略
        if (!worker.window || worker.window.closed) {
            // 第一次打开，或者窗口意外关闭后重启
            // 放到屏幕外或角落
            worker.window = window.open(url, winName, `width=${DEFAULT_CONFIG.workerSize.w},height=${DEFAULT_CONFIG.workerSize.h},left=2000,top=2000`);
        } else {
            worker.window.location.href = url;
        }
        updateUI();
    }

    // --- 翻页逻辑 (SPA适配) ---
    async function handleNextPage() {
        if (!DEFAULT_CONFIG.autoNextPage) {
            stopTask("自动翻页未开启");
            return;
        }

        state.isNavigating = true;

        const items = document.querySelectorAll('.n-pagination-item:not(.n-pagination-item--disabled)');
        if (items.length === 0) {
            stopTask("未找到分页按钮");
            return;
        }

        const nextBtn = items[items.length - 1];
        const oldUrl = location.href;
        const oldFirstBook = document.querySelector('a[href^="/wenku/"]')?.getAttribute('href');

        addLog("正在跳转下一页...", "orange");
        nextBtn.click();

        let retries = 0;
        const checkPageChanged = setInterval(async () => {
            retries++;
            const newUrl = location.href;
            const newFirstBook = document.querySelector('a[href^="/wenku/"]')?.getAttribute('href');

            const urlChanged = newUrl !== oldUrl;
            const contentChanged = newFirstBook && newFirstBook !== oldFirstBook;

            if (urlChanged || contentChanged) {
                clearInterval(checkPageChanged);
                addLog("检测到新页面...", "green");
                await sleep(1500);

                state.isNavigating = false;
                const books = scanBooks();

                if (books.length > 0) {
                    state.queue = books;
                    addLog(`新页面发现 ${books.length} 本书`);
                    updateUI();
                    scheduleNext();
                } else {
                    stopTask("新页面未扫描到书籍");
                }
            } else if (retries >= 20) { // 10秒
                clearInterval(checkPageChanged);
                stopTask("翻页超时");
            }
        }, 500);
    }

    // --- 启动/停止 ---
    async function startTask() {
        if (state.isRunning) {
            // 如果已经在运行，点击按钮可能是为了触发调度（例如修改了并发数）
            addLog("配置更新，尝试增加并发...", "blue");
            scheduleNext();
            return;
        }

        state.isRunning = true;
        state.isNavigating = false;
        localStorage.setItem('novelia_auto_run', 'true');

        // 保存当前并发设置
        const currentCon = document.getElementById('inp-concurrency').value;
        localStorage.setItem('novelia_concurrency', currentCon);

        addLog("任务启动...", "green");

        let books = [];
        for(let i=0; i<5; i++) {
            books = scanBooks();
            if(books.length > 0) break;
            await sleep(1000);
        }

        if (books.length === 0) {
            stopTask("当前页未找到书籍");
            return;
        }

        state.queue = books;
        addLog(`载入 ${books.length} 本书`);
        updateUI();
        scheduleNext();
    }

    function stopTask(reason = "") {
        state.isRunning = false;
        localStorage.removeItem('novelia_auto_run');
        addLog(`停止: ${reason}`, "red");
        updateUI();
    }

    // --- UI & DOM ---
    function waitForElement(xpath, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const loop = () => {
                const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (el) resolve(el);
                else if (Date.now() - start > timeout) resolve(null);
                else setTimeout(loop, 500);
            };
            loop();
        });
    }
    function waitForCondition(predicate, timeout, interval) {
        return new Promise((resolve) => {
            const start = Date.now();
            const loop = () => {
                if (predicate()) resolve(true);
                else if (Date.now() - start > timeout) resolve(false);
                else setTimeout(loop, interval);
            };
            loop();
        });
    }
    function addLog(msg, color) {
        const time = new Date().toLocaleTimeString().split(' ')[0];
        state.logs.unshift(`<div style="color:${color||'inherit'}"><span>${time}</span> ${msg}</div>`);
        if (state.logs.length > 50) state.logs.pop();
        updateUI();
    }

    function createPanel() {
        const savedConcurrency = localStorage.getItem('novelia_concurrency') || 2;

        const div = document.createElement('div');
        div.innerHTML = `
            <div id="n-panel">
                <div class="n-header" id="n-header">
                    <span>Novelia文库刷新助手 v4.0</span>
                    <span style="cursor:pointer" onclick="this.parentNode.parentNode.style.display='none'">x</span>
                </div>
                <div class="n-body">
                    <div class="n-row">
                        <span>并发数: <input type="number" id="inp-concurrency" value="${savedConcurrency}" min="1" max="10" style="width:40px;text-align:center;"></span>
                        <span>待处理: <b id="s-queue">0</b></span>
                    </div>
                    <div class="n-row">
                        <span style="color:#4caf50">成功: <b id="s-ok">0</b></span>
                        <span style="color:#f44336">失败: <b id="s-fail">0</b></span>
                    </div>
                    <div class="n-controls">
                        <button id="btn-start" class="btn primary">启动 / 更新</button>
                        <button id="btn-stop" class="btn danger">停止</button>
                    </div>
                    <div id="n-logs" class="n-logs"></div>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        // 样式
        GM_addStyle(`
            #n-panel { position:fixed;bottom:20px;right:20px;width:260px;background:var(--bg,#fff);color:var(--tx,#333);border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:9999;font-size:12px;font-family:sans-serif; }
            .n-header { padding:8px;background:rgba(0,0,0,0.05);border-bottom:1px solid rgba(0,0,0,0.1);font-weight:bold;display:flex;justify-content:space-between;cursor:move;user-select:none;}
            .n-body { padding:10px; }
            .n-row { display:flex;justify-content:space-between;margin-bottom:8px;align-items:center; }
            .n-controls { display:flex;gap:5px;margin-bottom:8px; }
            .btn { flex:1;padding:6px;border:none;border-radius:4px;cursor:pointer;color:#fff;font-weight:bold;transition:opacity 0.2s; }
            .btn:hover { opacity: 0.9; }
            .primary { background:#2196f3; } .danger { background:#f44336; }
            .n-logs { height:120px;overflow-y:auto;background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.1);padding:4px;line-height:1.4; }
            input[type=number] { border:1px solid #ccc; border-radius:3px; padding:2px; }

            @media (prefers-color-scheme: dark) {
                #n-panel { --bg:#222; --tx:#ddd; border-color:#444; }
                input[type=number] { background:#333; color:#fff; border-color:#555; }
            }
        `);

        // 拖拽
        const el = document.getElementById('n-panel');
        const head = document.getElementById('n-header');
        let isDown=false, ox, oy;
        head.onmousedown = e => { isDown=true; ox=e.offsetX; oy=e.offsetY; };
        document.onmousemove = e => { if(isDown) { el.style.left=(e.clientX-ox)+'px'; el.style.top=(e.clientY-oy)+'px'; el.style.right='auto'; el.style.bottom='auto'; }};
        document.onmouseup = () => isDown=false;

        // 事件
        document.getElementById('btn-start').onclick = startTask;
        document.getElementById('btn-stop').onclick = () => stopTask("用户停止");

        // 监听输入框变化，自动保存设置并尝试扩容
        document.getElementById('inp-concurrency').onchange = function() {
             localStorage.setItem('novelia_concurrency', this.value);
             if(state.isRunning) {
                 addLog(`并发调整为 ${this.value}`, 'blue');
                 scheduleNext(); // 立即触发调度
             }
        };
    }

    function updateUI() {
        const el = document.getElementById('n-panel');
        if(!el) return;
        document.getElementById('s-queue').innerText = state.queue.length;
        document.getElementById('s-ok').innerText = state.stats.success;
        document.getElementById('s-fail').innerText = state.stats.fail;
        document.getElementById('n-logs').innerHTML = state.logs.join('');
    }

    // 初始化
    setTimeout(() => {
        createPanel();
        if (localStorage.getItem('novelia_auto_run') === 'true') {
            setTimeout(startTask, 2000);
        }
    }, 1500);

})();
