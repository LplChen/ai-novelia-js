// ==UserScript==
// @name         Novelia 书单制作助手
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  在 n.novelia.cc 网络小说、文库小说、阅读历史、收藏夹页面抓取书籍信息，生成书单。
// @author       Gemini
// @match        https://n.novelia.cc/*
// @match        https://n.sakura-share.one/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @updateURL     https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/%E5%8D%95%E7%8B%AC%E8%84%9A%E6%9C%AC/Novelia%20%E4%B9%A6%E5%8D%95%E5%88%B6%E4%BD%9C%E5%8A%A9%E6%89%8B.js
// @downloadURL   https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/%E5%8D%95%E7%8B%AC%E8%84%9A%E6%9C%AC/Novelia%20%E4%B9%A6%E5%8D%95%E5%88%B6%E4%BD%9C%E5%8A%A9%E6%89%8B.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置与常量 ---
    const STORAGE_KEY_LISTS = 'novelia_book_lists_v2';
    const STORAGE_KEY_SETTINGS = 'novelia_settings_v2_5'; // 更新 Key

    // 默认字段配置
    const DEFAULT_FIELDS_WEB = [
        { key: 'title_link', name: '书名链接 (### [日文](链接))', active: true, format: '### [{{jp_title}}]({{link}})' },
        { key: 'cn_title', name: '中文译名 (**中文名**：xxx)', active: true, format: '**中文名**：{{cn_title}}' },
        { key: 'status_chapter', name: '状态与话数 (状态 | 话数)', active: true, format: '**状态**：{{status}} | **话数**：{{chapters}}' },
        { key: 'tags', name: '标签 (**标签**：xxx)', active: true, format: '**标签**：{{tags}}' },
        { key: 'separator', name: '分割线 (---)', active: true, format: '\n---' }
    ];

    const DEFAULT_FIELDS_WENKU = [
        { key: 'title_link', name: '书名链接 (### [中文](链接))', active: true, format: '### [{{cn_title}}]({{link}})' },
        { key: 'separator', name: '分割线 (---)', active: true, format: '\n---' }
    ];

    const DEFAULT_SETTINGS = {
        theme: 'auto',
        fields_web: DEFAULT_FIELDS_WEB,
        fields_wenku: DEFAULT_FIELDS_WENKU
    };

    // --- 状态管理 ---
    let state = {
        isOpen: false,
        activeTab: 'extract',
        currentExtractData: [],
        selectedIndices: new Set(),
        bookLists: GM_getValue(STORAGE_KEY_LISTS, { '默认书单': [] }),
        currentListId: '默认书单',
        settings: GM_getValue(STORAGE_KEY_SETTINGS, DEFAULT_SETTINGS)
    };

    if (!state.settings.fields_web || !Array.isArray(state.settings.fields_web)) {
        state.settings = DEFAULT_SETTINGS;
    }
    if (!state.settings.theme) state.settings.theme = 'auto';

    // --- DOM 元素引用 ---
    let ui = { root: null, toggleBtn: null, panel: null, contentArea: null };

    // --- 样式定义 ---
    const STYLES = `
        #novelia-helper-btn {
            position: fixed; bottom: 80px; right: 20px; width: 50px; height: 50px;
            border-radius: 50%; background: #63e2b7; color: #000;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 24px; transition: transform 0.2s;
        }
        #novelia-helper-btn:hover { transform: scale(1.1); }

        #novelia-helper-panel {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 850px; height: 650px; z-index: 10000;
            border-radius: 8px; display: flex; flex-direction: column;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
            overflow: hidden; font-size: 14px;
            transition: background-color 0.3s, color 0.3s, border-color 0.3s;
        }

        /* Dark Theme */
        .nh-dark { background-color: #18181c; color: rgba(255, 255, 255, 0.9); border: 1px solid #333; }
        .nh-dark .nh-header { border-bottom: 1px solid #333; background: #202024; }
        .nh-dark .nh-sidebar { border-right: 1px solid #333; background: #18181c; }
        .nh-dark .nh-item, .nh-dark .nh-field-item { border-bottom: 1px solid #333; }
        .nh-dark .nh-item:hover, .nh-dark .nh-field-item:hover { background: rgba(255,255,255,0.05); }
        .nh-dark input, .nh-dark textarea, .nh-dark select {
            background: #26262a; border: 1px solid #444; color: white;
        }
        .nh-dark .nh-btn { background: #333; color: white; border: 1px solid #444; }
        .nh-dark .nh-btn:hover { background: #444; }
        .nh-dark .nh-btn.primary { background: #63e2b7; color: #000; border: none; }
        .nh-dark .nh-btn.danger { color: #ff6666; border-color: #662222; }

        /* Light Theme */
        .nh-light { background-color: #fff; color: #333; border: 1px solid #ddd; }
        .nh-light .nh-header { border-bottom: 1px solid #eee; background: #f9f9f9; }
        .nh-light .nh-sidebar { border-right: 1px solid #eee; background: #fff; }
        .nh-light .nh-item, .nh-light .nh-field-item { border-bottom: 1px solid #eee; }
        .nh-light .nh-item:hover, .nh-light .nh-field-item:hover { background: #f5f5f5; }
        .nh-light input, .nh-light textarea, .nh-light select {
            background: #fff; border: 1px solid #ccc; color: #333;
        }
        .nh-light .nh-btn { background: #f0f0f0; color: #333; border: 1px solid #ccc; }
        .nh-light .nh-btn:hover { background: #e0e0e0; }
        .nh-light .nh-btn.primary { background: #18a058; color: #fff; border: none; }

        /* Common */
        .nh-header { height: 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-weight: bold; font-size: 16px; }
        .nh-body { flex: 1; display: flex; overflow: hidden; }
        .nh-sidebar { width: 140px; display: flex; flex-direction: column; padding: 10px 0; }
        .nh-tab-btn { padding: 12px 20px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; }
        .nh-tab-btn.active { color: #63e2b7; border-left: 3px solid #63e2b7; background: rgba(99, 226, 183, 0.1); font-weight: bold; }
        .nh-content { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }

        .nh-list-container { flex: 1; overflow-y: auto; border: 1px solid rgba(128,128,128,0.2); border-radius: 4px; }
        .nh-item { padding: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
        .nh-item input[type="checkbox"] { transform: scale(1.3); cursor: pointer; }
        .nh-tag { font-size: 12px; padding: 2px 6px; border-radius: 4px; background: rgba(99, 226, 183, 0.15); color: #63e2b7; margin-right: 4px; border: 1px solid rgba(99,226,183,0.2); }

        .nh-toolbar { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        .nh-btn { padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; transition: 0.2s; }

        textarea.nh-editor { width: 100%; height: 100%; resize: none; padding: 15px; font-family: "Consolas", "Monaco", monospace; line-height: 1.6; outline: none; box-sizing: border-box; flex: 1; border-radius: 4px; }

        /* Field Settings */
        .nh-field-list { display: flex; flex-direction: column; border: 1px solid rgba(128,128,128,0.2); border-radius: 4px; }
        .nh-field-item { padding: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .nh-field-info { display: flex; align-items: center; gap: 10px; flex: 1; }
        .nh-field-actions { display: flex; gap: 5px; }
        .nh-btn-sm { padding: 2px 8px; font-size: 12px; }

        .nh-preview-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 10001; display: none; align-items: center; justify-content: center; }
        .nh-preview-content { width: 80%; height: 85%; background: #fff; color: #333; padding: 40px; overflow-y: auto; border-radius: 8px; line-height: 1.8; }
        .nh-dark .nh-preview-content { background: #202024; color: #ddd; }

        /* 预览链接颜色 */
        .nh-preview-content a { color: #63e2b7 !important; text-decoration: none; border-bottom: 1px solid rgba(99, 226, 183, 0.3); }
        .nh-preview-content a:hover { border-bottom-color: #63e2b7; }

        .nh-close-preview { position: absolute; top: 20px; right: 20px; font-size: 30px; color: white; cursor: pointer; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.4); border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
    `;

    // --- 核心逻辑：强力主题检测 ---

    // 计算背景亮度，返回 true 为深色
    function checkBackgroundIsDark() {
        try {
            const rgb = window.getComputedStyle(document.body).backgroundColor;
            // 提取 rgb 值
            const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                const [_, r, g, b] = match;
                // 使用 YIQ 公式计算亮度
                const brightness = (parseInt(r) * 299 + parseInt(g) * 587 + parseInt(b) * 114) / 1000;
                // 亮度小于 128 认为是深色背景
                return brightness < 128;
            }
        } catch (e) {
            console.error('主题检测失败', e);
        }
        return false;
    }

    // 更新面板主题
    function updatePanelTheme() {
        if (!ui.panel) return;

        let targetTheme = 'dark';

        if (state.settings.theme === 'auto') {
            targetTheme = checkBackgroundIsDark() ? 'dark' : 'light';
        } else {
            targetTheme = state.settings.theme;
        }

        // 只有当 class 确实需要改变时才修改 DOM
        const newClass = targetTheme === 'dark' ? 'nh-dark' : 'nh-light';
        if (ui.panel.className !== newClass) {
            ui.panel.className = newClass;
        }
    }

    // 初始化主题监听器 (MutationObserver + Polling)
    function initThemeObserver() {
        // 1. 监听 body 的 style 属性变化 (Novelia 是修改 inline style 的)
        const observer = new MutationObserver(() => {
            if (state.settings.theme === 'auto') {
                updatePanelTheme();
            }
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        // 2. 兜底轮询 (每1.5秒检查一次，确保万无一失)
        setInterval(() => {
            if (state.settings.theme === 'auto') {
                updatePanelTheme();
            }
        }, 1500);
    }

    // --- 核心逻辑：信息提取 ---

    function getCleanText(element) {
        if (!element) return '';
        const clone = element.cloneNode(true);
        clone.querySelectorAll('i, svg').forEach(e => e.remove());
        return clone.innerText.trim();
    }

    function extractCurrentPage() {
        const url = window.location.href;
        const isWebNovelList = url.includes('/novel');
        const isWebFavorite = url.includes('/favorite/web');
        const isReadHistory = url.includes('/read-history');
        const isWenku = url.includes('/wenku') || url.includes('/favorite/wenku');

        let items = [];

        if (isWebNovelList || isWebFavorite || isReadHistory) {
            document.querySelectorAll('.n-list-item').forEach(el => {
                try {
                    const mainDiv = el.querySelector('.n-list-item__main > div');
                    if (!mainDiv) return;

                    const jpTitleLink = mainDiv.querySelector('a:first-child');
                    const jpTitle = jpTitleLink ? jpTitleLink.innerText.trim() : '';
                    const link = jpTitleLink ? jpTitleLink.href : '';

                    const cnTitleSpan = mainDiv.querySelector('span.n-text.__text-dark-131ezvy-d');
                    const cnTitle = getCleanText(cnTitleSpan);

                    let status = "未知";
                    let chapters = "未知";

                    const spans = mainDiv.querySelectorAll('span');
                    for (let s of spans) {
                        const text = s.textContent;
                        if (text.includes('连载中') || text.includes('已完结') || text.includes('短篇')) {
                            if (text.includes('连载中')) status = '连载中';
                            else if (text.includes('已完结')) status = '已完结';
                            else if (text.includes('短篇')) status = '短篇';

                            const chapMatch = text.match(/总计\s*(\d+)/);
                            if (chapMatch) chapters = chapMatch[1];
                            break;
                        }
                    }

                    let tags = [];
                    const tagContainer = mainDiv.querySelectorAll('.n-text.__text-dark-131ezvy-d3');
                    if (tagContainer.length > 0) {
                        tagContainer.forEach(container => {
                            container.querySelectorAll('a').forEach(tagA => {
                                tags.push(tagA.innerText.trim());
                            });
                        });
                    }
                    tags = [...new Set(tags)].filter(t => t);

                    items.push({
                        type: 'web',
                        jp_title: jpTitle,
                        cn_title: cnTitle || jpTitle,
                        link: link,
                        status: status,
                        chapters: chapters,
                        tags: tags
                    });
                } catch (e) { console.error('Web提取错误', e); }
            });

        } else if (isWenku) {
            document.querySelectorAll('.n-grid > div').forEach(el => {
                try {
                    const linkEl = el.querySelector('a');
                    if (!linkEl) return;

                    const link = linkEl.href;
                    const titleDiv = el.querySelector('.n-text.text-2line');
                    let cnTitle = '未命名';

                    if (titleDiv) {
                        const spans = titleDiv.querySelectorAll('span');
                        if (spans.length > 1) {
                            if (spans[0].querySelector('i, svg')) {
                                cnTitle = getCleanText(spans[1]);
                            } else {
                                cnTitle = getCleanText(spans[0]);
                            }
                        } else if (spans.length === 1) {
                            cnTitle = getCleanText(spans[0]);
                        } else {
                            cnTitle = getCleanText(titleDiv);
                        }
                    }

                    items.push({
                        type: 'wenku',
                        cn_title: cnTitle,
                        link: link,
                        jp_title: '',
                        tags: [],
                        status: '文库',
                        chapters: 'N/A'
                    });
                } catch (e) { console.error('Wenku提取错误', e); }
            });
        }

        return items;
    }

    // --- 核心逻辑：模版生成 ---
    function formatBook(book, fields) {
        let lines = [];
        fields.forEach(field => {
            if (!field.active) return;

            let safeJpTitle = book.jp_title;
            if (!safeJpTitle && field.key === 'title_link') {
                safeJpTitle = book.cn_title || '无标题';
            }

            let text = field.format
                .replace(/{{jp_title}}/g, safeJpTitle || '')
                .replace(/{{cn_title}}/g, book.cn_title || book.jp_title)
                .replace(/{{link}}/g, book.link || '')
                .replace(/{{status}}/g, book.status || '')
                .replace(/{{chapters}}/g, book.chapters || '')
                .replace(/{{tags}}/g, (book.tags || []).join(', '));

            lines.push(text);
        });
        return lines.join('\n') + '\n';
    }

    // --- UI 构建 ---

    function createUI() {
        GM_addStyle(STYLES);

        ui.toggleBtn = document.createElement('div');
        ui.toggleBtn.id = 'novelia-helper-btn';
        ui.toggleBtn.innerHTML = '📚';
        ui.toggleBtn.title = '书单助手';
        ui.toggleBtn.onclick = togglePanel;
        document.body.appendChild(ui.toggleBtn);

        ui.panel = document.createElement('div');
        ui.panel.id = 'novelia-helper-panel';
        ui.panel.style.display = 'none';

        // 初始应用主题
        updatePanelTheme();

        ui.panel.innerHTML = `
            <div class="nh-header">
                <span>Novelia 书单助手 v2.5</span>
                <div style="cursor:pointer; font-size:18px;" id="nh-close">✕</div>
            </div>
            <div class="nh-body">
                <div class="nh-sidebar">
                    <div class="nh-tab-btn active" data-tab="extract">🔍 抓取书籍</div>
                    <div class="nh-tab-btn" data-tab="lists">📝 书单管理</div>
                    <div class="nh-tab-btn" data-tab="settings">⚙️ 抓取设置</div>
                </div>
                <div class="nh-content" id="nh-content-area"></div>
            </div>
            <div class="nh-preview-modal" id="nh-preview-modal">
                <div class="nh-close-preview" id="nh-close-preview">✕</div>
                <div class="nh-preview-content markdown-body" id="nh-preview-body"></div>
            </div>
        `;
        document.body.appendChild(ui.panel);

        document.getElementById('nh-close').onclick = togglePanel;
        document.getElementById('nh-close-preview').onclick = () => {
            document.getElementById('nh-preview-modal').style.display = 'none';
        };

        ui.panel.querySelectorAll('.nh-tab-btn').forEach(btn => {
            btn.onclick = () => switchTab(btn.dataset.tab);
        });

        ui.contentArea = document.getElementById('nh-content-area');

        // 启动主题监听
        initThemeObserver();
    }

    function togglePanel() {
        state.isOpen = !state.isOpen;
        ui.panel.style.display = state.isOpen ? 'flex' : 'none';

        if (state.isOpen) {
            updatePanelTheme(); // 打开时强制检查一次

            if (state.activeTab === 'extract') {
                renderTabContent();

                const listDiv = document.getElementById('nh-extract-list');
                if(listDiv && state.currentExtractData.length === 0) {
                    listDiv.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:15px;"><div style="font-size:24px;margin-bottom:10px;">⏳</div>正在扫描当前页面书籍...</div>';
                    setTimeout(() => {
                        refreshExtractList(true);
                    }, 50);
                }
            }
        }
    }

    function switchTab(tabName) {
        state.activeTab = tabName;
        ui.panel.querySelectorAll('.nh-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        renderTabContent();
    }

    function renderTabContent() {
        const container = ui.contentArea;
        container.innerHTML = '';

        if (state.activeTab === 'extract') renderExtractTab(container);
        else if (state.activeTab === 'lists') renderListsTab(container);
        else if (state.activeTab === 'settings') renderSettingsTab(container);
    }

    // --- Tab 1: 抓取 ---
    function renderExtractTab(container) {
        const toolbar = document.createElement('div');
        toolbar.className = 'nh-toolbar';
        toolbar.innerHTML = `
            <button class="nh-btn primary" id="nh-scan-btn">刷新页面书籍</button>
            <button class="nh-btn" id="nh-sel-all">全选</button>
            <button class="nh-btn" id="nh-sel-inv">反选</button>
            <div style="flex:1"></div>
            <select id="nh-target-list" class="nh-btn" style="min-width:120px"></select>
            <button class="nh-btn primary" id="nh-add-to-list">添加到书单</button>
        `;
        container.appendChild(toolbar);

        const listDiv = document.createElement('div');
        listDiv.className = 'nh-list-container';
        listDiv.id = 'nh-extract-list';
        container.appendChild(listDiv);

        document.getElementById('nh-scan-btn').onclick = () => refreshExtractList(false);
        document.getElementById('nh-sel-all').onclick = () => {
            state.currentExtractData.forEach((_, i) => state.selectedIndices.add(i));
            renderExtractListItems();
        };
        document.getElementById('nh-sel-inv').onclick = () => {
            const newSet = new Set();
            state.currentExtractData.forEach((_, i) => {
                if (!state.selectedIndices.has(i)) newSet.add(i);
            });
            state.selectedIndices = newSet;
            renderExtractListItems();
        };
        document.getElementById('nh-add-to-list').onclick = addSelectedToList;

        const select = document.getElementById('nh-target-list');
        Object.keys(state.bookLists).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            if(name === state.currentListId) opt.selected = true;
            select.appendChild(opt);
        });

        if (state.currentExtractData.length > 0) {
            renderExtractListItems();
        } else {
             listDiv.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6;">请点击“刷新”按钮抓取书籍</div>';
        }
    }

    function refreshExtractList(isAuto = false) {
        const listDiv = document.getElementById('nh-extract-list');
        if (!isAuto && listDiv) {
            listDiv.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">⏳ 正在重新扫描...</div>';
        }

        setTimeout(() => {
            state.currentExtractData = extractCurrentPage();
            state.selectedIndices.clear();
            renderExtractListItems();
        }, 10);
    }

    function renderExtractListItems() {
        const container = document.getElementById('nh-extract-list');
        if(!container) return;

        container.innerHTML = '';
        if (state.currentExtractData.length === 0) {
            container.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6;">未检测到书籍，请进入 网络小说/文库/收藏夹/阅读历史 页面</div>';
            return;
        }

        state.currentExtractData.forEach((book, index) => {
            const div = document.createElement('div');
            div.className = 'nh-item';
            div.innerHTML = `
                <input type="checkbox" ${state.selectedIndices.has(index) ? 'checked' : ''}>
                <div style="flex:1">
                    <div style="font-weight:bold; font-size:15px;">${book.cn_title}</div>
                    ${book.jp_title ? `<div style="font-size:12px;opacity:0.7;">${book.jp_title}</div>` : ''}
                    <div style="font-size:12px;opacity:0.7;margin-top:2px;">${book.status} · ${book.chapters || 'N/A'}</div>
                </div>
            `;
            div.onclick = (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = div.querySelector('input');
                    cb.checked = !cb.checked;
                }
                const cb = div.querySelector('input');
                if (cb.checked) state.selectedIndices.add(index);
                else state.selectedIndices.delete(index);
            };
            container.appendChild(div);
        });
    }

    function addSelectedToList() {
        const targetListName = document.getElementById('nh-target-list').value;
        if (!targetListName) {
            alert('请先创建一个书单 (在书单管理页)');
            return;
        }

        const list = state.bookLists[targetListName] || [];
        let count = 0;

        const isWenku = state.currentExtractData.some(b => b.type === 'wenku');
        const fields = isWenku ? state.settings.fields_wenku : state.settings.fields_web;

        state.selectedIndices.forEach(idx => {
            const book = state.currentExtractData[idx];
            list.push(formatBook(book, fields));
            count++;
        });

        state.bookLists[targetListName] = list;
        GM_setValue(STORAGE_KEY_LISTS, state.bookLists);
        state.selectedIndices.clear();
        renderExtractListItems();
        alert(`已添加 ${count} 本书到 "${targetListName}"`);
    }

    // --- Tab 2: 书单管理 ---
    function renderListsTab(container) {
        const toolbar = document.createElement('div');
        toolbar.className = 'nh-toolbar';
        toolbar.innerHTML = `
            <select id="nh-manage-select" class="nh-btn" style="min-width:150px;"></select>
            <button class="nh-btn" id="nh-list-new">新建</button>
            <button class="nh-btn" id="nh-list-rename">重命名</button>
            <button class="nh-btn danger" id="nh-list-del">删除</button>
            <span style="border-left:1px solid #555; height:20px; margin:0 5px;"></span>
            <button class="nh-btn" id="nh-list-copy">复制内容</button>
            <button class="nh-btn primary" id="nh-list-preview">👀 预览效果</button>
            <button class="nh-btn" id="nh-insert-star" title="插入评分">★ 评分</button>
        `;
        container.appendChild(toolbar);

        const editor = document.createElement('textarea');
        editor.className = 'nh-editor';
        editor.id = 'nh-list-editor';
        editor.placeholder = "书单内容为空，请从抓取页面添加书籍...";
        container.appendChild(editor);

        const select = document.getElementById('nh-manage-select');

        const updateSelect = () => {
            select.innerHTML = '';
            Object.keys(state.bookLists).forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.innerText = name;
                if (name === state.currentListId) opt.selected = true;
                select.appendChild(opt);
            });
            loadListContent();
        };

        const loadListContent = () => {
            const id = select.value;
            state.currentListId = id;
            const content = (state.bookLists[id] || []).join('\n');
            editor.value = content;
        };

        const saveCurrentList = () => {
            if (!state.currentListId) return;
            state.bookLists[state.currentListId] = [editor.value];
            GM_setValue(STORAGE_KEY_LISTS, state.bookLists);
        };

        select.onchange = loadListContent;
        editor.oninput = saveCurrentList;

        document.getElementById('nh-list-new').onclick = () => {
            const name = prompt("请输入新书单名称：");
            if (name && !state.bookLists[name]) {
                state.bookLists[name] = [];
                state.currentListId = name;
                GM_setValue(STORAGE_KEY_LISTS, state.bookLists);
                updateSelect();
            }
        };

        document.getElementById('nh-list-del').onclick = () => {
            if (confirm(`确定删除书单 "${state.currentListId}" 吗？`)) {
                delete state.bookLists[state.currentListId];
                const keys = Object.keys(state.bookLists);
                state.currentListId = keys.length > 0 ? keys[0] : '';
                GM_setValue(STORAGE_KEY_LISTS, state.bookLists);
                updateSelect();
            }
        };

        document.getElementById('nh-list-rename').onclick = () => {
            const newName = prompt("重命名为：", state.currentListId);
            if (newName && newName !== state.currentListId) {
                state.bookLists[newName] = state.bookLists[state.currentListId];
                delete state.bookLists[state.currentListId];
                state.currentListId = newName;
                GM_setValue(STORAGE_KEY_LISTS, state.bookLists);
                updateSelect();
            }
        };

        document.getElementById('nh-list-copy').onclick = () => {
            GM_setClipboard(editor.value);
            alert("已复制到剪贴板");
        };

        document.getElementById('nh-insert-star').onclick = () => {
            const pos = editor.selectionStart;
            const val = editor.value;
            const insert = "\n::: star 5\n";
            editor.value = val.slice(0, pos) + insert + val.slice(pos);
            saveCurrentList();
        };

        document.getElementById('nh-list-preview').onclick = () => {
            let html = editor.value
                .replace(/^### (.*$)/gim, '<h3 style="margin:10px 0 5px; color:#63e2b7;">$1</h3>')
                .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
                .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank">$1</a>')
                .replace(/\n/gim, '<br>')
                .replace(/::: star (\d+)/gim, (match, p1) => {
                    const num = parseInt(p1) || 5;
                    const filled = '★'.repeat(num);
                    const empty = '☆'.repeat(Math.max(0, 5 - num));
                    return `<div style="color:#f5a623;font-size:18px;margin:5px 0;">${filled}${empty}</div>`;
                })
                .replace(/:::/gim, '</div>')
                .replace(/---/gim, '<hr style="border:0;border-top:1px solid rgba(128,128,128,0.3);margin:15px 0;">');

            document.getElementById('nh-preview-body').innerHTML = html;
            document.getElementById('nh-preview-modal').style.display = 'flex';
        };

        updateSelect();
    }

    // --- Tab 3: 设置 (傻瓜式排序) ---
    function renderSettingsTab(container) {
        container.innerHTML = `
            <div style="margin-bottom:20px;">
                <label>界面主题：</label>
                <select id="nh-set-theme" class="nh-btn">
                    <option value="auto">跟随网站 (自动)</option>
                    <option value="dark">深色模式</option>
                    <option value="light">浅色模式</option>
                </select>
                <div style="font-size:12px;color:#888;margin-top:5px;">* "跟随网站" 模式下，面板将根据网页背景色自动切换亮/暗</div>
            </div>

            <h3>网络小说抓取内容 (勾选并排序)</h3>
            <div id="nh-fields-web" class="nh-field-list"></div>

            <h3 style="margin-top:20px;">文库小说抓取内容</h3>
            <div id="nh-fields-wenku" class="nh-field-list"></div>

            <div style="margin-top:20px; display:flex; justify-content:space-between;">
                <button class="nh-btn danger" id="nh-reset-settings">重置为默认</button>
                <button class="nh-btn primary" id="nh-save-settings">保存设置</button>
            </div>
        `;

        document.getElementById('nh-set-theme').value = state.settings.theme;
        document.getElementById('nh-set-theme').onchange = (e) => {
            state.settings.theme = e.target.value;
            updatePanelTheme(); // 立即预览效果
        };

        renderFieldList('nh-fields-web', state.settings.fields_web);
        renderFieldList('nh-fields-wenku', state.settings.fields_wenku);

        document.getElementById('nh-save-settings').onclick = () => {
            state.settings.theme = document.getElementById('nh-set-theme').value;
            GM_setValue(STORAGE_KEY_SETTINGS, state.settings);
            alert("设置已保存");
        };

        document.getElementById('nh-reset-settings').onclick = () => {
            if(confirm('确定重置所有抓取模版设置吗？')) {
                state.settings = DEFAULT_SETTINGS;
                GM_setValue(STORAGE_KEY_SETTINGS, state.settings);
                renderSettingsTab(container);
                updatePanelTheme();
            }
        };
    }

    function renderFieldList(containerId, fieldsArray) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        fieldsArray.forEach((field, index) => {
            const div = document.createElement('div');
            div.className = 'nh-field-item';
            div.innerHTML = `
                <div class="nh-field-info">
                    <input type="checkbox" ${field.active ? 'checked' : ''}>
                    <span>${field.name}</span>
                </div>
                <div class="nh-field-actions">
                    <button class="nh-btn nh-btn-sm btn-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button class="nh-btn nh-btn-sm btn-down" ${index === fieldsArray.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
            `;

            const checkbox = div.querySelector('input[type="checkbox"]');
            checkbox.onchange = () => { field.active = checkbox.checked; };

            div.querySelector('.btn-up').onclick = () => {
                if (index > 0) {
                    [fieldsArray[index], fieldsArray[index - 1]] = [fieldsArray[index - 1], fieldsArray[index]];
                    renderFieldList(containerId, fieldsArray);
                }
            };

            div.querySelector('.btn-down').onclick = () => {
                if (index < fieldsArray.length - 1) {
                    [fieldsArray[index], fieldsArray[index + 1]] = [fieldsArray[index + 1], fieldsArray[index]];
                    renderFieldList(containerId, fieldsArray);
                }
            };

            container.appendChild(div);
        });
    }

    // --- 初始化 ---
    createUI();

})();
