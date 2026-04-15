// ==UserScript==
// @name         Novelia 论坛收藏与管理
// @namespace    http://tampermonkey.net/
// @version      1.6.2
// @description  为 Novelia 论坛添加发帖记录追踪、帖子收藏、数据导出及界面标识等功能。极限优化表格列宽，为超长标题腾出更多空间。
// @author       Gemini
// @match        *://n.novelia.cc/*
// @icon         https://n.novelia.cc/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// @updateURL     https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/%E5%8D%95%E7%8B%AC%E8%84%9A%E6%9C%AC/Novelia%20%E8%AE%BA%E5%9D%9B%E6%94%B6%E8%97%8F%E4%B8%8E%E7%AE%A1%E7%90%86.js
// @downloadURL   https://raw.githubusercontent.com/LplChen/ai-novelia-js/refs/heads/main/%E5%8D%95%E7%8B%AC%E8%84%9A%E6%9C%AC/Novelia%20%E8%AE%BA%E5%9D%9B%E6%94%B6%E8%97%8F%E4%B8%8E%E7%AE%A1%E7%90%86.js
// ==/UserScript==

(function() {
    'use strict';

    let myPosts = GM_getValue('nv_my_posts', {});
    let favPosts = GM_getValue('nv_fav_posts', {});
    let settings = GM_getValue('nv_settings', { theme: 'auto' });

    const state = {
        mySearch: '', mySort: 'timeDesc',
        favSearch: '', favSort: 'timeDesc'
    };

    const SVG_FAV = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21z" fill="currentColor"></path></svg>`;
    const DELAY_MS = 1500;

    const utils = {
        saveData() {
            GM_setValue('nv_my_posts', myPosts);
            GM_setValue('nv_fav_posts', favPosts);
            GM_setValue('nv_settings', 设置);
        },
        getCurrentUser() {
            const el = document.querySelector('.n-layout-header .n-button__content');
            return el && el.textContent.includes('@') ? el.textContent.replace('@', '').trim() : null;
        },
        getPostIdFromUrl(url) {
            const match = url.match(/\/forum\/([a-f0-9]{24})/i);
            return match ? match[1] : null;
        },
        getTs(post) {
            if (post.updateTimestamp) return post.updateTimestamp;
            if (post.updateTime && typeof post.updateTime === 'string') {
                let parsed = new Date(post.updateTime.replace(/-/g, '/')).getTime();
                if (!isNaN(parsed)) return parsed;
            }
            return 0;
        },
        getRelativeTime(ts) {
            if (!ts) return '未知';
            const diff = Date.now() - ts;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (minutes < 1) return '刚刚';
            if (hours < 1) return `${minutes} 分钟前`;
            if (days < 1) return `${hours} 小时前`;
            if (days < 30) return `${days} 天前`;
            if (days < 365) return `${Math.floor(days / 30)} 个月前`;
            return `${Math.floor(days / 365)} 年前`;
        },
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        async fetchPostData(postId) {
            try {
                const res = await fetch(`/api/article/${postId}`);
                if (res.status === 404) return { deleted: true };
                
                const data = await res.json();
                let views = data.numViews;
                let replies = data.numComments;
                let updateTime = data.updateAt; 
                let author = data.user?.username;

                let updateTimestamp = null;
                if (updateTime) {
                    let ts = parseInt(updateTime);
                    if (ts < 10000000000) ts *= 1000;
                    updateTimestamp = ts;
                }

                return {
                    deleted: false,
                    views: views !== undefined ? parseInt(views) : null,
                    replies: replies !== undefined ? parseInt(replies) : null,
                    updateTimestamp: updateTimestamp,
                    author: author
                };
            } catch (e) {
                return null;
            }
        },
        debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => { func.apply(this, args); }, wait);
            };
        }
    };

    // UI 与 CSS 注入
    GM_addStyle(`
        :root { 
            color-scheme: light;
            --nv-bg-panel: #ffffff; 
            --nv-text-main: #333333; 
            --nv-border: #e0e0e0; 
            --nv-hover: #f5f5f5; 
            --nv-scrollbar-bg: #f5f5f5; 
            --nv-primary-color: #18a058; 
            --nv-btn-border: rgb(224, 224, 230);
        }
        [data-theme="dark"] { 
            color-scheme: dark; 
            --nv-bg-panel: #18181c; 
            --nv-text-main: rgba(255,255,255,0.82); 
            --nv-border: rgba(255,255,255,0.09); 
            --nv-hover: rgba(255,255,255,0.05); 
            --nv-scrollbar-bg: #101014; 
            --nv-primary-color: #63e2b7; 
            --nv-btn-border: rgba(255, 255, 255, 0.24);
        }
        
        #nv-enhancer-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 1000px; max-width: 95vw; height: 70vh; min-height: 500px; background: var(--nv-bg-panel); color: var(--nv-text-main); border: 1px solid var(--nv-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 9999; display: flex; flex-direction: column; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
        #nv-enhancer-panel.active { opacity: 1; pointer-events: auto; }
        .nv-panel-header { display: flex; border-bottom: 1px solid var(--nv-border); padding: 10px 20px; flex-shrink: 0; }
        .nv-tab-btn { background: none; border: none; color: var(--nv-text-main); padding: 8px 16px; cursor: pointer; font-size: 16px; opacity: 0.6; }
        .nv-tab-btn.active { opacity: 1; border-bottom: 2px solid var(--nv-primary-color); font-weight: bold; }
        .nv-close-btn { margin-left: auto; background: none; border: none; color: var(--nv-text-main); font-size: 24px; cursor: pointer; line-height: 1; outline: none; }
        .nv-panel-content { flex: 1; overflow-y: auto; padding: 20px; }
        
        .nv-panel-content::-webkit-scrollbar { width: 8px; }
        .nv-panel-content::-webkit-scrollbar-track { background: var(--nv-scrollbar-bg); border-radius: 4px; }
        .nv-panel-content::-webkit-scrollbar-thumb { background: rgba(136, 136, 136, 0.4); border-radius: 4px; }
        .nv-panel-content::-webkit-scrollbar-thumb:hover { background: rgba(136, 136, 136, 0.7); }

        .nv-tab-content { display: none; }
        .nv-tab-content.active { display: block; }
        
        .nv-action-bar { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px; align-items: center; justify-content: space-between; }
        .nv-filter-group { display: flex; gap: 10px; flex: 1; }
        .nv-input { background: var(--nv-hover); color: var(--nv-text-main); border: 1px solid var(--nv-border); padding: 6px 10px; border-radius: 4px; outline: none; transition: border-color 0.2s; }
        .nv-input:focus { border-color: var(--nv-primary-color); }
        .nv-input option { background-color: var(--nv-bg-panel); color: var(--nv-text-main); } 
        #nv-search-my, #nv-search-fav { flex: 1; max-width: 250px; }
        
        .nv-theme-btn {
            background-color: transparent;
            color: var(--nv-text-main);
            border: 1px solid var(--nv-btn-border);
            border-radius: 3px;
            cursor: pointer;
            transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            white-space: nowrap;
            line-height: 1; 
            outline: none;
        }
        .nv-theme-btn:hover {
            color: var(--nv-primary-color);
            border-color: var(--nv-primary-color);
        }
        
        .nv-btn-pagination { height: 28px; padding: 0 12px; font-size: 13px; margin-left: 20px; }
        .nv-btn-detail { height: 22px; padding: 0 8px; font-size: 12px; margin-left: 10px; vertical-align: top; }

        .nv-btn { background: var(--nv-hover); color: var(--nv-text-main); border: 1px solid var(--nv-border); padding: 6px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap; line-height: 1; outline: none; }
        .nv-btn:hover { background: rgba(99, 226, 183, 0.1); border-color: var(--nv-primary-color); color: var(--nv-primary-color); }
        .nv-btn-danger { background: rgba(232, 128, 128, 0.1); color: #e88080; border-color: rgba(232, 128, 128, 0.3); }
        .nv-btn-danger:hover { background: rgba(232, 128, 128, 0.2); border-color: #e88080; color: #e88080; }
        
        .nv-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .nv-table th, .nv-table td { border-bottom: 1px solid var(--nv-border); padding: 12px 10px; text-align: left; vertical-align: middle; }
        .nv-table a { color: var(--nv-primary-color); text-decoration: none; transition: opacity 0.2s; }
        .nv-table a:hover { opacity: 0.8; text-decoration: underline; }
        
        .nv-col-time, .nv-col-stats, .nv-col-action { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        /* 列宽再次优化：进一步压缩数据列，将空间倾斜给标题 */
        .nv-fav-table .nv-col-title { width: 57%; } /* 增加 4% */
        .nv-fav-table .nv-col-time { width: 15%; }
        .nv-fav-table .nv-col-stats { width: 16%; } /* 减少 4% (~40px) */
        .nv-fav-table .nv-col-action { width: 12%; text-align: center; }
        
        .nv-my-table .nv-col-title { width: 69%; } /* 增加 4% */
        .nv-my-table .nv-col-time { width: 15%; }
        .nv-my-table .nv-col-stats { width: 16%; } /* 减少 4% (~40px) */

        .nv-title-wrap { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.5; font-weight: 500; }
        
        .nv-diff-up { color: #e88080; font-size: 12px; margin-left: 4px; font-weight: bold; }
        .nv-recent-update { color: #f2c97d; font-size: 11px; border: 1px solid #f2c97d; padding: 1px 4px; border-radius: 4px; margin-left: 8px; vertical-align: top; white-space: nowrap; }
        .nv-star-icon { display: inline-flex; align-items: center; color: #f2c97d; margin-right: 6px; }
        .nv-star-icon svg { width: 14px; height: 14px; }
    `);

    const panelHTML = `
        <div id="nv-enhancer-panel">
            <div class="nv-panel-header">
                <button class="nv-tab-btn active" data-target="nv-tab-myposts">发帖记录</button>
                <button class="nv-tab-btn" data-target="nv-tab-favs">收藏列表</button>
                <button class="nv-tab-btn" data-target="nv-tab-settings">设置</button>
                <button class="nv-close-btn">×</button>
            </div>
            <div class="nv-panel-content">
                
                <div id="nv-tab-myposts" class="nv-tab-content active">
                    <div class="nv-action-bar">
                        <div class="nv-filter-group">
                            <input type="text" id="nv-search-my" class="nv-input" placeholder="搜索标题...">
                            <select id="nv-sort-my" class="nv-input">
                                <option value="timeDesc">更新时间 (新到旧)</option>
                                <option value="timeAsc">更新时间 (旧到新)</option>
                                <option value="titleAsc">标题名称 (A到Z)</option>
                                <option value="titleDesc">标题名称 (Z到A)</option>
                            </select>
                        </div>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <button class="nv-theme-btn" style="height:32px; padding: 0 12px;" id="nv-btn-import-mine">导入我的帖子</button>
                            <span id="nv-myposts-status" style="font-size: 12px; opacity: 0.7; min-width: 120px; text-align: right;"></span>
                        </div>
                    </div>
                    <table class="nv-table nv-my-table">
                        <thead><tr><th class="nv-col-title">标题</th><th class="nv-col-time">更新时间</th><th class="nv-col-stats">查看/回复</th></tr></thead>
                        <tbody id="nv-myposts-tbody"></tbody>
                    </table>
                </div>
                
                <div id="nv-tab-favs" class="nv-tab-content">
                    <div class="nv-action-bar">
                        <div class="nv-filter-group">
                            <input type="text" id="nv-search-fav" class="nv-input" placeholder="搜索标题...">
                            <select id="nv-sort-fav" class="nv-input">
                                <option value="timeDesc">更新时间 (新到旧)</option>
                                <option value="timeAsc">更新时间 (旧到新)</option>
                                <option value="titleAsc">标题名称 (A到Z)</option>
                                <option value="titleDesc">标题名称 (Z到A)</option>
                            </select>
                        </div>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <button class="nv-theme-btn" style="height:32px; padding: 0 12px;" id="nv-btn-import-fav">链接收藏帖子</button>
                            <span id="nv-favs-status" style="font-size: 12px; opacity: 0.7; min-width: 120px; text-align: right;"></span>
                        </div>
                    </div>
                    <table class="nv-table nv-fav-table">
                        <thead><tr><th class="nv-col-title">标题</th><th class="nv-col-time">更新时间</th><th class="nv-col-stats">查看/回复</th><th class="nv-col-action">操作</th></tr></thead>
                        <tbody id="nv-favs-tbody"></tbody>
                    </table>
                </div>
                
                <div id="nv-tab-settings" class="nv-tab-content">
                    <h3>主题设置</h3>
                    <select id="nv-theme-select" class="nv-input" style="margin-bottom: 30px; width: 200px;">
                        <option value="auto">跟随网站</option>
                        <option value="light">亮色主题</option>
                        <option value="dark">暗色主题</option>
                    </select>
                    <h3>数据管理</h3>
                    <div style="display:flex; gap:15px; margin-top: 10px;">
                        <button class="nv-theme-btn" style="height:32px; padding: 0 12px;" id="nv-btn-export">导出全部数据</button>
                        <button class="nv-theme-btn" style="height:32px; padding: 0 12px;" id="nv-btn-import-data">导入本地数据</button>
                    </div>
                </div>

            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHTML);

    const UI = {
        panel: document.getElementById('nv-enhancer-panel'),
        updateTheme() {
            let t = settings.theme;
            if (t === 'auto') {
                t = document.body.style.backgroundColor.includes('16, 16, 20') ? 'dark' : 'light';
            }
            document.documentElement.setAttribute('data-theme', t);
        },
        openPanel() {
            this.updateTheme();
            UI.panel.classList.add('active');
            this.syncAndRenderMyPosts();
            this.syncAndRenderFavPosts();
        },
        closePanel() { UI.panel.classList.remove('active'); },
        switchTab(targetId) {
            document.querySelectorAll('.nv-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.nv-tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector(`[data-target="${targetId}"]`).classList.add('active');
            document.getElementById(targetId).classList.add('active');
        },
        
        sortPostsList(postsList, sortBy) {
            return postsList.sort((a, b) => {
                const tsA = utils.getTs(a);
                const tsB = utils.getTs(b);
                if (sortBy === 'timeDesc') return tsB - tsA;
                if (sortBy === 'timeAsc') return tsA - tsB;
                if (sortBy === 'titleAsc') return a.title.localeCompare(b.title, 'zh');
                if (sortBy === 'titleDesc') return b.title.localeCompare(a.title, 'zh');
                return 0;
            });
        },
        renderRowHTML(post, isFav) {
            let diffViews = post.newViews ? `<span class="nv-diff-up">+${post.newViews}</span>` : '';
            let diffReplies = post.newReplies ? `<span class="nv-diff-up">+${post.newReplies}</span>` : '';
            
            let recentMark = '';
            let ts = utils.getTs(post);
            if (isFav && ts && (Date.now() - ts) < 86400000) {
                recentMark = `<span class="nv-recent-update">24h内更新</span>`;
            }
            
            let timeText = utils.getRelativeTime(ts);
            let actionTd = isFav ? `<td class="nv-col-action"><button class="nv-btn nv-btn-danger nv-del-btn" data-id="${post.id}" data-type="fav">移除</button></td>` : '';

            return `
                <tr>
                    <td class="nv-col-title">
                        <div class="nv-title-wrap">
                            <a href="/forum/${post.id}" target="_blank">${post.title}</a> ${recentMark}
                        </div>
                    </td>
                    <td class="nv-col-time" title="${timeText}">${timeText}</td>
                    <td class="nv-col-stats">${post.views || 0}${diffViews} &nbsp;/&nbsp; ${post.replies || 0}${diffReplies}</td>
                    ${actionTd}
                </tr>
            `;
        },
        
        renderMyTable() {
            const tbody = document.getElementById('nv-myposts-tbody');
            let list = Object.values(myPosts);
            if (state.mySearch) list = list.filter(p => p.title.toLowerCase().includes(state.mySearch.toLowerCase()));
            list = this.sortPostsList(list, state.mySort);
            tbody.innerHTML = list.map(p => this.renderRowHTML(p, false)).join('');
        },
        renderFavTable() {
            const tbody = document.getElementById('nv-favs-tbody');
            let list = Object.values(favPosts);
            if (state.favSearch) list = list.filter(p => p.title.toLowerCase().includes(state.favSearch.toLowerCase()));
            list = this.sortPostsList(list, state.favSort);
            tbody.innerHTML = list.map(p => this.renderRowHTML(p, true)).join('');
        },
        
        async syncAndRenderMyPosts() {
            const status = document.getElementById('nv-myposts-status');
            let ids = Object.keys(myPosts);
            this.renderMyTable(); 
            if(ids.length === 0) return;

            status.textContent = "同步中...";
            for (let id of ids) {
                let post = myPosts[id];
                let apiData = await utils.fetchPostData(id);
                if (apiData) {
                    if (apiData.deleted) { delete myPosts[id]; continue; }
                    if (apiData.views !== null && !isNaN(apiData.views)) {
                        post.newViews = Math.max(0, apiData.views - (post.views || 0));
                        post.views = apiData.views;
                    }
                    if (apiData.replies !== null && !isNaN(apiData.replies)) {
                        post.newReplies = Math.max(0, apiData.replies - (post.replies || 0));
                        post.replies = apiData.replies;
                    }
                    if (apiData.updateTimestamp !== null) post.updateTimestamp = apiData.updateTimestamp;
                }
                this.renderMyTable(); 
                await utils.sleep(DELAY_MS);
            }
            utils.saveData();
            status.textContent = `同步完成 (${ids.length}条)`;
        },
        async syncAndRenderFavPosts() {
            const status = document.getElementById('nv-favs-status');
            let ids = Object.keys(favPosts);
            this.renderFavTable(); 
            if(ids.length === 0) return;

            status.textContent = "同步中...";
            for (let id of ids) {
                let post = favPosts[id];
                let apiData = await utils.fetchPostData(id);
                if (apiData) {
                    if (apiData.deleted) { delete favPosts[id]; continue; }
                    if (apiData.views !== null && !isNaN(apiData.views)) {
                        post.views = apiData.views;
                    }
                    if (apiData.replies !== null && !isNaN(apiData.replies)) {
                        post.newReplies = Math.max(0, apiData.replies - (post.replies || 0));
                        post.replies = apiData.replies;
                    }
                    if (apiData.updateTimestamp !== null) post.updateTimestamp = apiData.updateTimestamp;
                }
                this.renderFavTable(); 
                await utils.sleep(DELAY_MS);
            }
            utils.saveData();
            status.textContent = `同步完成 (${ids.length}条)`;
        }
    };

    UI.updateTheme();

    document.querySelector('.nv-close-btn').addEventListener('click', UI.closePanel);
    document.querySelectorAll('.nv-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => UI.switchTab(e.target.dataset.target));
    });
    
    document.getElementById('nv-enhancer-panel').addEventListener('click', (e) => {
        if (e.target.classList.contains('nv-del-btn')) {
            const id = e.target.dataset.id;
            if (e.target.dataset.type === 'my') { delete myPosts[id]; UI.renderMyTable(); }
            else { delete favPosts[id]; UI.renderFavTable(); }
            utils.saveData();
            injectStarToList();
        }
    });

    document.getElementById('nv-search-my').addEventListener('input', (e) => { state.mySearch = e.target.value; UI.renderMyTable(); });
    document.getElementById('nv-sort-my').addEventListener('change', (e) => { state.mySort = e.target.value; UI.renderMyTable(); });
    document.getElementById('nv-search-fav').addEventListener('input', (e) => { state.favSearch = e.target.value; UI.renderFavTable(); });
    document.getElementById('nv-sort-fav').addEventListener('change', (e) => { state.favSort = e.target.value; UI.renderFavTable(); });

    document.getElementById('nv-theme-select').value = settings.theme;
    document.getElementById('nv-theme-select').addEventListener('change', (e) => {
        settings.theme = e.target.value;
        utils.saveData();
        UI.updateTheme();
    });

    function autoCaptureMyPosts() {
        const currentUser = utils.getCurrentUser();
        if (!currentUser) return;
        
        document.querySelectorAll('table.n-table tbody tr').forEach(row => {
            const authorSpan = row.querySelector('span.n-text');
            if (authorSpan && authorSpan.textContent.includes(`by ${currentUser}`)) {
                const linkEl = row.querySelector('a.n-a');
                if (!linkEl) return;
                
                const id = utils.getPostIdFromUrl(linkEl.href);
                if (id) {
                    const numbersText = row.querySelector('.article-number')?.textContent || "0/0";
                    const [views, replies] = numbersText.split('/').map(n => parseInt(n) || 0);
                    
                    if (!myPosts[id]) {
                        myPosts[id] = { id, title: linkEl.textContent.trim(), url: linkEl.href, views, replies, updateTimestamp: Date.now(), newViews: 0, newReplies: 0 };
                        utils.saveData();
                    } else {
                        if(views > myPosts[id].views || replies > myPosts[id].replies) {
                           myPosts[id].views = Math.max(views, myPosts[id].views);
                           myPosts[id].replies = Math.max(replies, myPosts[id].replies);
                           utils.saveData();
                        }
                    }
                }
            }
        });
    }

    function injectStarToList() {
        document.querySelectorAll('table.n-table tbody tr').forEach(row => {
            const linkEl = row.querySelector('a.n-a');
            if (!linkEl) return;
            const id = utils.getPostIdFromUrl(linkEl.href);
            
            const flexContainer = row.querySelector('div.n-flex');
            if (flexContainer && (myPosts[id] || favPosts[id])) {
                if (!flexContainer.querySelector('.nv-injected-star')) {
                    const starSpan = document.createElement('span');
                    starSpan.className = 'n-text __text-dark-131ezvy-w nv-injected-star nv-star-icon';
                    starSpan.innerHTML = SVG_FAV;
                    flexContainer.insertBefore(starSpan, flexContainer.firstChild);
                }
            } else if (flexContainer && !myPosts[id] && !favPosts[id]) {
                const existingStar = flexContainer.querySelector('.nv-injected-star');
                if (existingStar) existingStar.remove();
            }
        });
    }

    function injectPanelTrigger() {
        const pagination = document.querySelector('.n-pagination');
        if (pagination && !document.getElementById('nv-trigger-btn')) {
            const btn = document.createElement('button');
            btn.id = 'nv-trigger-btn';
            btn.className = 'nv-theme-btn nv-btn-pagination';
            btn.innerHTML = `⭐ 帖子收藏夹`;
            btn.onclick = () => UI.openPanel();
            pagination.appendChild(btn);
        }
    }

    function injectDetailFavoriteBtn() {
        const postId = utils.getPostIdFromUrl(location.href);
        if (!postId || !location.href.includes('/forum/')) return;

        const btns = Array.from(document.querySelectorAll('.n-button__content'));
        const blockBtnContent = btns.find(b => b.textContent.includes('屏蔽'));
        
        if (blockBtnContent) {
            const container = blockBtnContent.closest('p.n-p') || blockBtnContent.closest('div');
            if (container && !document.getElementById('nv-detail-fav-btn')) {
                const isFav = favPosts[postId] !== undefined;
                
                const favBtn = document.createElement('button');
                favBtn.id = 'nv-detail-fav-btn';
                favBtn.className = 'nv-theme-btn nv-btn-detail';
                favBtn.innerHTML = isFav ? '❌ 取消收藏' : '⭐ 收藏';
                
                favBtn.onclick = async () => {
                    if (isFav) {
                        delete favPosts[postId];
                        favBtn.innerHTML = '⭐ 收藏';
                    } else {
                        const titleEl = document.querySelector('h1.n-h1');
                        favPosts[postId] = { id: postId, title: titleEl ? titleEl.textContent : '已收藏帖子', url: location.href, views: 0, replies: 0, updateTimestamp: Date.now(), newViews: 0, newReplies: 0 };
                        favBtn.innerHTML = '❌ 取消收藏';
                    }
                    utils.saveData();
                };
                blockBtnContent.closest('button').insertAdjacentElement('afterend', favBtn);
            }
        }
    }

    document.getElementById('nv-btn-import-mine').addEventListener('click', async () => {
        const url = prompt("请输入你的帖子链接:");
        if (!url) return;
        const id = utils.getPostIdFromUrl(url);
        if (!id) return alert("无效的帖子链接！");
        const currentUser = utils.getCurrentUser();
        const apiData = await utils.fetchPostData(id);
        
        if (apiData && apiData.author === currentUser) {
            myPosts[id] = { id, url, title: "手动导入的帖子", views: apiData.views||0, replies: apiData.replies||0, updateTimestamp: apiData.updateTimestamp||Date.now() };
            utils.saveData();
            alert("已成功添加至发帖记录！");
            UI.syncAndRenderMyPosts();
        } else {
            alert("验证失败：该帖子作者不是你当前登录的账号，已自动转移至收藏列表。");
            favPosts[id] = { id, url, title: "手动导入的帖子", views: apiData?.views||0, replies: apiData?.replies||0, updateTimestamp: apiData?.updateTimestamp||Date.now() };
            utils.saveData();
            UI.syncAndRenderFavPosts();
        }
    });

    document.getElementById('nv-btn-import-fav').addEventListener('click', () => {
        const url = prompt("请输入你想收藏的帖子链接:");
        if (!url) return;
        const id = utils.getPostIdFromUrl(url);
        if (!id) return alert("无效的帖子链接！");
        
        if(!favPosts[id]) {
            favPosts[id] = { id, url, title: "导入的收藏(将在刷新时更新)", views: 0, replies: 0, updateTimestamp: Date.now() };
            utils.saveData();
            alert("已加入收藏！");
            UI.syncAndRenderFavPosts();
        } else { alert("该帖子已在收藏列表中。"); }
    });

    const runDOMInjectors = utils.debounce(() => {
        if (settings.theme === 'auto') {
            UI.updateTheme();
        }
        if (location.href.includes('/forum') && !location.href.includes('/forum/6')) {
            injectPanelTrigger();
            autoCaptureMyPosts();
            injectStarToList();
        }
        if (location.href.includes('/forum/6')) {
            injectDetailFavoriteBtn();
        }
    }, 500);

    const observer = new MutationObserver(() => { runDOMInjectors(); });
    observer.observe(document.body, { childList: true, subtree: true });

})();
