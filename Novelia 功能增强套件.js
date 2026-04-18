// ==UserScript==
// @name         Novelia 功能增强套件
// @namespace    https://n.novelia.cc/
// @version      2.4.1
// @description  整合LightNovel搜索、书单助手、黑名单、简介排版、论坛管理。支持统一UI、字段排序、书单预览与导入导出。
// @author       Gemini
// @match        https://n.novelia.cc/*
// @match        https://lightnovel.jp/publicationdate/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL        https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/Novelia%20%E5%8A%9F%E8%83%BD%E5%A2%9E%E5%BC%BA%E5%A5%97%E4%BB%B6.js
// @downloadURL      https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/Novelia%20%E5%8A%9F%E8%83%BD%E5%A2%9E%E5%BC%BA%E5%A5%97%E4%BB%B6.js
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
    const STORE_FORUM_MY = 'nv_my_posts';
    const STORE_FORUM_FAV = 'nv_fav_posts';

    const IS_NOVELIA = location.hostname.includes('novelia.cc') || location.hostname.includes('sakura-share.one');
    const IS_LIGHTNOVEL = location.hostname.includes('lightnovel.jp');

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
            enableForumManager: true,
            fields_web: DEFAULT_FIELDS_WEB,
            fields_wenku: DEFAULT_FIELDS_WENKU
        }),
        lists: GM_getValue(STORE_LISTS, { '默认书单': [] }),
        blacklist: getBlacklist(),
        forumMyPosts: GM_getValue(STORE_FORUM_MY, {}),
        forumFavPosts: GM_getValue(STORE_FORUM_FAV, {}),
        currentListId: '默认书单',
        extractData: [],
        selectedExtract: new Set(),
        selectedBlacklist: new Set(),
        panelOpen: false,
        activeTab: 'tab-extract',
        forumSearchMy: '', forumSortMy: 'timeDesc',
        forumSearchFav: '', forumSortFav: 'timeDesc'
    };

    if (!megaState.settings.fields_web) megaState.settings.fields_web = DEFAULT_FIELDS_WEB;
    if (!megaState.settings.fields_wenku) megaState.settings.fields_wenku = DEFAULT_FIELDS_WENKU;
    if (megaState.settings.enableForumManager === undefined) megaState.settings.enableForumManager = true;

    function saveSettings() { GM_setValue(STORE_SETTINGS, megaState.settings); }
    function saveLists() { GM_setValue(STORE_LISTS, megaState.lists); }
    function getBlacklist() { try { return JSON.parse(GM_getValue(STORE_BLACKLIST, '[]')); } catch { return []; } }
    function saveBlacklist(list) { GM_setValue(STORE_BLACKLIST, JSON.stringify(list)); megaState.blacklist = list; }
    function saveForumData() {
        GM_setValue(STORE_FORUM_MY, megaState.forumMyPosts);
        GM_setValue(STORE_FORUM_FAV, megaState.forumFavPosts);
    }

    // ============================================================
    // 统一 UI 与样式注入
    // ============================================================
    if (IS_NOVELIA) {
        GM_addStyle(`
            :root {
                --mega-primary: #63e2b7;
                --mega-primary-hover: #7fe7c4;
                --mega-primary-bg: rgba(99,226,183,0.12);
                --mega-danger: #e88080;
                --mega-danger-hover: rgba(232,128,128,0.12);
            }
            #mega-trigger { position: fixed; z-index: 99997; width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid rgba(99,226,183,0.5); background: var(--mega-primary-bg); color: var(--mega-primary); font-size: 20px; cursor: grab; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 12px rgba(0,0,0,0.3); transition: background 0.2s, border-color 0.2s; backdrop-filter: blur(4px); touch-action: none; user-select: none; }
            #mega-trigger:hover { background: rgba(99,226,183,0.22); border-color: var(--mega-primary); }
            #mega-trigger.dragging { cursor: grabbing; box-shadow: 0 8px 28px rgba(0,0,0,0.5); transition: none; }
            #mega-trigger.snap-hint { border-color: var(--mega-primary); box-shadow: 0 0 0 4px rgba(99,226,183,0.25); }

            #mega-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 99998; display: none; align-items: center; justify-content: center; }
            #mega-panel { width: 950px; max-width: 95vw; height: 700px; max-height: 85vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: "PingFang SC", sans-serif; font-size: 14px; overflow: hidden; transition: background-color 0.3s, color 0.3s; }

            .mega-dark { background: #18181c; color: rgba(255,255,255,0.9); border: 1px solid #333; }
            .mega-dark .m-header { border-bottom: 1px solid #333; background: #202024; }
            .mega-dark .m-sidebar { border-right: 1px solid #333; background: #18181c; }
            .mega-dark .m-item, .mega-dark .m-field-item, .mega-dark .m-table th, .mega-dark .m-table td { border-bottom: 1px solid #333; }
            .mega-dark .m-item:hover, .mega-dark .m-table tbody tr:hover { background: rgba(255,255,255,0.05); }
            .mega-dark input[type="text"], .mega-dark textarea, .mega-dark select { background: #26262a; border: 1px solid #444; color: white; }
            .mega-dark .m-btn-default { border-color: rgba(255,255,255,0.24); color: rgba(255,255,255,0.82); }
            .mega-dark .m-btn-default:hover { border-color: var(--mega-primary); color: var(--mega-primary); }

            .mega-light { background: #fff; color: #333; border: 1px solid #ccc; }
            .mega-light .m-header { border-bottom: 1px solid #eee; background: #f9f9f9; }
            .mega-light .m-sidebar { border-right: 1px solid #eee; background: #fff; }
            .mega-light .m-item, .mega-light .m-field-item, .mega-light .m-table th, .mega-light .m-table td { border-bottom: 1px solid #eee; }
            .mega-light .m-item:hover, .mega-light .m-table tbody tr:hover { background: #f5f5f5; }
            .mega-light input[type="text"], .mega-light textarea, .mega-light select { background: #fff; border: 1px solid #ccc; color: #333; }
            .mega-light .m-btn-default { border-color: rgba(0,0,0,0.2); color: #444; }
            .mega-light .m-btn-default:hover { border-color: #38b28a; color: #38b28a; }

            .m-header { height: 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-weight: bold; font-size: 16px; flex-shrink: 0; }
            .m-body { flex: 1; display: flex; overflow: hidden; }
            .m-sidebar { width: 140px; display: flex; flex-direction: column; padding: 10px 0; flex-shrink: 0; overflow-y: auto;}
            .m-content { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }

            .m-tab-btn { padding: 12px 20px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; border-left: 3px solid transparent; }
            .m-tab-btn.active { color: var(--mega-primary); border-left-color: var(--mega-primary); background: var(--mega-primary-bg); font-weight: bold; }
            .m-tab-pane { display: none; flex-direction: column; height: 100%; }
            .m-tab-pane.active { display: flex; }

            .m-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0 12px; height: 28px; border-radius: 3px; border: 1px solid transparent; cursor: pointer; font-size: 13px; background: transparent; transition: 0.2s; white-space: nowrap; }
            .m-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .m-btn-primary { background: var(--mega-primary-bg); border-color: var(--mega-primary) !important; color: var(--mega-primary) !important; }
            .m-btn-danger { border-color: rgba(232,128,128,0.5) !important; color: var(--mega-danger) !important; }
            .m-btn-danger:hover { background: var(--mega-danger-hover); border-color: var(--mega-danger) !important; }
            .m-input { padding: 0 10px; height: 28px; border-radius: 3px; border: 1px solid; font-size: 13px; outline: none; }

            .m-toolbar { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; flex-shrink: 0;}
            .m-list-container { flex: 1; overflow-y: auto; border: 1px solid rgba(128,128,128,0.2); border-radius: 4px; }
            .m-item { padding: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
            .m-item input[type="checkbox"] { transform: scale(1.2); cursor: pointer; accent-color: var(--mega-primary); }
            textarea.m-editor { flex: 1; resize: none; padding: 15px; font-family: monospace; line-height: 1.6; outline: none; border-radius: 4px; box-sizing: border-box; }

            .m-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .m-table th, .m-table td { padding: 10px 10px; text-align: left; vertical-align: middle; }
            .m-table a { color: var(--mega-primary); text-decoration: none; transition: 0.2s; }
            .m-table a:hover { opacity: 0.8; text-decoration: underline; }
            .m-col-time, .m-col-stats, .m-col-action { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .m-table.fav-table .m-col-title { width: 57%; }
            .m-table.fav-table .m-col-time { width: 15%; }
            .m-table.fav-table .m-col-stats { width: 16%; }
            .m-table.fav-table .m-col-action { width: 12%; text-align: center; }

            .m-table.my-table .m-col-title { width: calc(67%); }
            .m-table.my-table .m-col-time { width: 15%; }
            .m-table.my-table .m-col-stats { width: calc(18%); }

            .m-title-wrap { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.5; font-weight: 500; }
            .m-diff-up { color: #e88080; font-size: 12px; margin-left: 4px; font-weight: bold; }
            .m-recent-update { color: #f2c97d; font-size: 11px; border: 1px solid #f2c97d; padding: 1px 4px; border-radius: 4px; margin-left: 8px; vertical-align: top; white-space: nowrap; }
            .m-star-icon { display: inline-flex; align-items: center; color: #f2c97d; margin-right: 6px; }
            .m-star-icon svg { width: 14px; height: 14px; }

            .m-setting-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 10px; border-radius: 6px; background: rgba(128,128,128,0.05); }
            .m-switch { position: relative; width: 40px; height: 20px; background: #888; border-radius: 20px; cursor: pointer; transition: 0.3s; }
            .m-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: 0.3s; }
            .m-switch.active { background: var(--mega-primary); }
            .m-switch.active::after { left: 22px; }

            .nm-blacklist-btn { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; padding: 1px 7px; height: 20px; border-radius: 2px; border: 1px solid rgba(232, 128, 128, 0.5); color: #e88080; background: transparent; margin-right: 6px; transition: 0.2s; line-height: 1; white-space: nowrap; flex-shrink: 0; }
            .nm-blacklist-btn:hover { background: rgba(232, 128, 128, 0.15); border-color: #e88080; }
            .nm-blacklist-btn.detail { font-size: 13px; padding: 0 14px; height: 34px; border-radius: 34px; margin: 0 10px; }

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
    function initLightNovelSearch() {
        if (!megaState.settings.enableSearchBtn || !IS_LIGHTNOVEL) return;

        GM_addStyle(`.m-ln-btn { display: inline-block; margin-left: 8px; padding: 2px 8px; background-color: #FAEF8B; color: white; border-radius: 4px; text-decoration: none; font-size: 12px; cursor: pointer; border: none; transition: background 0.2s; } .m-ln-btn:hover { background-color: #63E2B7; color: white; text-decoration: none; }`);

        const cleanTitleText = (text) => {
            let title = text.replace(/(\(|（|<|【|\[)[^)）>】\]]*?(\)|）|>|】|\])/g, '').replace(/[.,:;!?。，、！？\s\-・]+$/, '');
            const rp = "(?:(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3})?|(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))";
            title = title.replace(new RegExp(`\\s*(?:LV|ep|sp|ex|extra|NO.|vol|volume)\\.?\\s*(?:\\d+|${rp})`, 'gi'), '').replace(/[\u2160-\u217F\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]+/g, '');
            const rr = new RegExp(`(?:(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})(?:(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))?|(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))$`);
            title = title.replace(rr, (m, offset, str) => (offset > 0 && /[a-zA-Zａ-ｚＡ-Ｚ]/.test(str.charAt(offset - 1))) ? m : '');
            return title.replace(/\s+\d{1,3}$/, '').replace(/\s+0*\d+\s*$/, '').replace(/(\D+)\d+$/, '$1').replace(/[.,:;!?。，、！？\s\-・]+$/, '').trim();
        };

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

        const processDetail = () => {
            const flexes = Array.from(document.querySelectorAll('.n-flex')).filter(f => {
                const t = f.textContent; return (t.includes('开始阅读') || t.includes('继续阅读')) && (t.includes('收藏') || t.includes('编辑'));
            });
            if (flexes.length === 0) return;
            const actionFlex = flexes[flexes.length - 1];
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
            if (!location.href.includes('/wenku-edit')) return;
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
        new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
        inject();
    }

    // ============================================================
    // 模块 4：论坛收藏与管理
    // ============================================================
    const fUtils = {
        getPostId: (url) => { const m = url.match(/\/forum\/([a-f0-9]{24})/i); return m ? m[1] : null; },
        getCurrentUser: () => { const el = document.querySelector('.n-layout-header .n-button__content'); return el && el.textContent.includes('@') ? el.textContent.replace('@', '').trim() : null; },
        getTs: (post) => {
            if (post.updateTimestamp) return post.updateTimestamp;
            if (post.updateTime && typeof post.updateTime === 'string') {
                let p = new Date(post.updateTime.replace(/-/g, '/')).getTime();
                if (!isNaN(p)) return p;
            }
            return 0;
        },
        getRelTime: (ts) => {
            if (!ts) return '未知';
            const mins = Math.floor((Date.now() - ts) / 60000);
            const hrs = Math.floor(mins / 60), days = Math.floor(hrs / 24);
            if (mins < 1) return '刚刚'; if (hrs < 1) return `${mins} 分钟前`;
            if (days < 1) return `${hrs} 小时前`; if (days < 30) return `${days} 天前`;
            if (days < 365) return `${Math.floor(days / 30)} 个月前`; return `${Math.floor(days / 365)} 年前`;
        },
        fetchPost: async (id) => {
            try {
                const res = await fetch(`/api/article/${id}`);
                if (res.status === 404) return { deleted: true };
                const data = await res.json();
                let ts = data.updateAt ? parseInt(data.updateAt) : null;
                if (ts && ts < 10000000000) ts *= 1000;
                return { deleted: false, title: data.title, views: data.numViews !== undefined ? parseInt(data.numViews) : null, replies: data.numComments !== undefined ? parseInt(data.numComments) : null, updateTimestamp: ts, author: data.user?.username };
            } catch (e) { return null; }
        }
    };

    function initForumManager() {
        if (!megaState.settings.enableForumManager || !IS_NOVELIA) return;

        const SVG_FAV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21z" fill="currentColor"></path></svg>`;

        const injectStarToList = () => {
            document.querySelectorAll('table.n-table tbody tr').forEach(row => {
                const linkEl = row.querySelector('a.n-a');
                if (!linkEl) return;
                const id = fUtils.getPostId(linkEl.href);
                const flexContainer = row.querySelector('div.n-flex');
                if (flexContainer && (megaState.forumMyPosts[id] || megaState.forumFavPosts[id])) {
                    if (!flexContainer.querySelector('.m-star-icon')) {
                        const star = document.createElement('span');
                        star.className = 'n-text __text-dark-131ezvy-w m-star-icon';
                        star.innerHTML = SVG_FAV;
                        flexContainer.insertBefore(star, flexContainer.firstChild);
                    }
                } else if (flexContainer && !megaState.forumMyPosts[id] && !megaState.forumFavPosts[id]) {
                    const existingStar = flexContainer.querySelector('.m-star-icon');
                    if (existingStar) existingStar.remove();
                }
            });
        };

        const autoCaptureMyPosts = () => {
            const user = fUtils.getCurrentUser();
            if (!user) return;
            document.querySelectorAll('table.n-table tbody tr').forEach(row => {
                const authorSpan = row.querySelector('span.n-text');
                if (authorSpan && authorSpan.textContent.includes(`by ${user}`)) {
                    const linkEl = row.querySelector('a.n-a');
                    if (!linkEl) return;
                    const id = fUtils.getPostId(linkEl.href);
                    if (id) {
                        const nums = row.querySelector('.article-number')?.textContent || "0/0";
                        const [views, replies] = nums.split('/').map(n => parseInt(n) || 0);
                        if (!megaState.forumMyPosts[id]) {
                            megaState.forumMyPosts[id] = { id, title: linkEl.textContent.trim(), url: linkEl.href, views, replies, updateTimestamp: Date.now(), newViews: 0, newReplies: 0 };
                            saveForumData();
                        } else {
                            if(views > megaState.forumMyPosts[id].views || replies > megaState.forumMyPosts[id].replies) {
                               megaState.forumMyPosts[id].views = Math.max(views, megaState.forumMyPosts[id].views);
                               megaState.forumMyPosts[id].replies = Math.max(replies, megaState.forumMyPosts[id].replies);
                               saveForumData();
                            }
                        }
                    }
                }
            });
        };

        const injectDetailFavoriteBtn = () => {
            const postId = fUtils.getPostId(location.href);
            if (!postId || !location.href.includes('/forum/6')) return;

            const btns = Array.from(document.querySelectorAll('.n-button__content'));
            const blockBtn = btns.find(b => b.textContent.includes('屏蔽'));
            if (blockBtn && !document.getElementById('m-detail-fav-btn')) {
                const isFav = megaState.forumFavPosts[postId] !== undefined;
                const favBtn = document.createElement('button');
                favBtn.id = 'm-detail-fav-btn';
                favBtn.className = 'm-btn m-btn-default nm-blacklist-btn detail';
                favBtn.innerHTML = isFav ? '❌ 取消收藏' : '⭐ 收藏';
                favBtn.onclick = () => {
                    if (megaState.forumFavPosts[postId]) {
                        delete megaState.forumFavPosts[postId];
                        favBtn.innerHTML = '⭐ 收藏';
                    } else {
                        const titleEl = document.querySelector('h1.n-h1');
                        megaState.forumFavPosts[postId] = { id: postId, title: titleEl ? titleEl.textContent : '已收藏帖子', url: location.href, views: 0, replies: 0, updateTimestamp: Date.now(), newViews: 0, newReplies: 0 };
                        favBtn.innerHTML = '❌ 取消收藏';
                    }
                    saveForumData();
                    if(megaState.panelOpen && megaState.activeTab === 'tab-forum-fav') renderForumFav();
                };
                blockBtn.closest('button').insertAdjacentElement('afterend', favBtn);
            }
        };

        const router = () => {
            if (location.href.includes('/forum') && !location.href.includes('/forum/6')) {
                autoCaptureMyPosts(); injectStarToList();
            } else if (location.href.includes('/forum/6')) {
                injectDetailFavoriteBtn();
            }
        };
        new MutationObserver(() => setTimeout(router, 300)).observe(document.body, { childList: true, subtree: true });
        router();
    }

    // ============================================================
    // 综合 UI 与抓取容错核心
    // ============================================================

    function performExtraction() {
        const url = window.location.href;
        const isWenku = url.includes('/wenku') || url.includes('/favorite/wenku');
        let items = [];

        if (url.includes('/novel') || url.includes('/favorite/web') || url.includes('/read-history')) {
            document.querySelectorAll('.n-list-item').forEach(el => {
                try {
                    const mainDiv = el.querySelector('.n-list-item__main > div');
                    if (!mainDiv) return;

                    const allLinks = Array.from(mainDiv.querySelectorAll('a'));
                    const titleLink = allLinks.find(a => !a.href.includes('?query=')) || allLinks[0];
                    const tags = allLinks.filter(a => a.href.includes('?query=')).map(a => a.textContent.trim());

                    const cnNode = mainDiv.querySelector('span.n-text.__text-dark-131ezvy-d');
                    let status = "未知", chapters = "未知";

                    mainDiv.querySelectorAll('span').forEach(s => {
                        const text = s.textContent || '';
                        if (text.includes('连载中')) status = '连载中';
                        else if (text.includes('已完结')) status = '已完结';
                        else if (text.includes('短篇')) status = '短篇';

                        const chapMatch = text.match(/总计\s*(\d+)/);
                        if (chapMatch) chapters = chapMatch[1];
                    });

                    const jpTitle = titleLink ? (titleLink.textContent || '').trim() : '';
                    const cnTitle = cnNode ? (cnNode.textContent || '').trim() : jpTitle;
                    const link = titleLink ? titleLink.href : '';

                    items.push({ type: 'web', jp_title: jpTitle, cn_title: cnTitle, link: link, status: status, chapters: chapters, tags: tags });
                } catch (e) {
                    console.error('抓取网络小说失败，跳过该条目:', e);
                }
            });
        } else if (isWenku) {
            document.querySelectorAll('.n-grid > div').forEach(el => {
                try {
                    const linkEl = el.querySelector('a');
                    if (!linkEl) return;
                    const titleDiv = el.querySelector('.n-text.text-2line');
                    const cnTitle = titleDiv ? (titleDiv.textContent || '').replace(/[\n\r]+|[\s]{2,}/g, ' ').trim() : '未命名';
                    items.push({ type: 'wenku', cn_title: cnTitle, link: linkEl.href, jp_title: '', tags: [], status: '文库', chapters: 'N/A' });
                } catch (e) {
                    console.error('抓取文库小说失败，跳过该条目:', e);
                }
            });
        }
        return items;
    }

    function initExtractTab() {
        document.getElementById('btn-scan').onclick = () => {
            document.getElementById('list-extract').innerHTML = '<div style="padding:40px;text-align:center;">⏳ 正在重新扫描...</div>';
            setTimeout(() => {
                try {
                    megaState.extractData = performExtraction();
                    megaState.selectedExtract.clear();
                    renderExtractList();
                } catch (err) {
                    console.error('重新扫描发生严重错误:', err);
                    document.getElementById('list-extract').innerHTML = `<div style="padding:40px;text-align:center;color:#e88080;">扫描失败: ${err.message}</div>`;
                }
            }, 50);
        };
        document.getElementById('btn-sel-all').onclick = () => { megaState.extractData.forEach((_, i) => megaState.selectedExtract.add(i)); renderExtractList(); };
        document.getElementById('btn-sel-inv').onclick = () => { const newSet = new Set(); megaState.extractData.forEach((_, i) => { if (!megaState.selectedExtract.has(i)) newSet.add(i); }); megaState.selectedExtract = newSet; renderExtractList(); };
        document.getElementById('btn-add-list').onclick = () => {
            const target = document.getElementById('sel-target-list').value;
            if (!target) return alert('请先创建书单');
            const list = megaState.lists[target] || [];
            const fields = megaState.extractData.some(b => b.type === 'wenku') ? megaState.settings.fields_wenku : megaState.settings.fields_web;
            megaState.selectedExtract.forEach(idx => {
                const b = megaState.extractData[idx];
                let text = fields.filter(f => f.active).map(f => f.format
                    .replace(/{{jp_title}}/g, b.jp_title||b.cn_title||'')
                    .replace(/{{cn_title}}/g, b.cn_title||b.jp_title)
                    .replace(/{{link}}/g, b.link||'')
                    .replace(/{{status}}/g, b.status||'')
                    .replace(/{{chapters}}/g, b.chapters||'')
                    .replace(/{{tags}}/g, (b.tags && b.tags.length > 0) ? b.tags.join(', ') : '无')
                ).join('\n');
                list.push(text + '\n');
            });
            megaState.lists[target] = list; saveLists(); megaState.selectedExtract.clear(); renderExtractList(); showToast(`已添加至 ${target}`);
        };
    }

    function renderExtractList() {
        const c = document.getElementById('list-extract');
        c.innerHTML = megaState.extractData.length ? '' : '<div style="padding:40px;text-align:center;opacity:0.6;">当前页面未检测到有效书籍</div>';
        megaState.extractData.forEach((book, i) => {
            const div = document.createElement('div'); div.className = 'm-item';
            div.innerHTML = `<input type="checkbox" ${megaState.selectedExtract.has(i) ? 'checked' : ''}><div style="flex:1"><div style="font-weight:bold;">${book.cn_title}</div><div style="font-size:12px;opacity:0.7;">${book.status} · ${book.chapters}</div></div>`;
            div.onclick = (e) => { if (e.target.tagName !== 'INPUT') div.querySelector('input').checked = !div.querySelector('input').checked; div.querySelector('input').checked ? megaState.selectedExtract.add(i) : megaState.selectedExtract.delete(i); };
            c.appendChild(div);
        });
        const sel = document.getElementById('sel-target-list'); sel.innerHTML = '';
        Object.keys(megaState.lists || {}).forEach(k => sel.appendChild(new Option(k, k, false, k === megaState.currentListId)));
    }

    // --- 论坛面板渲染逻辑 ---
    function sortPosts(list, sortBy) {
        return list.sort((a, b) => {
            const tsA = fUtils.getTs(a), tsB = fUtils.getTs(b);
            if (sortBy === 'timeDesc') return tsB - tsA; if (sortBy === 'timeAsc') return tsA - tsB;
            if (sortBy === 'titleAsc') return a.title.localeCompare(b.title, 'zh');
            if (sortBy === 'titleDesc') return b.title.localeCompare(a.title, 'zh');
            return 0;
        });
    }

    function renderForumRowHTML(post, isFav) {
        let diffViews = post.newViews ? `<span class="m-diff-up">+${post.newViews}</span>` : '';
        let diffReplies = post.newReplies ? `<span class="m-diff-up">+${post.newReplies}</span>` : '';
        let ts = fUtils.getTs(post);
        let recentMark = (isFav && ts && (Date.now() - ts) < 86400000) ? `<span class="m-recent-update">24h内更新</span>` : '';
        let actionTd = isFav ? `<td class="m-col-action"><button class="m-btn m-btn-danger btn-remove-fav" data-id="${post.id}">移除</button></td>` : '';

        return `<tr>
            <td class="m-col-title"><div class="m-title-wrap"><a href="/forum/${post.id}" target="_blank">${post.title}</a> ${recentMark}</div></td>
            <td class="m-col-time" title="${fUtils.getRelTime(ts)}">${fUtils.getRelTime(ts)}</td>
            <td class="m-col-stats">${post.views || 0}${diffViews} / ${post.replies || 0}${diffReplies}</td>
            ${actionTd}
        </tr>`;
    }

    function renderForumMy() {
        let list = Object.values(megaState.forumMyPosts || {});
        if (megaState.forumSearchMy) {
            list = list.filter(p => (p.title || '').toLowerCase().includes(megaState.forumSearchMy.toLowerCase()));
        }
        const tbody = document.getElementById('list-forum-my-tbody');
        if (tbody) {
            tbody.innerHTML = sortPosts(list, megaState.forumSortMy).map(p => renderForumRowHTML(p, false)).join('');
        }
    }

    function renderForumFav() {
        let list = Object.values(megaState.forumFavPosts || {});
        if (megaState.forumSearchFav) {
            list = list.filter(p => (p.title || '').toLowerCase().includes(megaState.forumSearchFav.toLowerCase()));
        }
        const tbody = document.getElementById('list-forum-fav-tbody');
        if (tbody) {
            tbody.innerHTML = sortPosts(list, megaState.forumSortFav).map(p => renderForumRowHTML(p, true)).join('');
        }
    }

    async function syncForumData(type) {
        const isMy = type === 'my';
        const dict = isMy ? megaState.forumMyPosts : megaState.forumFavPosts;
        const statusEl = document.getElementById(isMy ? 'm-forum-my-status' : 'm-forum-fav-status');
        let ids = Object.keys(dict || {});
        if (!ids.length) return;

        if(statusEl) statusEl.textContent = "同步中...";
        for (let id of ids) {
            let post = dict[id];
            let apiData = await fUtils.fetchPost(id);
            if (apiData) {
                if (apiData.deleted) { delete dict[id]; continue; }
                if (apiData.title) post.title = apiData.title;
                if (apiData.views !== null) { post.newViews = Math.max(0, apiData.views - (post.views || 0)); post.views = apiData.views; }
                if (apiData.replies !== null) { post.newReplies = Math.max(0, apiData.replies - (post.replies || 0)); post.replies = apiData.replies; }
                if (apiData.updateTimestamp) post.updateTimestamp = apiData.updateTimestamp;
            }
            if(isMy) renderForumMy(); else renderForumFav();
            await new Promise(r => setTimeout(r, 1500));
        }
        saveForumData();
        if(statusEl) statusEl.textContent = `同步完成 (${ids.length}条)`;
    }

    // --- 初始化 UI 与事件 ---
    function initMegaUI() {
        if (!IS_NOVELIA) return;

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
            } else { togglePanel(); }
        };

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
                        <div class="m-tab-btn" data-tab="tab-blacklist">🚫 小说黑名单</div>
                        <div class="m-tab-btn" data-tab="tab-forum-my">🗣️ 我的发帖</div>
                        <div class="m-tab-btn" data-tab="tab-forum-fav">⭐ 论坛收藏</div>
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
                                <button class="m-btn m-btn-default" id="btn-rename-list">重命名</button>
                                <button class="m-btn m-btn-default m-btn-danger" id="btn-del-list">删除</button>
                                <div style="flex:1"></div>

                                <select id="sel-rating-val" class="m-input" style="width:60px; padding:0 4px;">
                                    <option value="5">5星</option>
                                    <option value="4">4星</option>
                                    <option value="3">3星</option>
                                    <option value="2">2星</option>
                                    <option value="1">1星</option>
                                </select>
                                <button class="m-btn m-btn-default" id="btn-insert-rating">★ 评分</button>

                                <button class="m-btn m-btn-default" id="btn-preview-list">👀 预览</button>
                                <button class="m-btn m-btn-default" id="btn-copy-list">复制内容</button>
                            </div>
                            <div style="flex:1; position:relative; display:flex; flex-direction:column; min-height:300px;">
                                <textarea class="m-editor" id="editor-list" style="width:100%; height:100%; position:absolute; inset:0;"></textarea>
                                <div id="preview-container" class="m-editor" style="display:none; width:100%; height:100%; position:absolute; inset:0; overflow-y:auto; background:rgba(128,128,128,0.05); color:inherit;"></div>
                            </div>
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

                        <div class="m-tab-pane" id="tab-forum-my">
                            <div class="m-toolbar">
                                <input type="text" id="m-search-forum-my" class="m-input" placeholder="搜索标题..." style="flex:1; max-width:250px;">
                                <select id="m-sort-forum-my" class="m-input">
                                    <option value="timeDesc">更新时间 (新到旧)</option><option value="timeAsc">更新时间 (旧到新)</option>
                                    <option value="titleAsc">标题名称 (A到Z)</option><option value="titleDesc">标题名称 (Z到A)</option>
                                </select>
                                <div style="flex:1"></div>
                                <button class="m-btn m-btn-default" id="m-btn-import-mine">导入我的帖子</button>
                                <span id="m-forum-my-status" style="font-size:12px; opacity:0.7; min-width:100px; text-align:right;"></span>
                            </div>
                            <div class="m-list-container">
                                <table class="m-table my-table">
                                    <thead><tr><th class="m-col-title">标题</th><th class="m-col-time">更新时间</th><th class="m-col-stats">查看/回复</th></tr></thead>
                                    <tbody id="list-forum-my-tbody"></tbody>
                                </table>
                            </div>
                        </div>

                        <div class="m-tab-pane" id="tab-forum-fav">
                            <div class="m-toolbar">
                                <input type="text" id="m-search-forum-fav" class="m-input" placeholder="搜索标题..." style="flex:1; max-width:250px;">
                                <select id="m-sort-forum-fav" class="m-input">
                                    <option value="timeDesc">更新时间 (新到旧)</option><option value="timeAsc">更新时间 (旧到新)</option>
                                    <option value="titleAsc">标题名称 (A到Z)</option><option value="titleDesc">标题名称 (Z到A)</option>
                                </select>
                                <div style="flex:1"></div>
                                <button class="m-btn m-btn-default" id="m-btn-import-fav">链接收藏帖子</button>
                                <span id="m-forum-fav-status" style="font-size:12px; opacity:0.7; min-width:100px; text-align:right;"></span>
                            </div>
                            <div class="m-list-container">
                                <table class="m-table fav-table">
                                    <thead><tr><th class="m-col-title">标题</th><th class="m-col-time">更新时间</th><th class="m-col-stats">查看/回复</th><th class="m-col-action">操作</th></tr></thead>
                                    <tbody id="list-forum-fav-tbody"></tbody>
                                </table>
                            </div>
                        </div>

                        <div class="m-tab-pane" id="tab-settings">
                            <h3 style="margin-top:0;">模块开关 (全局生效)</h3>
                            <div class="m-setting-row"><span>启用 LightNovel.jp 搜索按钮跳转</span><div class="m-switch" data-key="enableSearchBtn"></div></div>
                            <div class="m-setting-row"><span>启用 书单抓取与制作助手</span><div class="m-switch" data-key="enableBookList"></div></div>
                            <div class="m-setting-row"><span>启用 小说搜索列表黑名单隐藏机制</span><div class="m-switch" data-key="enableBlacklist"></div></div>
                            <div class="m-setting-row"><span>启用 文库编辑页简介自动排版</span><div class="m-switch" data-key="enableFormatter"></div></div>
                            <div class="m-setting-row"><span>启用 论坛发帖追踪与收藏管理</span><div class="m-switch" data-key="enableForumManager"></div></div>

                            <h3 style="margin-top:20px;">抓取字段排版设置</h3>
                            <div>
                                <h4 style="margin:0 0 8px 0; opacity:0.8;">网络小说抓取内容 (勾选与排序)</h4>
                                <div id="fields-web-container" style="margin-bottom:15px;"></div>
                            </div>
                            <div>
                                <h4 style="margin:0 0 8px 0; opacity:0.8;">文库小说抓取内容 (勾选与排序)</h4>
                                <div id="fields-wenku-container" style="margin-bottom:15px;"></div>
                            </div>

                            <h3 style="margin-top:20px;">数据备份与恢复</h3>
                            <div style="display:flex; gap:15px; margin-bottom: 12px;">
                                <button class="m-btn m-btn-default m-btn-primary" id="btn-export-all">⬇️ 导出全部数据</button>
                                <button class="m-btn m-btn-default" id="btn-import-all">⬆️ 从本地导入</button>
                                <input type="file" id="file-import-all" accept=".json" style="display:none">
                            </div>

                            <h3 style="margin-top:20px;">界面设置</h3>
                            <div class="m-setting-row" style="margin-bottom:40px;">
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
            if(p) p.className = t === 'dark' ? 'mega-dark' : 'mega-light';
        };

        const togglePanel = () => {
            megaState.panelOpen = !megaState.panelOpen;
            overlay.style.display = megaState.panelOpen ? 'flex' : 'none';
            if (megaState.panelOpen) {
                updateTheme(); renderTabs();
            }
        };

        document.querySelectorAll('.m-tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.m-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.m-tab-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                megaState.activeTab = btn.dataset.tab;
                const activePane = document.getElementById(megaState.activeTab);
                if(activePane) activePane.classList.add('active');
                renderTabs();
            };
        });

        setInterval(() => { if (megaState.panelOpen && megaState.settings.theme === 'auto') updateTheme(); }, 2000);

        initExtractTab(); initListTab(); initBlacklistTab(); initSettingsTab();
        initForumUIEvents();
    }

    // ============================================================
    // 书单抓取与管理逻辑
    // ============================================================
    function initListTab() {
        const sel = document.getElementById('sel-manage-list'), ed = document.getElementById('editor-list');
        if(sel) sel.onchange = () => { megaState.currentListId = sel.value; ed.value = (megaState.lists[sel.value] || []).join('\n'); };
        if(ed) ed.oninput = () => { megaState.lists[megaState.currentListId] = [ed.value]; saveLists(); };

        document.getElementById('btn-new-list').onclick = () => { const n = prompt("新书单名称："); if (n && !megaState.lists[n]) { megaState.lists[n] = []; megaState.currentListId = n; saveLists(); renderListTabUI(); renderExtractList(); } };
        document.getElementById('btn-del-list').onclick = () => { if (confirm(`删除 "${megaState.currentListId}"？`)) { delete megaState.lists[megaState.currentListId]; megaState.currentListId = Object.keys(megaState.lists)[0] || ''; saveLists(); renderListTabUI(); renderExtractList(); } };
        document.getElementById('btn-copy-list').onclick = () => { GM_setClipboard(ed.value); showToast('已复制'); };

        document.getElementById('btn-rename-list').onclick = () => {
            const oldName = megaState.currentListId;
            const newName = prompt("重命名书单为：", oldName);
            if (newName && newName !== oldName) {
                if (megaState.lists[newName]) {
                    alert("书单名已存在！");
                } else {
                    megaState.lists[newName] = megaState.lists[oldName];
                    delete megaState.lists[oldName];
                    megaState.currentListId = newName;
                    saveLists();
                    renderListTabUI();
                    renderExtractList();
                    showToast('重命名成功');
                }
            }
        };

        // 🌟 修复：直接从下拉框读取星级，免除弹窗，插入标准的 ::: star 格式
        document.getElementById('btn-insert-rating').onclick = () => {
            const val = document.getElementById('sel-rating-val').value;
            if(ed) {
                const start = ed.selectionStart;
                const end = ed.selectionEnd;
                const text = ed.value;
                const before = text.substring(0, start);
                const after  = text.substring(end, text.length);
                const insertText = `\n::: star ${val}\n`;
                ed.value = before + insertText + after;
                megaState.lists[megaState.currentListId] = [ed.value];
                saveLists();
                ed.focus();
                ed.selectionStart = ed.selectionEnd = start + insertText.length;
            }
        };

        // 🌟 预览引擎增强：支持解析 ::: star 语法为绿色星星
        document.getElementById('btn-preview-list').onclick = () => {
            const previewDiv = document.getElementById('preview-container');
            const btn = document.getElementById('btn-preview-list');
            if(!previewDiv || !ed) return;

            if (previewDiv.style.display === 'none') {
                let html = ed.value
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/### \[(.*?)\]\((.*?)\)/g, '<h3 style="margin: 14px 0 6px 0;"><a href="$2" target="_blank" style="color:var(--mega-primary); text-decoration:none;">$1</a></h3>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/---/g, '<hr style="border:none; border-top:1px dashed rgba(128,128,128,0.3); margin:12px 0;">')
                    // 解析评分星星
                    .replace(/:::\s*star\s+([0-5](?:\.\d+)?)/g, (match, p1) => {
                        const score = parseFloat(p1);
                        let starsHtml = '';
                        for(let i=1; i<=5; i++) {
                            const color = i <= score ? '#4fb233' : 'rgb(219, 219, 223)';
                            starsHtml += `<div style="display:inline-flex; align-items:center; justify-content:center; margin-right:4px;">
                                <svg viewBox="0 0 512 512" style="width:20px; height:20px; fill:${color};"><path d="M394 480a16 16 0 01-9.39-3L256 383.76 127.39 477a16 16 0 01-24.55-18.08L153 310.35 23 221.2a16 16 0 019-29.2h160.38l48.4-148.95a16 16 0 0130.44 0l48.4 149H480a16 16 0 019.05 29.2L359 310.35l50.13 148.53A16 16 0 01394 480z"></path></svg>
                            </div>`;
                        }
                        return `<div style="display:inline-flex; align-items:center; margin: 8px 0;">${starsHtml}</div>`;
                    })
                    .replace(/\n/g, '<br>');

                previewDiv.innerHTML = html;
                previewDiv.style.display = 'block';
                ed.style.display = 'none';
                btn.innerText = '✏️ 退出预览';
            } else {
                previewDiv.style.display = 'none';
                ed.style.display = 'block';
                btn.innerText = '👀 预览';
            }
        };
    }

    function renderListTabUI() {
        const sel = document.getElementById('sel-manage-list');
        const ed = document.getElementById('editor-list');
        if(sel) {
            sel.innerHTML = '';
            Object.keys(megaState.lists || {}).forEach(k => sel.appendChild(new Option(k, k, false, k === megaState.currentListId)));
        }
        if(ed) ed.value = (megaState.lists[megaState.currentListId] || []).join('\n');
    }

    // ============================================================
    // 设置与排版管理
    // ============================================================
    function renderFieldSettings(containerId, fieldsKey) {
        const container = document.getElementById(containerId);
        if(!container) return;
        container.innerHTML = '';
        const arr = megaState.settings[fieldsKey] || [];

        arr.forEach((field, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(128,128,128,0.05); margin-bottom:4px; border-radius:4px; border: 1px solid rgba(128,128,128,0.1); transition: 0.2s;';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" ${field.active ? 'checked' : ''} style="transform:scale(1.1); cursor:pointer; accent-color:var(--mega-primary);">
                    <span style="font-size:13px;">${field.name}</span>
                </div>
                <div style="display:flex; gap:4px;">
                    <button class="m-btn m-btn-default" style="padding:0 8px; height:24px; font-size:12px;" ${i===0?'disabled':''}>↑</button>
                    <button class="m-btn m-btn-default" style="padding:0 8px; height:24px; font-size:12px;" ${i===arr.length-1?'disabled':''}>↓</button>
                </div>
            `;

            div.querySelector('input').onchange = (e) => { field.active = e.target.checked; saveSettings(); };

            const btns = div.querySelectorAll('button');
            btns[0].onclick = () => { if(i > 0) { [arr[i], arr[i-1]] = [arr[i-1], arr[i]]; saveSettings(); renderFieldSettings(containerId, fieldsKey); } };
            btns[1].onclick = () => { if(i < arr.length-1) { [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; saveSettings(); renderFieldSettings(containerId, fieldsKey); } };
            container.appendChild(div);
        });
    }

    function initSettingsTab() {
        document.querySelectorAll('.m-switch').forEach(sw => {
            const key = sw.dataset.key;
            if (megaState.settings[key]) sw.classList.add('active');
            sw.onclick = () => {
                megaState.settings[key] = !megaState.settings[key];
                sw.classList.toggle('active', megaState.settings[key]);
                saveSettings(); showToast('设置已保存，刷新页面后生效');
            };
        });

        const selTheme = document.getElementById('sel-theme');
        if(selTheme) {
            selTheme.value = megaState.settings.theme;
            selTheme.onchange = () => {
                megaState.settings.theme = selTheme.value; saveSettings();
                const p = document.getElementById('mega-panel');
                if(p) p.className = selTheme.value === 'dark' ? 'mega-dark' : 'mega-light';
            };
        }

        renderFieldSettings('fields-web-container', 'fields_web');
        renderFieldSettings('fields-wenku-container', 'fields_wenku');

        document.getElementById('btn-export-all').onclick = () => {
            const dataToExport = { settings: megaState.settings, lists: megaState.lists, blacklist: megaState.blacklist, forumMyPosts: megaState.forumMyPosts, forumFavPosts: megaState.forumFavPosts };
            const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `novelia_megapack_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); showToast('数据导出成功！');
        };

        document.getElementById('btn-import-all').onclick = () => { document.getElementById('file-import-all').click(); };

        const importInput = document.getElementById('file-import-all');
        if(importInput) {
            importInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        if (data.settings) megaState.settings = data.settings;
                        if (data.lists) megaState.lists = data.lists;
                        if (data.blacklist) megaState.blacklist = data.blacklist;
                        if (data.forumMyPosts) megaState.forumMyPosts = data.forumMyPosts;
                        if (data.forumFavPosts) megaState.forumFavPosts = data.forumFavPosts;
                        saveSettings(); saveLists(); saveBlacklist(megaState.blacklist); saveForumData();
                        showToast('数据导入成功！页面即将刷新...');
                        setTimeout(() => location.reload(), 1500);
                    } catch (err) { alert('导入失败：文件格式不正确！'); }
                };
                reader.readAsText(file);
                e.target.value = '';
            };
        }
    }

    function renderTabs() {
        if (megaState.activeTab === 'tab-extract') {
            if (megaState.settings.enableBookList && !megaState.extractData.length) { megaState.extractData = performExtraction(); }
            renderExtractList();
        }
        else if (megaState.activeTab === 'tab-list') renderListTabUI();
        else if (megaState.activeTab === 'tab-blacklist') renderBlacklistTab();
        else if (megaState.activeTab === 'tab-forum-my') { renderForumMy(); syncForumData('my'); }
        else if (megaState.activeTab === 'tab-forum-fav') { renderForumFav(); syncForumData('fav'); }
    }

    // ============================================================
    // 论坛事件绑定防崩溃与重构
    // ============================================================
    function initForumUIEvents() {
        const searchMy = document.getElementById('m-search-forum-my');
        if (searchMy) searchMy.addEventListener('input', (e) => { megaState.forumSearchMy = e.target.value; renderForumMy(); });

        const sortMy = document.getElementById('m-sort-forum-my');
        if (sortMy) sortMy.addEventListener('change', (e) => { megaState.forumSortMy = e.target.value; renderForumMy(); });

        const searchFav = document.getElementById('m-search-forum-fav');
        if (searchFav) searchFav.addEventListener('input', (e) => { megaState.forumSearchFav = e.target.value; renderForumFav(); });

        const sortFav = document.getElementById('m-sort-forum-fav');
        if (sortFav) sortFav.addEventListener('change', (e) => { megaState.forumSortFav = e.target.value; renderForumFav(); });

        const btnImportMine = document.getElementById('m-btn-import-mine');
        if (btnImportMine) {
            btnImportMine.addEventListener('click', async () => {
                const url = prompt("请输入你的帖子链接:");
                if (!url) return;
                const id = url.match(/\/forum\/([a-f0-9]{24})/i)?.[1];
                if (!id) return alert("无效链接！");

                const apiData = await fetch(`/api/article/${id}`).then(r => r.json()).catch(() => null);
                const user = document.querySelector('.n-layout-header .n-button__content')?.textContent.replace('@', '').trim();

                if (apiData && apiData.user?.username === user) {
                    megaState.forumMyPosts[id] = { id, url, title: apiData.title || "未知标题", views: parseInt(apiData.numViews)||0, replies: parseInt(apiData.numComments)||0, updateTimestamp: apiData.updateAt?(parseInt(apiData.updateAt)* (apiData.updateAt<10000000000?1000:1)):Date.now(), newViews:0, newReplies:0 };
                    saveForumData(); showToast("添加至发帖记录！"); syncForumData('my');
                } else {
                    alert("验证失败：该帖子作者不是你当前登录账号，已自动转移至收藏列表。");
                    megaState.forumFavPosts[id] = { id, url, title: apiData?.title || "未知标题", views: parseInt(apiData?.numViews)||0, replies: parseInt(apiData?.numComments)||0, updateTimestamp: apiData?.updateAt?(parseInt(apiData.updateAt)* (apiData.updateAt<10000000000?1000:1)):Date.now(), newViews:0, newReplies:0 };
                    saveForumData(); syncForumData('fav');
                }
            });
        }

        const btnImportFav = document.getElementById('m-btn-import-fav');
        if (btnImportFav) {
            btnImportFav.addEventListener('click', async () => {
                const url = prompt("请输入你想收藏的帖子链接:");
                if (!url) return;
                const id = url.match(/\/forum\/([a-f0-9]{24})/i)?.[1];
                if (!id) return alert("无效链接！");
                if(!megaState.forumFavPosts[id]) {
                    const apiData = await fetch(`/api/article/${id}`).then(r => r.json()).catch(() => null);
                    megaState.forumFavPosts[id] = { id, url, title: apiData?.title || "未知标题", views: parseInt(apiData?.numViews)||0, replies: parseInt(apiData?.numComments)||0, updateTimestamp: apiData?.updateAt?(parseInt(apiData.updateAt)* (apiData.updateAt<10000000000?1000:1)):Date.now(), newViews:0, newReplies:0 };
                    saveForumData(); showToast("已加入收藏！"); syncForumData('fav');
                } else { alert("该帖子已在收藏中。"); }
            });
        }

        const favTbody = document.getElementById('list-forum-fav-tbody');
        if (favTbody) {
            favTbody.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-remove-fav')) {
                    const id = e.target.getAttribute('data-id');
                    if (id) {
                        delete megaState.forumFavPosts[id];
                        saveForumData();
                        renderForumFav();
                        showToast('已移除收藏');
                    }
                }
            });
        }
    }

    function initBlacklistTab() {
        document.getElementById('bl-sel-all').onclick = () => { megaState.selectedBlacklist = megaState.selectedBlacklist.size === megaState.blacklist.length ? new Set() : new Set(megaState.blacklist.map(x => x.url)); renderBlacklistTab(); };
        document.getElementById('bl-sel-inv').onclick = () => { const newSet = new Set(); megaState.blacklist.forEach(x => { if (!megaState.selectedBlacklist.has(x.url)) newSet.add(x.url); }); megaState.selectedBlacklist = newSet; renderBlacklistTab(); };
        document.getElementById('bl-del').onclick = () => {
            if (!megaState.selectedBlacklist.size) return;
            saveBlacklist(megaState.blacklist.filter(x => !megaState.selectedBlacklist.has(x.url)));
            megaState.selectedBlacklist.clear(); renderBlacklistTab(); showToast('已删除选中黑名单');
            document.querySelectorAll('.n-list-item__main').forEach(i => delete i.dataset.megaBlProcessed);
        };
    }

    function renderBlacklistTab() {
        document.getElementById('bl-count').textContent = `共 ${megaState.blacklist.length} 条记录`;
        const c = document.getElementById('list-blacklist');
        if(!c) return;
        c.innerHTML = megaState.blacklist.length ? '' : '<div style="padding:40px;text-align:center;opacity:0.6;">黑名单为空</div>';
        megaState.blacklist.forEach(item => {
            const row = document.createElement('div'); row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 10px; border-radius:4px; transition:0.2s;'; row.className = 'm-item';
            row.innerHTML = `<input type="checkbox" ${megaState.selectedBlacklist.has(item.url) ? 'checked' : ''}><div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || '无标题'}</div><div style="font-size:11px; opacity:0.5; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${item.url}</div>`;
            row.onclick = (e) => { if (e.target.tagName !== 'INPUT') row.querySelector('input').checked = !row.querySelector('input').checked; row.querySelector('input').checked ? megaState.selectedBlacklist.add(item.url) : megaState.selectedBlacklist.delete(item.url); };
            c.appendChild(row);
        });
    }

    // ============================================================
    // 初始化路由引擎与自愈机制
    // ============================================================
    let isObserversAttached = false;

    function initMegaPack() {
        if (!isObserversAttached) {
            initLightNovelSearch();
            initBlacklistDOM();
            initFormatter();
            initForumManager();
            isObserversAttached = true;
        }

        if (IS_NOVELIA && !document.getElementById('mega-trigger')) {
            const oldOverlay = document.getElementById('mega-overlay');
            if (oldOverlay) oldOverlay.remove();
            initMegaUI();
        }
    }

    const pushState = history.pushState;
    history.pushState = function() {
        pushState.apply(history, arguments);
        megaState.extractData = [];
        setTimeout(initMegaPack, 500);
    };
    window.addEventListener('popstate', () => {
        megaState.extractData = [];
        setTimeout(initMegaPack, 500);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMegaPack);
    } else {
        initMegaPack();
    }

})();
