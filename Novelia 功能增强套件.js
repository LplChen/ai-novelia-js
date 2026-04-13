// ==UserScript==
// @name         Novelia 功能增强套件
// @namespace    https://n.novelia.cc/
// @version      1.7.0
// @description  整合LightNovel搜索、书单助手、黑名单管理、简介自动排版。支持统一UI面板与模块化开关。
// @author       Gemini&Claude
// @match        https://n.novelia.cc/*
// @match        https://n.sakura-share.one/*
// @match        https://lightnovel.jp/publicationdate/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 全局常量与状态管理
    // ============================================================
    const STORE_SETTINGS = 'novelia_mega_settings';
    const STORE_LISTS = 'novelia_book_lists_v2';
    const STORE_BLACKLIST = 'novelia_blacklist';
    const STORE_UI_POS = 'novelia_mega_ui_pos';

    const IS_NOVELIA = location.hostname.includes('novelia.cc') || location.hostname.includes('sakura-share.one');
    const IS_LIGHTNOVEL = location.hostname.includes('lightnovel.jp');

    // 默认模版
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

    let megaState = {
        settings: GM_getValue(STORE_SETTINGS, {
            theme: 'auto',
            enableSearchBtn: true,
            enableBookList: true,
            enableBlacklist: true,
            enableFormatter: true,
            fields_web: DEFAULT_FIELDS_WEB,
            fields_wenku: DEFAULT_FIELDS_WENKU
        }),
        lists: GM_getValue(STORE_LISTS, { '默认书单': [] }),
        blacklist: getBlacklist(),
        currentListId: '默认书单',
        extractData: [],
        selectedExtract: new Set(),
        selectedBlacklist: new Set(),
        panelOpen: false,
        activeTab: 'tab-extract'
    };

    // 补全缺失设置
    if (!megaState.settings.fields_web) megaState.settings.fields_web = DEFAULT_FIELDS_WEB;
    if (!megaState.settings.fields_wenku) megaState.settings.fields_wenku = DEFAULT_FIELDS_WENKU;

    function saveSettings() { GM_setValue(STORE_SETTINGS, megaState.settings); }
    function saveLists() { GM_setValue(STORE_LISTS, megaState.lists); }
    function getBlacklist() { try { return JSON.parse(GM_getValue(STORE_BLACKLIST, '[]')); } catch { return []; } }
    function saveBlacklist(list) { GM_setValue(STORE_BLACKLIST, JSON.stringify(list)); megaState.blacklist = list; }

    // ============================================================
    // 统一 UI 与样式注入
    // ============================================================
    if (IS_NOVELIA) {
        GM_addStyle(`
            /* 全局重置与基础变量 */
            :root {
                --mega-primary: #63e2b7;
                --mega-primary-hover: #7fe7c4;
                --mega-primary-bg: rgba(99,226,183,0.12);
                --mega-danger: #e88080;
                --mega-danger-hover: rgba(232,128,128,0.12);
            }

            /* 悬浮触发按钮 (来自黑名单助手的拖拽球) */
            #mega-trigger {
                position: fixed; z-index: 99997; width: 44px; height: 44px; border-radius: 50%;
                border: 1.5px solid rgba(99,226,183,0.5); background: var(--mega-primary-bg);
                color: var(--mega-primary); font-size: 20px; cursor: grab;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 2px 12px rgba(0,0,0,0.3); transition: background 0.2s, border-color 0.2s;
                backdrop-filter: blur(4px); touch-action: none; user-select: none;
            }
            #mega-trigger:hover { background: rgba(99,226,183,0.22); border-color: var(--mega-primary); }
            #mega-trigger.dragging { cursor: grabbing; box-shadow: 0 8px 28px rgba(0,0,0,0.5); transition: none; }
            #mega-trigger.snap-hint { border-color: var(--mega-primary); box-shadow: 0 0 0 4px rgba(99,226,183,0.25); }

            /* 主控制面板 */
            #mega-overlay {
                position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 99998;
                display: none; align-items: center; justify-content: center;
            }
            #mega-panel {
                width: 850px; max-width: 95vw; height: 650px; max-height: 85vh;
                border-radius: 8px; display: flex; flex-direction: column;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: "PingFang SC", sans-serif;
                font-size: 14px; overflow: hidden; transition: background-color 0.3s, color 0.3s;
            }

            /* 主题配色 (深色) */
            .mega-dark { background: #18181c; color: rgba(255,255,255,0.9); border: 1px solid #333; }
            .mega-dark .m-header { border-bottom: 1px solid #333; background: #202024; }
            .mega-dark .m-sidebar { border-right: 1px solid #333; background: #18181c; }
            .mega-dark .m-item, .mega-dark .m-field-item { border-bottom: 1px solid #333; }
            .mega-dark .m-item:hover { background: rgba(255,255,255,0.05); }
            .mega-dark input[type="text"], .mega-dark textarea, .mega-dark select { background: #26262a; border: 1px solid #444; color: white; }
            .mega-dark .m-btn-default { border-color: rgba(255,255,255,0.24); color: rgba(255,255,255,0.82); }
            .mega-dark .m-btn-default:hover { border-color: var(--mega-primary); color: var(--mega-primary); }

            /* 主题配色 (浅色) */
            .mega-light { background: #fff; color: #333; border: 1px solid #ccc; }
            .mega-light .m-header { border-bottom: 1px solid #eee; background: #f9f9f9; }
            .mega-light .m-sidebar { border-right: 1px solid #eee; background: #fff; }
            .mega-light .m-item, .mega-light .m-field-item { border-bottom: 1px solid #eee; }
            .mega-light .m-item:hover { background: #f5f5f5; }
            .mega-light input[type="text"], .mega-light textarea, .mega-light select { background: #fff; border: 1px solid #ccc; color: #333; }
            .mega-light .m-btn-default { border-color: rgba(0,0,0,0.2); color: #444; }
            .mega-light .m-btn-default:hover { border-color: #38b28a; color: #38b28a; }

            /* 布局组件 */
            .m-header { height: 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-weight: bold; font-size: 16px; flex-shrink: 0; }
            .m-body { flex: 1; display: flex; overflow: hidden; }
            .m-sidebar { width: 140px; display: flex; flex-direction: column; padding: 10px 0; flex-shrink: 0; }
            .m-content { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }

            .m-tab-btn { padding: 12px 20px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; border-left: 3px solid transparent; }
            .m-tab-btn.active { color: var(--mega-primary); border-left-color: var(--mega-primary); background: var(--mega-primary-bg); font-weight: bold; }
            .m-tab-pane { display: none; flex-direction: column; height: 100%; }
            .m-tab-pane.active { display: flex; }

            /* 通用按钮 */
            .m-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0 12px; height: 28px; border-radius: 3px; border: 1px solid transparent; cursor: pointer; font-size: 13px; background: transparent; transition: 0.2s; white-space: nowrap; }
            .m-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .m-btn-primary { background: var(--mega-primary-bg); border-color: var(--mega-primary) !important; color: var(--mega-primary) !important; }
            .m-btn-danger { border-color: rgba(232,128,128,0.5) !important; color: var(--mega-danger) !important; }
            .m-btn-danger:hover { background: var(--mega-danger-hover); border-color: var(--mega-danger) !important; }

            /* 列表与表单元素 */
            .m-toolbar { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; flex-shrink: 0;}
            .m-list-container { flex: 1; overflow-y: auto; border: 1px solid rgba(128,128,128,0.2); border-radius: 4px; }
            .m-item { padding: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
            .m-item input[type="checkbox"] { transform: scale(1.2); cursor: pointer; accent-color: var(--mega-primary); }

            textarea.m-editor { width: 95%; flex: 1; resize: none; padding: 15px; font-family: monospace; line-height: 1.6; outline: none; border-radius: 4px; }

            /* 设置项 */
            .m-setting-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding: 10px; border-radius: 6px; background: rgba(128,128,128,0.05); }
            .m-switch { position: relative; width: 40px; height: 20px; background: #888; border-radius: 20px; cursor: pointer; transition: 0.3s; }
            .m-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: 0.3s; }
            .m-switch.active { background: var(--mega-primary); }
            .m-switch.active::after { left: 22px; }

            /* 业务特征注入样式 (黑名单按钮等) */
            .nm-blacklist-btn { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; padding: 1px 7px; height: 20px; border-radius: 2px; border: 1px solid rgba(232, 128, 128, 0.5); color: #e88080; background: transparent; margin-right: 6px; transition: 0.2s; line-height: 1; white-space: nowrap; flex-shrink: 0; }
            .nm-blacklist-btn:hover { background: rgba(232, 128, 128, 0.15); border-color: #e88080; }
            .nm-blacklist-btn.detail { font-size: 13px; padding: 0 14px; height: 34px; border-radius: 34px; margin: 0 10px; }

            /* Toast */
            .m-toast { position: fixed; bottom: 80px; right: 24px; padding: 10px 18px; border-radius: 4px; font-size: 13px; z-index: 99999; pointer-events: none; animation: m-toast-in 0.2s ease; }
            .m-toast-success { background: rgba(99,226,183,0.2); color: #63e2b7; border: 1px solid rgba(99,226,183,0.3); }
            @keyframes m-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        `);
    }

    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'm-toast m-toast-success';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2500);
    }

    // ============================================================
    // 模块 1：LightNovel 搜索按钮
    // ============================================================
    function cleanTitleText(text) {
        let title = text.replace(/(\(|（|<|【|\[)[^)）>】\]]*?(\)|）|>|】|\])/g, '').replace(/[.,:;!?。，、！？\s\-・]+$/, '');
        const romanPattern = "(?:(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3})?|(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))";
        title = title.replace(new RegExp(`\\s*(?:LV|ep|sp|ex|extra|NO.|vol|volume)\\.?\\s*(?:\\d+|${romanPattern})`, 'gi'), '');
        title = title.replace(/[\u2160-\u217F\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]+/g, '');
        const rRegex = new RegExp(`(?:(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})(?:(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))?|(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))$`);
        title = title.replace(rRegex, (m, offset, str) => (offset > 0 && /[a-zA-Zａ-ｚＡ-Ｚ]/.test(str.charAt(offset - 1))) ? m : '');
        return title.replace(/\s+\d{1,3}$/, '').replace(/\s+0*\d+\s*$/, '').replace(/(\D+)\d+$/, '$1').replace(/[.,:;!?。，、！？\s\-・]+$/, '').trim();
    }

    function initLightNovelSearch() {
        if (!megaState.settings.enableSearchBtn || !IS_LIGHTNOVEL) return;

        GM_addStyle(`
            .m-ln-btn { display: inline-block; margin-left: 8px; padding: 2px 8px; background-color: #FAEF8B; color: white; border-radius: 4px; text-decoration: none; font-size: 12px; cursor: pointer; border: none; transition: background 0.2s; }
            .m-ln-btn:hover { background-color: #63E2B7; color: white; text-decoration: none; }
        `);

        const addSearchButtons = () => {
            document.querySelectorAll('td.title').forEach(td => {
                if (td.querySelector('.m-ln-btn')) return;
                let rawTitle = (td.childNodes.length > 0 && td.childNodes[0].nodeType === 3) ? td.childNodes[0].nodeValue.trim() : td.innerText.trim();
                const cleanName = cleanTitleText(rawTitle);
                const btn = document.createElement('a');
                btn.href = `https://n.novelia.cc/wenku?page=1&query=${encodeURIComponent(cleanName)}&selected=0`;
                btn.className = 'm-ln-btn';
                btn.innerText = '🔍 Novelia';
                btn.target = '_blank';
                btn.title = `搜索: ${cleanName}`;
                td.appendChild(btn);
            });
        };
        addSearchButtons();
        new MutationObserver((muts) => { if (muts.some(m => m.addedNodes.length > 0)) addSearchButtons(); }).observe(document.body, { childList: true, subtree: true });
    }

    // ============================================================
    // 模块 2：黑名单助手
    // ============================================================
    function normalizeUrl(url) { try { return new URL(url, location.origin).pathname; } catch { return url.replace(/^https?:\/\/[^/]+/, ''); } }
    function isBlacklisted(url) { return megaState.blacklist.some(item => item.url === normalizeUrl(url)); }

    function initBlacklistDOM() {
        if (!megaState.settings.enableBlacklist || !IS_NOVELIA) return;

        // 列表页处理
        const processList = () => {
            document.querySelectorAll('.n-list-item__main').forEach(item => {
                if (item.dataset.megaBlProcessed) return;
                item.dataset.megaBlProcessed = '1';

                const link = item.querySelector('a.n-a.__a-dark-131ezvy, a[href*="/novel/"]');
                if (!link) return;
                const href = link.getAttribute('href');

                if (isBlacklisted(href)) {
                    const listItem = item.closest('.n-list-item') || item.parentElement;
                    if (listItem) { listItem.style.display = 'none'; listItem.dataset.nmHidden = '1'; }
                    return;
                }

                const btn = document.createElement('button');
                btn.className = 'nm-blacklist-btn';
                btn.textContent = '拉黑';
                btn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const title = link.textContent.trim();
                    const list = getBlacklist();
                    if (!list.find(x => x.url === normalizeUrl(href))) list.push({ url: normalizeUrl(href), title, addedAt: Date.now() });
                    saveBlacklist(list);
                    const listItem = item.closest('.n-list-item') || item.parentElement;
                    if (listItem) { listItem.style.display = 'none'; listItem.dataset.nmHidden = '1'; }
                    showToast(`《${title}》已加入黑名单`);
                    if(megaState.panelOpen && megaState.activeTab === 'tab-blacklist') renderBlacklistTab();
                };

                const wrapper = document.createElement('span');
                wrapper.style.cssText = 'display:inline-flex;align-items:center;';
                link.parentNode.insertBefore(wrapper, link);
                wrapper.appendChild(btn);
                wrapper.appendChild(link);
            });
        };

        // 详情页处理
        const processDetail = () => {
            const flexes = Array.from(document.querySelectorAll('.n-flex')).filter(f => {
                const t = f.textContent; return (t.includes('开始阅读') || t.includes('继续阅读')) && (t.includes('收藏') || t.includes('编辑'));
            });
            if (flexes.length === 0) return;
            const actionFlex = flexes[flexes.length - 1]; // 关键修复：获取最内层容器
            if (actionFlex.dataset.megaBlProcessed) return;
            actionFlex.dataset.megaBlProcessed = '1';

            const novelPath = normalizeUrl(location.href);
            const pageTitle = document.title.replace(' | 轻小说机翻机器人', '').trim();
            const btn = document.createElement('button');
            btn.className = 'nm-blacklist-btn detail';

            const update = () => {
                if (isBlacklisted(novelPath)) { btn.textContent = '已拉黑'; btn.style.opacity = '0.6'; }
                else { btn.textContent = '拉黑'; btn.style.opacity = '1'; }
            };
            update();

            btn.onclick = () => {
                let list = getBlacklist();
                if (isBlacklisted(novelPath)) {
                    list = list.filter(x => x.url !== novelPath);
                    showToast('已从黑名单移除');
                } else {
                    list.push({ url: novelPath, title: pageTitle, addedAt: Date.now() });
                    showToast(`《${pageTitle}》已加入黑名单`);
                }
                saveBlacklist(list);
                update();
                if(megaState.panelOpen && megaState.activeTab === 'tab-blacklist') renderBlacklistTab();
            };
            actionFlex.appendChild(btn);
        };

        const router = () => {
            if (/^\/novel\/?(\?|$)/.test(location.pathname) || /^\/novel$/.test(location.pathname)) processList();
            else if (/^\/novel\/[^/]+\/[^/]+\/?$/.test(location.pathname)) processDetail();
        };

        new MutationObserver(() => setTimeout(router, 300)).observe(document.body, { childList: true, subtree: true });
        router();
    }

    // ============================================================
    // 模块 3：文库简介自动排版
    // ============================================================
    function initFormatter() {
        // 🌟 修复核心 1：入口处只检查开关状态，不再检查 URL
        // 这样只要功能开启，无论在哪个页面都会启动监听器
        if (!megaState.settings.enableFormatter) return;

        const formatText = (text) => {
            let cleanText = text.replace(/[\s\u3000]+/g, '');
            if (cleanText.length > 500) return text;
            let lines = [], p = 0;
            const puncRegex = /[。\.！!？\?—\-；;：:”’」』》>）\)】\]}…]/;

            while (p < cleanText.length) {
                let maxLookahead = p + 71, absoluteBreak = -1;
                for (let k = p; k < Math.min(cleanText.length, maxLookahead); k++) {
                    if ((cleanText[k] === '”' && cleanText[k+1] === '“') || (cleanText[k] === '」' && cleanText[k+1] === '「') || (cleanText[k] === '』' && cleanText[k+1] === '『')) { absoluteBreak = k; break; }
                    if (k > p && cleanText[k] === '●') { absoluteBreak = k - 1; break; }
                }
                if (absoluteBreak !== -1) { lines.push(cleanText.substring(p, absoluteBreak + 1)); p = absoluteBreak + 1; continue; }
                if (cleanText.length - p <= 71) {
                    let remainingBreak = -1;
                    for (let k = p; k < cleanText.length - 1; k++) {
                        if ((cleanText[k] === '”' && cleanText[k+1] === '“') || (cleanText[k] === '」' && cleanText[k+1] === '「') || (cleanText[k] === '』' && cleanText[k+1] === '『')) { remainingBreak = k; break; }
                        if (k > p && cleanText[k] === '●') { remainingBreak = k - 1; break; }
                    }
                    if (remainingBreak !== -1) { lines.push(cleanText.substring(p, remainingBreak + 1)); p = remainingBreak + 1; }
                    else { lines.push(cleanText.substring(p)); p = cleanText.length; }
                    continue;
                }
                let lastPunc = -1;
                for (let k = p + 70; k >= p; k--) { if (puncRegex.test(cleanText[k])) { lastPunc = k; break; } }
                if (lastPunc !== -1) {
                    while (lastPunc + 1 < cleanText.length && (cleanText[lastPunc + 1] === '—' || cleanText[lastPunc + 1] === '…')) lastPunc++;
                    lines.push(cleanText.substring(p, lastPunc + 1)); p = lastPunc + 1;
                } else {
                    let nextPunc = -1;
                    for (let k = p + 71; k < cleanText.length; k++) {
                        if (puncRegex.test(cleanText[k])) { nextPunc = k; while (nextPunc + 1 < cleanText.length && (cleanText[nextPunc + 1] === '—' || cleanText[nextPunc + 1] === '…')) nextPunc++; break; }
                        if (cleanText[k] === '●' && k > p) { nextPunc = k - 1; break; }
                        if (k < cleanText.length - 1 && ((cleanText[k] === '”' && cleanText[k+1] === '“') || (cleanText[k] === '」' && cleanText[k+1] === '「') || (cleanText[k] === '』' && cleanText[k+1] === '『'))) { nextPunc = k; break; }
                    }
                    if (nextPunc !== -1) { lines.push(cleanText.substring(p, nextPunc + 1)); p = nextPunc + 1; }
                    else { lines.push(cleanText.substring(p)); p = cleanText.length; }
                }
            }
            return lines.join('\n');
        };

        const inject = () => {
            // 🌟 修复核心 2：将 URL 检查移动到注入逻辑内部
            if (!location.href.includes('/wenku-edit/')) return;
            if (document.getElementById('mega-format-btn')) return;

            const labels = Array.from(document.querySelectorAll('span.n-form-item-label__text'));
            const wrapper = labels.find(l => l.textContent.trim() === '分级')?.closest('.n-form-item')?.querySelector('.n-form-item-feedback-wrapper');
            const textarea = labels.find(l => l.textContent.trim() === '简介')?.closest('.n-form-item')?.querySelector('textarea') || document.querySelector('textarea[placeholder="请输入小说简介"]');

            if (wrapper && textarea) {
                const btn = document.createElement('button');
                btn.id = 'mega-format-btn';
                btn.className = document.querySelector('.n-button--primary-type')?.className || 'n-button n-button--primary-type';
                btn.innerHTML = '<span class="n-button__content">自动排版</span>';
                btn.style.cssText = 'height:1.25em; line-height:1.25; min-height:unset; padding:0 10px; font-size:12px;';

                wrapper.style.cssText = 'display:flex; justify-content:flex-end; align-items:center;';
                btn.onclick = (e) => {
                    e.preventDefault();
                    const newText = formatText(textarea.value);
                    if (newText !== textarea.value) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                        setter.call(textarea, newText);
                        textarea.dispatchEvent(new Event("input", { bubbles: true }));
                        showToast('排版完成');
                    }
                };
                wrapper.appendChild(btn);
            }
        };

        // 🌟 修复核心 3：无论在哪个页面，都立刻启动 Body 监听
        // 当用户从详情页点击编辑时，Body 的变化会触发 inject 检查 URL 并完成注入
        new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
        inject();
    }

    // ============================================================
    // 综合 UI 管理器 (触发器 & 面板)
    // ============================================================
    function initMegaUI() {
        if (!IS_NOVELIA) return;

        // --- 悬浮按钮 (带拖拽) ---
        const btn = document.createElement('div');
        btn.id = 'mega-trigger';
        btn.innerHTML = `📚`;
        btn.title = 'Novelia 综合管理面板';
        document.body.appendChild(btn);

        const pos = GM_getValue(STORE_UI_POS, { x: window.innerWidth - 60, y: window.innerHeight - 80 });
        const clamp = (x, y) => ({ x: Math.max(16, Math.min(x, window.innerWidth - 60)), y: Math.max(16, Math.min(y, window.innerHeight - 60)) });
        const applyPos = (x, y) => { btn.style.left = x + 'px'; btn.style.top = y + 'px'; };
        applyPos(clamp(pos.x, pos.y).x, clamp(pos.x, pos.y).y);

        let isDragging = false, hasMoved = false, startX, startY, offX, offY;
        btn.onmousedown = (e) => {
            if (e.button !== 0) return;
            isDragging = true; hasMoved = false;
            const rect = btn.getBoundingClientRect();
            offX = e.clientX - rect.left; offY = e.clientY - rect.top;
            startX = e.clientX; startY = e.clientY;
            btn.classList.add('dragging');
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) hasMoved = true;
            const c = clamp(e.clientX - offX, e.clientY - offY);
            applyPos(c.x, c.y);
            btn.classList.toggle('snap-hint', c.x <= 26 || c.x >= window.innerWidth - 70);
        };
        document.onmouseup = (e) => {
            if (!isDragging) return;
            isDragging = false; btn.classList.remove('dragging', 'snap-hint');
            if (hasMoved) {
                const c = clamp(parseInt(btn.style.left), parseInt(btn.style.top));
                const snapX = c.x < window.innerWidth / 2 ? 16 : window.innerWidth - 60;
                btn.style.transition = 'left 0.25s, top 0.25s';
                applyPos(snapX, c.y);
                setTimeout(() => { btn.style.transition = ''; }, 280);
                GM_setValue(STORE_UI_POS, { x: snapX, y: c.y });
            } else {
                togglePanel();
            }
        };

        // --- 主面板结构 ---
        const overlay = document.createElement('div');
        overlay.id = 'mega-overlay';
        overlay.innerHTML = `
            <div id="mega-panel">
                <div class="m-header">
                    <span>Novelia 综合管理中心</span>
                    <div style="cursor:pointer; font-size:18px;" id="m-close">✕</div>
                </div>
                <div class="m-body">
                    <div class="m-sidebar">
                        <div class="m-tab-btn active" data-tab="tab-extract">🔍 抓取书籍</div>
                        <div class="m-tab-btn" data-tab="tab-list">📝 书单管理</div>
                        <div class="m-tab-btn" data-tab="tab-blacklist">🚫 黑名单</div>
                        <div class="m-tab-btn" data-tab="tab-settings">⚙️ 全局设置</div>
                    </div>
                    <div class="m-content">
                        <div class="m-tab-pane active" id="tab-extract">
                            <div class="m-toolbar">
                                <button class="m-btn m-btn-default m-btn-primary" id="btn-scan">重新扫描当前页</button>
                                <button class="m-btn m-btn-default" id="btn-sel-all">全选</button>
                                <button class="m-btn m-btn-default" id="btn-sel-inv">反选</button>
                                <div style="flex:1"></div>
                                <select class="m-btn m-btn-default" id="sel-target-list" style="width:120px"></select>
                                <button class="m-btn m-btn-default m-btn-primary" id="btn-add-list">加入书单</button>
                            </div>
                            <div class="m-list-container" id="list-extract"></div>
                        </div>

                        <div class="m-tab-pane" id="tab-list">
                            <div class="m-toolbar">
                                <select class="m-btn m-btn-default" id="sel-manage-list" style="width:150px"></select>
                                <button class="m-btn m-btn-default" id="btn-new-list">新建</button>
                                <button class="m-btn m-btn-default m-btn-danger" id="btn-del-list">删除</button>
                                <div style="flex:1"></div>
                                <button class="m-btn m-btn-default" id="btn-copy-list">复制内容</button>
                            </div>
                            <textarea class="m-editor" id="editor-list"></textarea>
                        </div>

                        <div class="m-tab-pane" id="tab-blacklist">
                             <div class="m-toolbar">
                                <button class="m-btn m-btn-default" id="bl-sel-all">全选</button>
                                <button class="m-btn m-btn-default" id="bl-sel-inv">反选</button>
                                <button class="m-btn m-btn-default m-btn-danger" id="bl-del">删除选中</button>
                                <div style="flex:1"></div>
                                <span style="font-size:12px;opacity:0.6" id="bl-count"></span>
                            </div>
                            <div class="m-list-container" id="list-blacklist" style="display:flex; flex-direction:column; gap:4px; padding:10px;"></div>
                        </div>

                        <div class="m-tab-pane" id="tab-settings">
                            <h3 style="margin-top:0;">模块开关 (全局生效)</h3>
                            <div class="m-setting-row"><span>启用 LightNovel.jp 搜索按钮跳转</span><div class="m-switch" data-key="enableSearchBtn"></div></div>
                            <div class="m-setting-row"><span>启用 书单抓取与制作助手 (本面板功能)</span><div class="m-switch" data-key="enableBookList"></div></div>
                            <div class="m-setting-row"><span>启用 小说黑名单隐藏机制</span><div class="m-switch" data-key="enableBlacklist"></div></div>
                            <div class="m-setting-row"><span>启用 文库编辑页简介自动排版</span><div class="m-switch" data-key="enableFormatter"></div></div>

                            <h3>界面设置</h3>
                            <div class="m-setting-row">
                                <span>面板主题</span>
                                <select id="sel-theme" class="m-btn m-btn-default">
                                    <option value="auto">跟随网页</option><option value="dark">深色</option><option value="light">浅色</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // --- UI 事件绑定与主题控制 ---
        document.getElementById('m-close').onclick = () => togglePanel();
        overlay.onclick = (e) => { if(e.target === overlay) togglePanel(); };

        const updateTheme = () => {
            const p = document.getElementById('mega-panel');
            let t = megaState.settings.theme;
            if (t === 'auto') {
                const rgb = window.getComputedStyle(document.body).backgroundColor;
                const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                t = (match && ((parseInt(match[1])*299 + parseInt(match[2])*587 + parseInt(match[3])*114)/1000) < 128) ? 'dark' : 'light';
            }
            p.className = t === 'dark' ? 'mega-dark' : 'mega-light';
        };

        const togglePanel = () => {
            megaState.panelOpen = !megaState.panelOpen;
            overlay.style.display = megaState.panelOpen ? 'flex' : 'none';
            if (megaState.panelOpen) {
                updateTheme();
                renderTabs();
            }
        };

        // Tab 切换逻辑
        document.querySelectorAll('.m-tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.m-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.m-tab-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                megaState.activeTab = btn.dataset.tab;
                document.getElementById(megaState.activeTab).classList.add('active');
                renderTabs();
            };
        });

        // 定时检查主题变化
        setInterval(() => { if (megaState.panelOpen && megaState.settings.theme === 'auto') updateTheme(); }, 2000);

        initExtractTab();
        initListTab();
        initBlacklistTab();
        initSettingsTab();
    }

    // --- 书籍提取逻辑 ---
    function performExtraction() {
        const url = window.location.href;
        const isWenku = url.includes('/wenku') || url.includes('/favorite/wenku');
        let items = [];

        if (url.includes('/novel') || url.includes('/favorite/web') || url.includes('/read-history')) {
            document.querySelectorAll('.n-list-item').forEach(el => {
                const mainDiv = el.querySelector('.n-list-item__main > div');
                if (!mainDiv) return;
                const a = mainDiv.querySelector('a:first-child');
                const cnNode = mainDiv.querySelector('span.n-text.__text-dark-131ezvy-d');
                let status = "未知", chapters = "未知";
                for (let s of mainDiv.querySelectorAll('span')) {
                    if (s.textContent.includes('连载中')) status = '连载中';
                    else if (s.textContent.includes('已完结')) status = '已完结';
                    const chapMatch = s.textContent.match(/总计\s*(\d+)/);
                    if (chapMatch) chapters = chapMatch[1];
                }
                items.push({
                    type: 'web', jp_title: a ? a.innerText.trim() : '',
                    cn_title: cnNode ? cnNode.innerText.trim() : (a ? a.innerText.trim() : ''),
                    link: a ? a.href : '', status, chapters, tags: []
                });
            });
        } else if (isWenku) {
            document.querySelectorAll('.n-grid > div').forEach(el => {
                const linkEl = el.querySelector('a');
                if (!linkEl) return;
                const titleDiv = el.querySelector('.n-text.text-2line');
                items.push({ type: 'wenku', cn_title: titleDiv ? titleDiv.innerText.replace(/[\n\r]+|[\s]{2,}/g, ' ').trim() : '未命名', link: linkEl.href, jp_title: '', tags: [], status: '文库', chapters: 'N/A' });
            });
        }
        return items;
    }

    function initExtractTab() {
        document.getElementById('btn-scan').onclick = () => {
            document.getElementById('list-extract').innerHTML = '<div style="padding:40px;text-align:center;">⏳ 正在重新扫描...</div>';
            setTimeout(() => { megaState.extractData = performExtraction(); megaState.selectedExtract.clear(); renderExtractList(); }, 50);
        };
        document.getElementById('btn-sel-all').onclick = () => { megaState.extractData.forEach((_, i) => megaState.selectedExtract.add(i)); renderExtractList(); };
        document.getElementById('btn-sel-inv').onclick = () => {
            const newSet = new Set();
            megaState.extractData.forEach((_, i) => { if (!megaState.selectedExtract.has(i)) newSet.add(i); });
            megaState.selectedExtract = newSet; renderExtractList();
        };
        document.getElementById('btn-add-list').onclick = () => {
            const target = document.getElementById('sel-target-list').value;
            if (!target) return alert('请先创建书单');
            const list = megaState.lists[target] || [];
            const fields = megaState.extractData.some(b => b.type === 'wenku') ? megaState.settings.fields_wenku : megaState.settings.fields_web;

            megaState.selectedExtract.forEach(idx => {
                const b = megaState.extractData[idx];
                let text = fields.filter(f => f.active).map(f => f.format.replace(/{{jp_title}}/g, b.jp_title||b.cn_title||'').replace(/{{cn_title}}/g, b.cn_title||b.jp_title).replace(/{{link}}/g, b.link||'').replace(/{{status}}/g, b.status||'').replace(/{{chapters}}/g, b.chapters||'')).join('\n');
                list.push(text + '\n');
            });
            megaState.lists[target] = list; saveLists();
            megaState.selectedExtract.clear(); renderExtractList();
            showToast(`已添加至 ${target}`);
        };
    }

    function renderExtractList() {
        const c = document.getElementById('list-extract');
        c.innerHTML = megaState.extractData.length ? '' : '<div style="padding:40px;text-align:center;opacity:0.6;">当前页面未检测到有效书籍</div>';
        megaState.extractData.forEach((book, i) => {
            const div = document.createElement('div');
            div.className = 'm-item';
            div.innerHTML = `<input type="checkbox" ${megaState.selectedExtract.has(i) ? 'checked' : ''}><div style="flex:1"><div style="font-weight:bold;">${book.cn_title}</div><div style="font-size:12px;opacity:0.7;">${book.status} · ${book.chapters}</div></div>`;
            div.onclick = (e) => {
                if (e.target.tagName !== 'INPUT') div.querySelector('input').checked = !div.querySelector('input').checked;
                div.querySelector('input').checked ? megaState.selectedExtract.add(i) : megaState.selectedExtract.delete(i);
            };
            c.appendChild(div);
        });

        const sel = document.getElementById('sel-target-list');
        sel.innerHTML = '';
        Object.keys(megaState.lists).forEach(k => sel.appendChild(new Option(k, k, false, k === megaState.currentListId)));
    }

    // --- 书单管理逻辑 ---
    function initListTab() {
        const sel = document.getElementById('sel-manage-list'), ed = document.getElementById('editor-list');
        const updateEditor = () => { megaState.currentListId = sel.value; ed.value = (megaState.lists[sel.value] || []).join('\n'); };
        sel.onchange = updateEditor;
        ed.oninput = () => { megaState.lists[megaState.currentListId] = [ed.value]; saveLists(); };

        document.getElementById('btn-new-list').onclick = () => {
            const n = prompt("新书单名称：");
            if (n && !megaState.lists[n]) { megaState.lists[n] = []; megaState.currentListId = n; saveLists(); renderListTabUI(); }
        };
        document.getElementById('btn-del-list').onclick = () => {
            if (confirm(`删除 "${megaState.currentListId}"？`)) {
                delete megaState.lists[megaState.currentListId];
                megaState.currentListId = Object.keys(megaState.lists)[0] || '';
                saveLists(); renderListTabUI();
            }
        };
        document.getElementById('btn-copy-list').onclick = () => { GM_setClipboard(ed.value); showToast('已复制'); };
    }

    function renderListTabUI() {
        const sel = document.getElementById('sel-manage-list');
        sel.innerHTML = '';
        Object.keys(megaState.lists).forEach(k => sel.appendChild(new Option(k, k, false, k === megaState.currentListId)));
        document.getElementById('editor-list').value = (megaState.lists[megaState.currentListId] || []).join('\n');
    }

    // --- 黑名单逻辑 ---
    function initBlacklistTab() {
        document.getElementById('bl-sel-all').onclick = () => {
            const all = megaState.selectedBlacklist.size === megaState.blacklist.length;
            megaState.selectedBlacklist = all ? new Set() : new Set(megaState.blacklist.map(x => x.url));
            renderBlacklistTab();
        };
        document.getElementById('bl-sel-inv').onclick = () => {
            const newSet = new Set();
            megaState.blacklist.forEach(x => { if (!megaState.selectedBlacklist.has(x.url)) newSet.add(x.url); });
            megaState.selectedBlacklist = newSet; renderBlacklistTab();
        };
        document.getElementById('bl-del').onclick = () => {
            if (!megaState.selectedBlacklist.size) return;
            const newList = megaState.blacklist.filter(x => !megaState.selectedBlacklist.has(x.url));
            saveBlacklist(newList);
            megaState.selectedBlacklist.clear();
            renderBlacklistTab();
            showToast('已删除选中黑名单');
            // 触发页面元素重新过滤
            document.querySelectorAll('.n-list-item__main').forEach(i => delete i.dataset.megaBlProcessed);
        };
    }

    function renderBlacklistTab() {
        document.getElementById('bl-count').textContent = `共 ${megaState.blacklist.length} 条记录`;
        const c = document.getElementById('list-blacklist');
        c.innerHTML = megaState.blacklist.length ? '' : '<div style="padding:40px;text-align:center;opacity:0.6;">黑名单为空</div>';

        megaState.blacklist.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 10px; border-radius:4px; transition:0.2s;';
            row.className = 'm-item';
            row.innerHTML = `
                <input type="checkbox" ${megaState.selectedBlacklist.has(item.url) ? 'checked' : ''}>
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || '无标题'}</div>
                <div style="font-size:11px; opacity:0.5; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${item.url}</div>
            `;
            row.onclick = (e) => {
                if (e.target.tagName !== 'INPUT') row.querySelector('input').checked = !row.querySelector('input').checked;
                row.querySelector('input').checked ? megaState.selectedBlacklist.add(item.url) : megaState.selectedBlacklist.delete(item.url);
            };
            c.appendChild(row);
        });
    }

    // --- 设置逻辑 ---
    function initSettingsTab() {
        document.querySelectorAll('.m-switch').forEach(sw => {
            const key = sw.dataset.key;
            if (megaState.settings[key]) sw.classList.add('active');
            sw.onclick = () => {
                megaState.settings[key] = !megaState.settings[key];
                sw.classList.toggle('active', megaState.settings[key]);
                saveSettings();
                showToast('设置已保存，刷新页面后生效');
            };
        });

        const selTheme = document.getElementById('sel-theme');
        selTheme.value = megaState.settings.theme;
        selTheme.onchange = () => {
            megaState.settings.theme = selTheme.value;
            saveSettings();
            // 立即触发主题更新
            const p = document.getElementById('mega-panel');
            p.className = selTheme.value === 'dark' ? 'mega-dark' : 'mega-light';
        };
    }

    function renderTabs() {
        if (megaState.activeTab === 'tab-extract') {
            if (megaState.settings.enableBookList && megaState.extractData.length === 0) {
                megaState.extractData = performExtraction();
            }
            renderExtractList();
        }
        else if (megaState.activeTab === 'tab-list') renderListTabUI();
        else if (megaState.activeTab === 'tab-blacklist') renderBlacklistTab();
    }

    // ============================================================
    // 初始化路由引擎
    // ============================================================
    function bootstrap() {
        // 全局生效模块
        initLightNovelSearch();
        initBlacklistDOM();
        initFormatter();

        // 面板渲染
        if (IS_NOVELIA) {
            initMegaUI();
        }
    }

    // ============================================================
    // 初始化路由引擎
    // ============================================================
    let isMegaInitialized = false;

    // 将 bootstrap 改名为 initMegaPack
    function initMegaPack() {
        if (isMegaInitialized) return;
        isMegaInitialized = true;

        // 全局生效模块
        initLightNovelSearch();
        initBlacklistDOM();
        initFormatter();

        // 面板渲染
        if (IS_NOVELIA) {
            initMegaUI();
        }
    }

    // 将下面所有的 bootstrap 调用都改成 initMegaPack
    const pushState = history.pushState;
    history.pushState = function() { pushState.apply(history, arguments); setTimeout(initMegaPack, 500); };
    window.addEventListener('popstate', () => setTimeout(initMegaPack, 500));

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMegaPack);
    } else {
        initMegaPack();
    }

})();
