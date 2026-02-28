// ==UserScript==
// @name         Novelia 网络小说黑名单助手
// @namespace    https://n.novelia.cc/
// @version      1.2.0
// @description  在网络小说搜索页和详情页添加拉黑按钮，管理黑名单，支持本地导入/导出黑名单
// @author       Claude
// @match        https://n.novelia.cc/novel*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 工具函数
  // ============================================================
  const STORAGE_KEY = 'novelia_blacklist';

  function getBlacklist() {
    try {
      return JSON.parse(GM_getValue(STORAGE_KEY, '[]'));
    } catch {
      return [];
    }
  }

  function saveBlacklist(list) {
    GM_setValue(STORAGE_KEY, JSON.stringify(list));
  }

  function addToBlacklist(url, title) {
    const list = getBlacklist();
    const normalized = normalizeUrl(url);
    if (!list.find(item => item.url === normalized)) {
      list.push({ url: normalized, title: title || '', addedAt: Date.now() });
      saveBlacklist(list);
    }
    return list;
  }

  function removeFromBlacklist(urls) {
    const list = getBlacklist();
    const normalized = (Array.isArray(urls) ? urls : [urls]).map(normalizeUrl);
    const newList = list.filter(item => !normalized.includes(item.url));
    saveBlacklist(newList);
    return newList;
  }

  function isBlacklisted(url) {
    const list = getBlacklist();
    return list.some(item => item.url === normalizeUrl(url));
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url, location.origin);
      return u.pathname;
    } catch {
      return url.replace(/^https?:\/\/[^/]+/, '');
    }
  }

  function getNovelUrlFromItem(item) {
    const link = item.querySelector('a.n-a.__a-dark-131ezvy, a[href*="/novel/"]');
    return link ? link.getAttribute('href') : null;
  }

  // ============================================================
  // 主题检测
  // ============================================================
  function isDarkMode() {
    const setting = localStorage.getItem('setting');
    if (setting) {
      try {
        const s = JSON.parse(setting);
        const theme = s.theme;
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
      } catch {}
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ============================================================
  // 样式注入
  // ============================================================
  GM_addStyle(`
    /* 拉黑按钮 */
    .nm-blacklist-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 11px;
      padding: 1px 7px;
      height: 20px;
      border-radius: 2px;
      border: 1px solid rgba(232, 128, 128, 0.5);
      color: #e88080;
      background: transparent;
      white-space: nowrap;
      flex-shrink: 0;
      margin-right: 6px;
      transition: background .2s, color .2s, border-color .2s;
      line-height: 1;
      font-family: inherit;
      vertical-align: middle;
      user-select: none;
    }
    .nm-blacklist-btn:hover {
      background: rgba(232, 128, 128, 0.15);
      border-color: #e88080;
    }
    .nm-blacklist-btn.nm-btn-detail {
      font-size: 13px;
      padding: 0 14px;
      height: 34px;
      border-radius: 34px;
    }

    /* 黑名单管理面板 */
    #nm-panel-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.5);
      z-index: 99998;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #nm-panel {
      width: min(760px, 95vw);
      max-height: 85vh;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 6px 32px rgba(0,0,0,.5);
      font-family: v-sans, system-ui, -apple-system, sans-serif;
      font-size: 14px;
      overflow: hidden;
      z-index: 99999;
    }
    #nm-panel.nm-dark {
      background: rgb(24, 24, 28);
      color: rgba(255,255,255,.82);
      border: 1px solid rgba(255,255,255,.09);
    }
    #nm-panel.nm-light {
      background: #fff;
      color: #333;
      border: 1px solid rgba(0,0,0,.12);
    }

    /* 面板头部 */
    #nm-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid;
      flex-shrink: 0;
    }
    .nm-dark #nm-panel-header { border-color: rgba(255,255,255,.09); }
    .nm-light #nm-panel-header { border-color: rgba(0,0,0,.1); }
    #nm-panel-title {
      font-size: 16px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #nm-panel-close {
      cursor: pointer;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 3px;
      border: none;
      background: transparent;
      font-size: 18px;
      transition: background .2s;
    }
    .nm-dark #nm-panel-close { color: rgba(255,255,255,.6); }
    .nm-light #nm-panel-close { color: #666; }
    #nm-panel-close:hover { background: rgba(128,128,128,.15); }

    /* Tab 导航 */
    #nm-tabs {
      display: flex;
      padding: 0 20px;
      gap: 0;
      border-bottom: 1px solid;
      flex-shrink: 0;
    }
    .nm-dark #nm-tabs { border-color: rgba(255,255,255,.09); }
    .nm-light #nm-tabs { border-color: rgba(0,0,0,.1); }
    .nm-tab {
      padding: 10px 16px;
      cursor: pointer;
      font-size: 13px;
      border-bottom: 2px solid transparent;
      transition: color .2s, border-color .2s;
      white-space: nowrap;
    }
    .nm-dark .nm-tab { color: rgba(255,255,255,.6); }
    .nm-light .nm-tab { color: #666; }
    .nm-tab.active {
      border-bottom-color: #63e2b7;
      color: #63e2b7 !important;
    }

    /* 面板内容区 */
    #nm-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      scrollbar-width: thin;
    }
    .nm-dark #nm-panel-body { scrollbar-color: rgba(255,255,255,.2) transparent; }
    .nm-light #nm-panel-body { scrollbar-color: rgba(0,0,0,.2) transparent; }

    .nm-tab-content { display: none; }
    .nm-tab-content.active { display: block; }

    /* 黑名单列表工具栏 */
    .nm-list-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .nm-list-toolbar .nm-info {
      margin-left: auto;
      font-size: 12px;
      opacity: .6;
    }

    /* 按钮样式 */
    .nm-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 12px;
      height: 28px;
      border-radius: 3px;
      border: 1px solid;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: background .2s, color .2s, border-color .2s;
      white-space: nowrap;
      background: transparent;
    }
    .nm-dark .nm-btn {
      color: rgba(255,255,255,.82);
      border-color: rgba(255,255,255,.24);
    }
    .nm-light .nm-btn {
      color: #444;
      border-color: rgba(0,0,0,.2);
    }
    .nm-dark .nm-btn:hover { border-color: #7fe7c4; color: #7fe7c4; }
    .nm-light .nm-btn:hover { border-color: #38b28a; color: #38b28a; }
    .nm-btn.nm-btn-danger {
      border-color: rgba(232,128,128,.5);
      color: #e88080;
    }
    .nm-btn.nm-btn-danger:hover { background: rgba(232,128,128,.12); border-color: #e88080; }
    .nm-btn.nm-btn-primary {
      border-color: rgba(99,226,183,.5);
      color: #63e2b7;
    }
    .nm-btn.nm-btn-primary:hover { background: rgba(99,226,183,.12); border-color: #63e2b7; }
    .nm-btn:disabled { opacity: .4; cursor: not-allowed; }

    /* 黑名单条目列表 */
    #nm-blacklist-items {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .nm-item-row {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      border-radius: 4px;
      gap: 10px;
      transition: background .15s;
    }
    .nm-dark .nm-item-row:hover { background: rgba(255,255,255,.06); }
    .nm-light .nm-item-row:hover { background: rgba(0,0,0,.04); }
    .nm-item-check {
      flex-shrink: 0;
      width: 15px; height: 15px;
      cursor: pointer;
      accent-color: #63e2b7;
    }
    .nm-item-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nm-item-url {
      font-size: 11px;
      opacity: .5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
    }
    .nm-item-remove {
      flex-shrink: 0;
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 2px;
      font-size: 11px;
      border: 1px solid rgba(232,128,128,.4);
      color: #e88080;
      background: transparent;
      font-family: inherit;
      transition: background .15s;
    }
    .nm-item-remove:hover { background: rgba(232,128,128,.12); }

    .nm-empty {
      text-align: center;
      padding: 40px 0;
      opacity: .45;
      font-size: 13px;
    }

    /* 导入/导出区域 */
    .nm-section {
      margin-bottom: 20px;
    }
    .nm-section-title {
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 10px;
      opacity: .8;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nm-section-title::before {
      content: '';
      width: 3px; height: 14px;
      background: #63e2b7;
      border-radius: 2px;
      display: inline-block;
    }
    .nm-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 8px;
    }

    /* 输入框 */
    .nm-input {
      padding: 0 10px;
      height: 28px;
      border-radius: 3px;
      border: 1px solid;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color .2s;
      flex: 1;
      min-width: 0;
    }
    .nm-dark .nm-input {
      background: rgba(255,255,255,.08);
      border-color: transparent;
      color: rgba(255,255,255,.82);
    }
    .nm-dark .nm-input::placeholder { color: rgba(255,255,255,.35); }
    .nm-dark .nm-input:focus { border-color: #7fe7c4; background: rgba(99,226,183,.08); }
    .nm-light .nm-input {
      background: rgba(0,0,0,.04);
      border-color: rgba(0,0,0,.15);
      color: #333;
    }
    .nm-light .nm-input:focus { border-color: #38b28a; }

    /* 主题面板 */
    .nm-theme-options {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .nm-theme-opt {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      padding: 8px 14px;
      border-radius: 4px;
      border: 1px solid;
      font-size: 13px;
      transition: all .2s;
    }
    .nm-dark .nm-theme-opt { border-color: rgba(255,255,255,.18); }
    .nm-light .nm-theme-opt { border-color: rgba(0,0,0,.15); }
    .nm-theme-opt.selected {
      border-color: #63e2b7;
      color: #63e2b7;
    }
    .nm-theme-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      border: 1px solid currentColor;
      display: inline-block;
    }
    .nm-theme-dot.filled { background: #63e2b7; border-color: #63e2b7; }

    /* 说明文本 */
    .nm-notice {
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.7;
      margin-top: 8px;
    }
    .nm-dark .nm-notice { background: rgba(99,226,183,.08); color: rgba(255,255,255,.65); border: 1px solid rgba(99,226,183,.2); }
    .nm-light .nm-notice { background: rgba(56,178,138,.06); color: #555; border: 1px solid rgba(56,178,138,.2); }
    .nm-notice a { color: #63e2b7; }

    /* 操作面板触发按钮 */
    #nm-panel-trigger {
      position: fixed;
      z-index: 9997;
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 1.5px solid rgba(99,226,183,.5);
      background: rgba(99,226,183,.12);
      color: #63e2b7;
      font-size: 20px;
      cursor: grab;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(0,0,0,.3);
      transition: background .2s, border-color .2s, box-shadow .2s;
      backdrop-filter: blur(4px);
      touch-action: none;
      user-select: none;
    }
    #nm-panel-trigger:hover {
      background: rgba(99,226,183,.22);
      border-color: #63e2b7;
      box-shadow: 0 4px 18px rgba(0,0,0,.4);
    }
    #nm-panel-trigger.nm-dragging {
      cursor: grabbing;
      box-shadow: 0 8px 28px rgba(0,0,0,.5);
      transition: none;
    }
    /* 拖拽时显示的吸附提示光晕 */
    #nm-panel-trigger.nm-snap-hint {
      border-color: #63e2b7;
      box-shadow: 0 0 0 4px rgba(99,226,183,.25), 0 4px 18px rgba(0,0,0,.4);
    }

    /* toast 提示 */
    .nm-toast {
      position: fixed;
      bottom: 80px;
      right: 24px;
      padding: 10px 18px;
      border-radius: 4px;
      font-size: 13px;
      z-index: 99999;
      pointer-events: none;
      animation: nm-toast-in .2s ease;
      font-family: v-sans, system-ui, -apple-system, sans-serif;
    }
    .nm-toast-success { background: rgba(99,226,183,.2); color: #63e2b7; border: 1px solid rgba(99,226,183,.3); }
    .nm-toast-error { background: rgba(232,128,128,.2); color: #e88080; border: 1px solid rgba(232,128,128,.3); }
    @keyframes nm-toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
  `);

  // ============================================================
  // Toast 提示
  // ============================================================
  function showToast(msg, type = 'success', duration = 2500) {
    const t = document.createElement('div');
    t.className = `nm-toast nm-toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  // ============================================================
  // 管理面板 UI
  // ============================================================
  let panelOpen = false;
  let currentTab = 'blacklist';
  let panelTheme = GM_getValue('nm_panel_theme', 'auto'); // 'auto' | 'dark' | 'light'
  let selectedUrls = new Set();

  function getPanelThemeClass() {
    if (panelTheme === 'dark') return 'nm-dark';
    if (panelTheme === 'light') return 'nm-light';
    return isDarkMode() ? 'nm-dark' : 'nm-light';
  }

  function buildPanel() {
    const overlay = document.createElement('div');
    overlay.id = 'nm-panel-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });

    const panel = document.createElement('div');
    panel.id = 'nm-panel';
    panel.className = getPanelThemeClass();

    panel.innerHTML = `
      <div id="nm-panel-header">
        <div id="nm-panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          小说黑名单管理器
        </div>
        <button id="nm-panel-close" title="关闭">✕</button>
      </div>

      <div id="nm-tabs">
        <div class="nm-tab active" data-tab="blacklist">📋 黑名单管理</div>
        <div class="nm-tab" data-tab="io">📤 导入 &amp; 导出</div>
        <div class="nm-tab" data-tab="theme">🎨 主题</div>
      </div>

      <div id="nm-panel-body">
        <!-- 黑名单管理 -->
        <div class="nm-tab-content active" id="nm-tab-blacklist">
          <div class="nm-list-toolbar">
            <button class="nm-btn" id="nm-select-all">全选</button>
            <button class="nm-btn" id="nm-invert-select">反选</button>
            <button class="nm-btn nm-btn-danger" id="nm-remove-selected">删除所选</button>
            <span class="nm-info" id="nm-count-info"></span>
          </div>
          <div id="nm-blacklist-items"></div>
        </div>

        <!-- 导入导出 -->
        <div class="nm-tab-content" id="nm-tab-io">
          <div class="nm-section">
            <div class="nm-section-title">本地导入 &amp; 导出</div>
            <div class="nm-row">
              <button class="nm-btn nm-btn-primary" id="nm-export-local">⬇ 导出到本地</button>
              <button class="nm-btn" id="nm-import-local">⬆ 从本地导入</button>
              <input type="file" id="nm-file-input" accept=".json" style="display:none">
            </div>
          </div>

          <div class="nm-section">
            <div class="nm-section-title">说明</div>
            <div class="nm-notice">
              📌 搜索屏蔽特定 Tags 详见
              <a href="https://n.novelia.cc/forum/64f3d63f794cbb1321145c07" target="_blank">论坛使用指南区的教程</a>。<br>
              本功能仅管理您手动拉黑的小说（以链接为唯一识别依据）。<br>
              数据以 JSON 格式存储，可用记事本查看和编辑。
            </div>
          </div>
        </div>

        <!-- 主题 -->
        <div class="nm-tab-content" id="nm-tab-theme">
          <div class="nm-section">
            <div class="nm-section-title">面板主题</div>
            <div class="nm-theme-options">
              <div class="nm-theme-opt" data-theme="auto">
                <span class="nm-theme-dot"></span> 跟随网站
              </div>
              <div class="nm-theme-opt" data-theme="dark">
                <span class="nm-theme-dot"></span> 深色
              </div>
              <div class="nm-theme-opt" data-theme="light">
                <span class="nm-theme-dot"></span> 浅色
              </div>
            </div>
          </div>
          <div class="nm-notice" style="margin-top:12px">
            💡 当前网站主题检测基于 localStorage 中的 setting.theme 值。<br>
            如果"跟随网站"效果不对，可手动选择深色或浅色。
          </div>
        </div>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // 绑定事件
    document.getElementById('nm-panel-close').addEventListener('click', closePanel);

    // Tab 切换
    panel.querySelectorAll('.nm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = tab.dataset.tab;
        panel.querySelectorAll('.nm-tab').forEach(x => x.classList.remove('active'));
        panel.querySelectorAll('.nm-tab-content').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`nm-tab-${t}`).classList.add('active');
        currentTab = t;
        if (t === 'blacklist') renderBlacklist();
        if (t === 'theme') renderThemePanel();
      });
    });

    // 黑名单管理按钮
    document.getElementById('nm-select-all').addEventListener('click', () => {
      const list = getBlacklist();
      const allSelected = selectedUrls.size === list.length;
      selectedUrls = allSelected ? new Set() : new Set(list.map(x => x.url));
      renderBlacklist();
    });

    document.getElementById('nm-invert-select').addEventListener('click', () => {
      const list = getBlacklist();
      const newSel = new Set();
      list.forEach(x => { if (!selectedUrls.has(x.url)) newSel.add(x.url); });
      selectedUrls = newSel;
      renderBlacklist();
    });

    document.getElementById('nm-remove-selected').addEventListener('click', () => {
      if (selectedUrls.size === 0) return showToast('请先选择要删除的条目', 'error');
      removeFromBlacklist([...selectedUrls]);
      selectedUrls.clear();
      renderBlacklist();
      filterCurrentPageItems();
      showToast('已从黑名单移除');
    });

    // 本地导出
    document.getElementById('nm-export-local').addEventListener('click', () => {
      const list = getBlacklist();
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `novelia-blacklist-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      showToast(`已导出 ${list.length} 条记录`);
    });

    // 本地导入
    document.getElementById('nm-import-local').addEventListener('click', () => {
      document.getElementById('nm-file-input').click();
    });

    document.getElementById('nm-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!Array.isArray(data)) throw new Error('格式错误');
          const list = getBlacklist();
          let added = 0;
          data.forEach(item => {
            if (item.url && !list.find(x => x.url === item.url)) {
              list.push({ url: item.url, title: item.title || '', addedAt: item.addedAt || Date.now() });
              added++;
            }
          });
          saveBlacklist(list);
          renderBlacklist();
          filterCurrentPageItems();
          showToast(`导入完成，新增 ${added} 条`);
        } catch (err) {
          showToast('导入失败：' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });



    renderBlacklist();
    return { overlay, panel };
  }

  function renderBlacklist() {
    const container = document.getElementById('nm-blacklist-items');
    const countEl = document.getElementById('nm-count-info');
    if (!container) return;
    const list = getBlacklist();
    countEl.textContent = `共 ${list.length} 条`;

    if (list.length === 0) {
      container.innerHTML = '<div class="nm-empty">🎉 黑名单为空</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'nm-item-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'nm-item-check';
      cb.checked = selectedUrls.has(item.url);
      cb.addEventListener('change', () => {
        cb.checked ? selectedUrls.add(item.url) : selectedUrls.delete(item.url);
      });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'nm-item-title';
      titleSpan.title = item.title || item.url;
      titleSpan.textContent = item.title || '（无标题）';

      const urlSpan = document.createElement('span');
      urlSpan.className = 'nm-item-url';
      urlSpan.title = item.url;
      urlSpan.textContent = item.url;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'nm-item-remove';
      removeBtn.textContent = '移除';
      removeBtn.addEventListener('click', () => {
        removeFromBlacklist(item.url);
        selectedUrls.delete(item.url);
        renderBlacklist();
        filterCurrentPageItems();
        showToast('已从黑名单移除');
      });

      row.appendChild(cb);
      row.appendChild(titleSpan);
      row.appendChild(urlSpan);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  function renderThemePanel() {
    const panel = document.getElementById('nm-panel');
    if (!panel) return;
    panel.querySelectorAll('.nm-theme-opt').forEach(opt => {
      const isSelected = opt.dataset.theme === panelTheme;
      opt.classList.toggle('selected', isSelected);
      opt.querySelector('.nm-theme-dot').classList.toggle('filled', isSelected);
      opt.onclick = () => {
        panelTheme = opt.dataset.theme;
        GM_setValue('nm_panel_theme', panelTheme);
        panel.className = getPanelThemeClass();
        renderThemePanel();
      };
    });
  }

  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;
    selectedUrls.clear();
    currentTab = 'blacklist';
    buildPanel();
    renderThemePanel();
  }

  function closePanel() {
    panelOpen = false;
    const overlay = document.getElementById('nm-panel-overlay');
    if (overlay) overlay.remove();
  }

  // 悬浮按钮（可拖动，位置持久化，边缘吸附）
  function addTriggerButton() {
    if (document.getElementById('nm-panel-trigger')) return;

    const POS_KEY = 'nm_trigger_pos';
    const BTN_SIZE = 44;
    const EDGE_SNAP = 16; // 吸附边缘距离

    const btn = document.createElement('button');
    btn.id = 'nm-panel-trigger';
    btn.title = '黑名单管理器（可拖动）';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>`;
    document.body.appendChild(btn);

    // 读取或设置初始位置
    function clampPos(x, y) {
      const maxX = window.innerWidth - BTN_SIZE - EDGE_SNAP;
      const maxY = window.innerHeight - BTN_SIZE - EDGE_SNAP;
      return {
        x: Math.max(EDGE_SNAP, Math.min(x, maxX)),
        y: Math.max(EDGE_SNAP, Math.min(y, maxY))
      };
    }

    function applyPos(x, y) {
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.style.right = '';
      btn.style.bottom = '';
    }

    // 吸附到最近的垂直边
    function snapToEdge(x, y) {
      const midX = window.innerWidth / 2;
      const snappedX = x < midX
        ? EDGE_SNAP
        : window.innerWidth - BTN_SIZE - EDGE_SNAP;
      return { x: snappedX, y };
    }

    // 初始位置：读取存储，默认右下
    let savedPos = null;
    try { savedPos = JSON.parse(GM_getValue(POS_KEY, 'null')); } catch {}
    if (!savedPos) {
      savedPos = {
        x: window.innerWidth - BTN_SIZE - EDGE_SNAP,
        y: window.innerHeight - BTN_SIZE - 24
      };
    }
    const initPos = clampPos(savedPos.x, savedPos.y);
    applyPos(initPos.x, initPos.y);

    // 窗口 resize 时重新钳制
    window.addEventListener('resize', () => {
      const cur = btn.getBoundingClientRect();
      const clamped = clampPos(cur.left, cur.top);
      applyPos(clamped.x, clamped.y);
    });

    // 拖拽逻辑
    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;
    let startX = 0, startY = 0;
    let hasMoved = false;

    function onDragStart(clientX, clientY) {
      isDragging = true;
      hasMoved = false;
      const rect = btn.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
      startX = clientX;
      startY = clientY;
      btn.classList.add('nm-dragging');
    }

    function onDragMove(clientX, clientY) {
      if (!isDragging) return;
      if (Math.abs(clientX - startX) > 3 || Math.abs(clientY - startY) > 3) {
        hasMoved = true;
      }
      const newX = clientX - dragOffsetX;
      const newY = clientY - dragOffsetY;
      const clamped = clampPos(newX, newY);
      applyPos(clamped.x, clamped.y);

      // 接近边缘时显示吸附提示
      const nearEdge = clamped.x <= EDGE_SNAP + 10 || clamped.x >= window.innerWidth - BTN_SIZE - EDGE_SNAP - 10;
      btn.classList.toggle('nm-snap-hint', nearEdge);
    }

    function onDragEnd(clientX, clientY) {
      if (!isDragging) return;
      isDragging = false;
      btn.classList.remove('nm-dragging', 'nm-snap-hint');

      if (hasMoved) {
        // 松手时吸附到最近的垂直边
        const rect = btn.getBoundingClientRect();
        const snapped = snapToEdge(rect.left, rect.top);
        const clamped = clampPos(snapped.x, snapped.y);
        // 带动画吸附
        btn.style.transition = 'left .25s cubic-bezier(.4,0,.2,1), top .25s cubic-bezier(.4,0,.2,1)';
        applyPos(clamped.x, clamped.y);
        setTimeout(() => { btn.style.transition = ''; }, 280);
        GM_setValue(POS_KEY, JSON.stringify({ x: clamped.x, y: clamped.y }));
      }
    }

    // Mouse events
    btn.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      onDragStart(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', e => onDragMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', e => {
      if (!isDragging) return;
      onDragEnd(e.clientX, e.clientY);
      if (!hasMoved) openPanel(); // 没有移动才触发点击
    });

    // Touch events
    btn.addEventListener('touchstart', e => {
      const t = e.touches[0];
      onDragStart(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!isDragging) return;
      e.preventDefault();
      const t = e.touches[0];
      onDragMove(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchend', e => {
      if (!isDragging) return;
      const t = e.changedTouches[0];
      onDragEnd(t.clientX, t.clientY);
      if (!hasMoved) openPanel();
    });
  }

  // ============================================================
  // 搜索列表页：屏蔽 + 添加拉黑按钮
  // ============================================================
  function processListItems() {
    const items = document.querySelectorAll('.n-list-item__main');
    items.forEach(item => {
      if (item.dataset.nmProcessed) return;
      item.dataset.nmProcessed = '1';

      // 找到链接 & 书名
      const link = item.querySelector('a.n-a.__a-dark-131ezvy, a[href*="/novel/"]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // 如果已拉黑则隐藏
      if (isBlacklisted(href)) {
        const listItem = item.closest('.n-list-item') || item.parentElement;
        if (listItem) {
          listItem.style.display = 'none';
          listItem.dataset.nmHidden = '1';
        }
        return;
      }

      // 注入拉黑按钮
      const btn = document.createElement('button');
      btn.className = 'nm-blacklist-btn';
      btn.textContent = '拉黑';
      btn.title = '将此小说加入黑名单';

      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const title = link.textContent.trim();
        addToBlacklist(href, title);
        const listItem = item.closest('.n-list-item') || item.parentElement;
        if (listItem) {
          listItem.style.display = 'none';
          listItem.dataset.nmHidden = '1';
        }
        showToast(`《${title}》已加入黑名单`);
      });

      // 用 span 包裹按钮和链接，保持同行
      const wrapper = document.createElement('span');
      wrapper.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:nowrap;';
      link.parentNode.insertBefore(wrapper, link);
      wrapper.appendChild(btn);
      wrapper.appendChild(link);
    });
  }

  function filterCurrentPageItems() {
    const items = document.querySelectorAll('.n-list-item__main');
    items.forEach(item => {
      const link = item.querySelector('a[href*="/novel/"]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (isBlacklisted(href)) {
        const listItem = item.closest('.n-list-item') || item.parentElement;
        if (listItem) {
          listItem.style.display = 'none';
          listItem.dataset.nmHidden = '1';
        }
      } else {
        const listItem = item.closest('.n-list-item') || item.parentElement;
        if (listItem && listItem.dataset.nmHidden) {
          listItem.style.display = '';
          delete listItem.dataset.nmHidden;
        }
      }
    });
  }

  // ============================================================
  // 详情页：添加拉黑按钮
  // ============================================================
  function processDetailPage() {
    // 找操作栏的 n-flex 容器（含"开始阅读"/"继续阅读"等按钮）
    const nFlexes = document.querySelectorAll('.n-flex');
    let actionFlex = null;
    nFlexes.forEach(flex => {
      const text = flex.textContent;
      if (
        (text.includes('开始阅读') || text.includes('继续阅读')) &&
        (text.includes('收藏') || text.includes('编辑'))
      ) {
        actionFlex = flex;
      }
    });

    if (!actionFlex) return;
    if (actionFlex.dataset.nmProcessed) return;
    actionFlex.dataset.nmProcessed = '1';

    const novelPath = normalizeUrl(location.href);
    const pageTitle = document.title.replace(' | 轻小说机翻机器人', '').trim();

    const btn = document.createElement('button');
    btn.className = 'nm-blacklist-btn nm-btn-detail';

    const updateBtn = () => {
      if (isBlacklisted(novelPath)) {
        btn.textContent = '已拉黑';
        btn.style.borderColor = 'rgba(232,128,128,.3)';
        btn.style.opacity = '.6';
      } else {
        btn.textContent = '拉黑';
        btn.style.borderColor = '';
        btn.style.opacity = '';
      }
    };
    updateBtn();

    btn.addEventListener('click', () => {
      if (isBlacklisted(novelPath)) {
        removeFromBlacklist(novelPath);
        showToast('已从黑名单移除');
      } else {
        addToBlacklist(novelPath, pageTitle);
        showToast(`《${pageTitle}》已加入黑名单`);
      }
      updateBtn();
    });

    actionFlex.appendChild(btn);
  }

  // ============================================================
  // 路由检测与初始化
  // ============================================================
  function isListPage() {
    return /^\/novel\/?(\?|$)/.test(location.pathname) ||
           /^\/novel$/.test(location.pathname);
  }

  function isDetailPage() {
    return /^\/novel\/[^/]+\/[^/]+\/?$/.test(location.pathname);
  }

  function init() {
    addTriggerButton();

    if (isListPage()) {
      processListItems();
    } else if (isDetailPage()) {
      processDetailPage();
    }
  }

  // 监听 DOM 变化（SPA / 懒加载）
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      if (isListPage()) processListItems();
      else if (isDetailPage()) processDetailPage();
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 监听 SPA 路由变化
  const origPush = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPush(...args);
    setTimeout(init, 500);
  };
  window.addEventListener('popstate', () => setTimeout(init, 500));

  // 初始执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();