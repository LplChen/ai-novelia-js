// ==UserScript==
// @name         Novelia 文库详情页优化
// @namespace    https://n.novelia.cc/
// @version      1.2
// @description  在评论标签显示评论数；目录滚动到底部时提示并支持自动切换评论区
// @author       Deepseek
// @match        https://n.novelia.cc/wenku/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SHOW_COMMENT_COUNT: GM_getValue('showCommentCount', true),
        SCROLL_SWITCH: GM_getValue('scrollSwitch', true),
        SCROLL_THRESHOLD: 5,
        SWITCH_COOLDOWN: 1500,
    };

    // ========== 菜单 ==========
    function registerMenu() {
        GM_registerMenuCommand(
            `📊 显示评论数: ${CONFIG.SHOW_COMMENT_COUNT ? '✅ 开启' : '❌ 关闭'}`,
            () => {
                CONFIG.SHOW_COMMENT_COUNT = !CONFIG.SHOW_COMMENT_COUNT;
                GM_setValue('showCommentCount', CONFIG.SHOW_COMMENT_COUNT);
                location.reload();
            }
        );
        GM_registerMenuCommand(
            `⬇️ 滚动切换评论: ${CONFIG.SCROLL_SWITCH ? '✅ 开启' : '❌ 关闭'}`,
            () => {
                CONFIG.SCROLL_SWITCH = !CONFIG.SCROLL_SWITCH;
                GM_setValue('scrollSwitch', CONFIG.SCROLL_SWITCH);
                location.reload();
            }
        );
    }

    // ========== 工具 ==========
    function findCommentTab() {
        for (const tab of document.querySelectorAll('.n-tabs-tab')) {
            if (tab.querySelector('.n-tabs-tab__label')?.textContent.includes('评论区')) return tab;
        }
        return null;
    }
    function findTocTab() {
        for (const tab of document.querySelectorAll('.n-tabs-tab')) {
            if (tab.querySelector('.n-tabs-tab__label')?.textContent.includes('目录')) return tab;
        }
        return null;
    }
    function getWenkuId() {
        const m = location.pathname.match(/\/wenku\/([a-f0-9]+)/i);
        return m ? m[1] : null;
    }

    // 判断当前页面是否为深色模式（参考脚本二）
    function isDarkMode() {
        const ntrRoot = document.getElementById('ntr-web-novel');
        if (ntrRoot && ntrRoot.getAttribute('data-theme')) {
            return ntrRoot.getAttribute('data-theme') === 'dark';
        }
        const bg = window.getComputedStyle(document.body).backgroundColor;
        if (bg === 'rgb(16, 16, 20)' || bg === 'rgb(24, 24, 28)') return true;
        return document.querySelector('[class*="-dark-"]') !== null;
    }

    // ========== 功能一：评论数 ==========
    let cachedTotal = null;

    function ensureCommentBadge() {
        if (cachedTotal === null) return;
        const tab = findCommentTab();
        if (!tab) return;
        const label = tab.querySelector('.n-tabs-tab__label');
        if (!label) return;

        // 与术语表 "[12]" 写法一致，直接写进 label 文本，继承其全部样式
        const desired = `评论区 [${cachedTotal}]`;
        if (label.textContent !== desired) {
            label.textContent = desired;
        }
    }

    function setCommentTotal(total) {
        if (typeof total !== 'number') return;
        cachedTotal = total;
        ensureCommentBadge();
    }

    // 主动请求评论总数（最可靠）
    function fetchCommentTotal(id) {
        return fetch(
            `https://forum.novelia.cc/api/v1/external/comment/novel/wenku-${id}?page=1&page_size=10`,
            { credentials: 'omit' }
        )
        .then(r => r.ok ? r.json() : null)
        .then(data => (data && typeof data.total === 'number') ? data.total : null)
        .catch(err => {
            console.warn('[Novelia 评论数] 主动请求失败:', err);
            return null;
        });
    }

    // 拦截兜底（覆盖 SPA 路由切换时页面自己发的请求）
    function installNetworkInterceptors() {
        const origFetch = window.fetch;
        window.fetch = function(...args) {
            const url = args[0] instanceof Request ? args[0].url : String(args[0]);
            return origFetch.apply(this, args).then(resp => {
                if (cachedTotal === null && /external\/comment|\/comment\/novel/i.test(url)) {
                    resp.clone().json().then(data => {
                        if (data && typeof data.total === 'number') setCommentTotal(data.total);
                    }).catch(() => {});
                }
                return resp;
            });
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.addEventListener('load', function() {
                if (cachedTotal === null && typeof url === 'string' && /external\/comment|\/comment\/novel/i.test(url)) {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data && typeof data.total === 'number') setCommentTotal(data.total);
                    } catch (e) {}
                }
            });
            return origOpen.call(this, method, url, ...rest);
        };
    }

    // 等待评论标签出现 + 防止 Vue 重渲染覆盖 badge
    function watchCommentTab() {
        let retries = 0;
        const bind = () => {
            const tab = findCommentTab();
            if (!tab) {
                if (retries++ < 50) setTimeout(bind, 300);
                return;
            }
            ensureCommentBadge();
            if (tab.__noveliaObserved) return;
            tab.__noveliaObserved = true;

            const mo = new MutationObserver(() => {
                if (cachedTotal === null) return;
                const label = tab.querySelector('.n-tabs-tab__label');
                if (!label) return;
                if (label.textContent !== `评论区 [${cachedTotal}]`) {
                    ensureCommentBadge();
                }
            });
            mo.observe(tab, { childList: true, subtree: true, characterData: true });
        };
        bind();
    }

    function initCommentCount() {
        if (!CONFIG.SHOW_COMMENT_COUNT) return;
        const id = getWenkuId();
        if (id) {
            fetchCommentTotal(id).then(total => {
                if (total !== null) setCommentTotal(total);
            });
        }
        watchCommentTab();
    }

    // ========== 功能二：滚动切换 ==========
    let popupEl = null;
    let lastScrollTime = 0;
    let hasShownPopup = false;
    let accumulatedDelta = 0;

    let toastEl = null;
    let toastTimer = null;
    let stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'novelia-toast-style';
        style.textContent = `
        #novelia-scroll-toast {
            position: fixed;
            bottom: 36px;
            left: 50%;
            transform: translateX(-50%) translateY(16px) scale(0.96);
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 18px;
            border-radius: 999px;
            font-size: 13.5px;
            font-weight: 500;
            font-family: v-sans, system-ui, -apple-system, sans-serif;
            white-space: nowrap;
            pointer-events: none;
            z-index: 9999;
            opacity: 0;
            transition: opacity .25s ease, transform .25s cubic-bezier(.2,.8,.2,1);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }
        /* 深色主题 */
        #novelia-scroll-toast.dark-theme {
            background-color: rgba(36, 36, 42, 0.92);
            color: rgba(255, 255, 255, 0.88);
            border: 1px solid rgba(99, 226, 183, 0.35);
            box-shadow: 0 6px 24px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.12);
        }
        /* 亮色主题 */
        #novelia-scroll-toast.light-theme {
            background-color: rgba(255, 255, 255, 0.95);
            color: rgb(51, 54, 57);
            border: 1px solid rgba(24, 160, 88, 0.35);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        #novelia-scroll-toast.novelia-toast-show {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
        }
        #novelia-scroll-toast .toast-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            flex: none;
            animation: novelia-toast-bounce 1.2s ease-in-out infinite;
        }
        #novelia-scroll-toast.dark-theme .toast-icon {
            color: #63e2b7;
            background: rgba(99, 226, 183, 0.14);
        }
        #novelia-scroll-toast.light-theme .toast-icon {
            color: #18a058;
            background: rgba(24, 160, 88, 0.12);
        }
        @keyframes novelia-toast-bounce {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(3px); }
        }
        @media (prefers-reduced-motion: reduce) {
            #novelia-scroll-toast,
            #novelia-scroll-toast.novelia-toast-show { transition: none; }
            #novelia-scroll-toast .toast-icon { animation: none; }
        }
        `;
        document.head.appendChild(style);
    }

    function showToast(text = '向下再滚动一次进入评论区') {
        injectStyles();
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.id = 'novelia-scroll-toast';
            toastEl.innerHTML = `
            <span class="toast-icon">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6l-6-6l1.41-1.41z"></path>
                </svg>
            </span>
            <span class="toast-text"></span>
        `;
            document.body.appendChild(toastEl);
        }
        toastEl.querySelector('.toast-text').textContent = text;

        // 每次弹出按当前主题切换皮肤
        toastEl.classList.remove('dark-theme', 'light-theme');
        toastEl.classList.add(isDarkMode() ? 'dark-theme' : 'light-theme');

        // 强制重排，确保从隐藏态过渡到显示态
        void toastEl.offsetWidth;
        toastEl.classList.add('novelia-toast-show');
    }

    function hideToast() {
        if (!toastEl) return;
        toastEl.classList.remove('novelia-toast-show');
    }

    // 兼容旧函数名
    const showPopup = showToast;
    const hidePopup = hideToast;

    function switchToCommentTab() {
        const tab = findCommentTab();
        if (tab) tab.click();
        hasShownPopup = false;
        hideToast();
        accumulatedDelta = 0;
    }

    function initScrollSwitch() {
        if (!CONFIG.SCROLL_SWITCH) return;

        window.addEventListener('wheel', (e) => {
            const tocTab = findTocTab();
            if (!tocTab || !tocTab.classList.contains('n-tabs-tab--active')) {
                hidePopup();
                accumulatedDelta = 0;
                return;
            }
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = document.documentElement.clientHeight;
            const dist = scrollHeight - (scrollTop + clientHeight);
            const atBottom = dist <= CONFIG.SCROLL_THRESHOLD;

            if (atBottom && e.deltaY > 0) {
                const now = Date.now();
                if (now - lastScrollTime < CONFIG.SWITCH_COOLDOWN) return;
                if (!hasShownPopup) {
                    hasShownPopup = true;
                    accumulatedDelta = e.deltaY;
                    showToast('向下再滚动一次进入评论区');
                    lastScrollTime = now;
                } else {
                    accumulatedDelta += e.deltaY;
                    if (accumulatedDelta > 30) {
                        switchToCommentTab();
                        lastScrollTime = now;
                    }
                }
            } else if (!atBottom) {
                hideToast();
                hasShownPopup = false;
                accumulatedDelta = 0;
            }
        }, { passive: true });

        window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = document.documentElement.clientHeight;
            if (scrollHeight - (scrollTop + clientHeight) > CONFIG.SCROLL_THRESHOLD) {
                hidePopup();
                hasShownPopup = false;
                accumulatedDelta = 0;
            }
        }, { passive: true });
    }

    // ========== SPA 路由变化 ==========
    let lastWenkuId = null;
    function handleRouteChange() {
        const id = getWenkuId();
        if (!id || id === lastWenkuId) return;
        lastWenkuId = id;
        cachedTotal = null;

        const tab = findCommentTab();
        const label = tab?.querySelector('.n-tabs-tab__label');
        if (label && label.textContent !== '评论区') {
            label.textContent = '评论区';
        }

        if (CONFIG.SHOW_COMMENT_COUNT) {
            fetchCommentTotal(id).then(total => { if (total !== null) setCommentTotal(total); });
            watchCommentTab();
        }
    }
    function hookHistory() {
        const wrap = (type) => {
            const orig = history[type];
            history[type] = function(...args) {
                const ret = orig.apply(this, args);
                setTimeout(handleRouteChange, 50);
                return ret;
            };
        };
        wrap('pushState');
        wrap('replaceState');
        window.addEventListener('popstate', () => setTimeout(handleRouteChange, 50));
    }

    // ========== 初始化 ==========
    function init() {
        registerMenu();
        if (CONFIG.SHOW_COMMENT_COUNT) {
            lastWenkuId = getWenkuId();
            initCommentCount();
            hookHistory();
        }
        initScrollSwitch();
    }

    if (CONFIG.SHOW_COMMENT_COUNT) {
        installNetworkInterceptors();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
