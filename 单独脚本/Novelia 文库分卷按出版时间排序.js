// ==UserScript==
// @name         Novelia 文库分卷按出版时间排序
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  在 novelia.cc 文库编辑页加入“时间排序”按钮，自动根据出版年月日先后顺序对分卷进行真实排序
// @author       Gemini
// @match        https://n.novelia.cc/*
// @icon         https://n.novelia.cc/favicon.ico
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 解析日期字符串为时间戳，无日期或格式不对的排在最后
    function parseTime(str) {
        if (!str) return Infinity;
        const cleanStr = str.trim();
        const timestamp = Date.parse(cleanStr);
        return isNaN(timestamp) ? Infinity : timestamp;
    }

    // 从单个分卷 <li> 中提取 ASIN 和出版时间
    function extractItemInfo(li, index) {
        const asinEl = li.querySelector('a[href*="/dp/"]');
        const asin = asinEl ? asinEl.textContent.trim() : `idx_${index}`;
        const timeEl = li.querySelector('.n-text time') || li.querySelector('time');
        const timeStr = timeEl ? timeEl.textContent.trim() : '';
        return {
            asin,
            time: parseTime(timeStr),
            timeStr,
            originalIndex: index
        };
    }

    // 核心排序逻辑（直接驱动网页原生的 Vue 事件，确保提交生效）
    async function sortVolumes(volumeFormItem, btnContent) {
        if (!volumeFormItem) return;
        const blank = volumeFormItem.querySelector('.n-form-item-blank');
        if (!blank) return;

        const items = Array.from(blank.querySelectorAll('li.n-list-item'));
        if (items.length <= 1) {
            alert('分卷数量不足，无需排序');
            return;
        }

        // 1. 提取当前所有分卷的 ASIN 与出版时间，并计算出目标排序顺序
        const targetOrder = items.map((li, idx) => extractItemInfo(li, idx));

        targetOrder.sort((a, b) => {
            if (a.time === b.time) return a.originalIndex - b.originalIndex;
            return a.time - b.time;
        });

        // 检查是否已经是有序状态
        const isAlreadySorted = targetOrder.every((item, idx) => item.originalIndex === idx);
        if (isAlreadySorted) {
            if (btnContent) {
                const oldText = btnContent.textContent;
                btnContent.textContent = '已是最新顺序 ✓';
                setTimeout(() => { btnContent.textContent = oldText; }, 1500);
            }
            return;
        }

        if (btnContent) btnContent.textContent = '排序中...';

        // =========================================================================
        // 核心方案：按目标时间顺序（从早到晚），依次触发每个分卷自带的“移至底部”按钮
        // 原理：每个分卷右上角有3个按钮：[0]置顶、[1]置底、[2]删除
        // 依次将排第1的置底、排第2的置底... 走完一遍后，整个列表在 Vue 内部就完全按时间排好序了！
        // =========================================================================
        let clickedSuccess = false;
        try {
            for (const target of targetOrder) {
                // 每次点击后 Vue 会重排 DOM，所以实时根据 ASIN 重新定位对应的 <li>
                const currentItems = Array.from(blank.querySelectorAll('li.n-list-item'));
                const targetLi = currentItems.find(li => {
                    const a = li.querySelector('a[href*="/dp/"]');
                    return a && a.textContent.trim() === target.asin;
                });

                if (targetLi) {
                    const extraBtns = targetLi.querySelectorAll('.n-thing-header__extra button');
                    // 第二个按钮（索引 1）是“移至底部”按钮
                    if (extraBtns && extraBtns.length >= 2) {
                        extraBtns[1].click();
                        clickedSuccess = true;
                    }
                }
            }
            // 等待 Vue 完成 DOM 响应式更新
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (err) {
            console.error('[Novelia Sort] 触发内置移动按钮失败:', err);
        }

        // =========================================================================
        // 备用方案：如果网页内置按钮未触发重排，直接深入 Vue 3 Ref (_value / value) 原地修改数组
        // =========================================================================
        const afterItems = Array.from(blank.querySelectorAll('li.n-list-item'));
        const firstAsinAfter = afterItems[0]?.querySelector('a[href*="/dp/"]')?.textContent.trim();

        if (!clickedSuccess || firstAsinAfter !== targetOrder[0].asin) {
            try {
                let el = blank;
                let comp = null;
                while (el && el !== document.body) {
                    if (el.__vueParentComponent) {
                        comp = el.__vueParentComponent;
                        break;
                    }
                    el = el.parentElement;
                }

                // 查找分卷数组（专门放开对 .value 和 ._value 的访问）
                function findVolumeArray(obj, visited = new Set(), depth = 0) {
                    if (!obj || typeof obj !== 'object' || depth > 7 || visited.has(obj)) return null;
                    visited.add(obj);

                    if (Array.isArray(obj) && obj.length === items.length) {
                        const first = obj[0];
                        if (first && typeof first === 'object' && ('asin' in first || 'titleEs' in first || 'titleJp' in first || 'cover' in first)) {
                            return obj;
                        }
                    }

                    // 优先检查 Vue Ref 的 value
                    if ('value' in obj && obj.value) {
                        const res = findVolumeArray(obj.value, visited, depth + 1);
                        if (res) return res;
                    }
                    if ('_value' in obj && obj._value) {
                        const res = findVolumeArray(obj._value, visited, depth + 1);
                        if (res) return res;
                    }

                    for (const key of Object.keys(obj)) {
                        if (key === 'dep' || key === '__v_raw' || key.startsWith('$')) continue;
                        try {
                            const res = findVolumeArray(obj[key], visited, depth + 1);
                            if (res) return res;
                        } catch (e) {}
                    }
                    return null;
                }

                let cur = comp;
                let volArr = null;
                while (cur && !volArr) {
                    if (cur.setupState) volArr = findVolumeArray(cur.setupState);
                    if (!volArr && cur.ctx) volArr = findVolumeArray(cur.ctx);
                    if (!volArr && cur.data) volArr = findVolumeArray(cur.data);
                    cur = cur.parent;
                }

                if (volArr) {
                    const orderMap = new Map();
                    targetOrder.forEach((item, idx) => orderMap.set(item.asin, idx));
                    volArr.sort((a, b) => (orderMap.get(a.asin) ?? 9999) - (orderMap.get(b.asin) ?? 9999));
                    console.log('[Novelia Sort] 已通过 Vue Ref 数组完成排序');
                }
            } catch (e) {
                console.error('[Novelia Sort] Vue Ref 数组排序异常:', e);
            }
        }

        // 视觉反馈
        if (btnContent) {
            btnContent.textContent = '排序完成 ✓';
            setTimeout(() => {
                btnContent.textContent = '时间排序';
            }, 1500);
        }
    }

    // 查找并注入“时间排序”按钮
    function injectSortButton() {
        if (!location.pathname.startsWith('/wenku-edit')) return;
        if (document.getElementById('wenku-time-sort-btn')) return;

        const cols = document.querySelectorAll('div.n-col.n-col--24-span');
        let targetFeedbackWrapper = null;
        let volumeFormItem = null;

        cols.forEach(col => {
            const labelEl = col.querySelector('.n-form-item-label__text');
            if (!labelEl) return;
            const labelText = labelEl.textContent.trim();

            if (labelText === '标签') {
                targetFeedbackWrapper = col.querySelector('.n-form-item-feedback-wrapper');
            }
            if (labelText === '分卷') {
                volumeFormItem = col.querySelector('.n-form-item');
            }
        });

        if (!targetFeedbackWrapper || !volumeFormItem) return;

        targetFeedbackWrapper.style.display = 'flex';
        targetFeedbackWrapper.style.justifyContent = 'flex-end';
        targetFeedbackWrapper.style.alignItems = 'center';

        const existingPrimaryBtn = document.querySelector('#mega-format-btn') || document.querySelector('button.n-button--primary-type');
        const btnClass = existingPrimaryBtn
            ? existingPrimaryBtn.className
            : 'n-button n-button--primary-type n-button--medium-type';

        const sortBtn = document.createElement('button');
        sortBtn.id = 'wenku-time-sort-btn';
        sortBtn.type = 'button';
        sortBtn.className = btnClass;

        sortBtn.style.cssText = `
            height: 1.25em;
            line-height: 1.25;
            min-height: unset;
            padding: 0px 10px;
            font-size: 12px;
            background-color: var(--n-color, #63e2b7);
            color: #000000 !important;
            display: inline-flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
        `;

        const btnContent = document.createElement('span');
        btnContent.className = 'n-button__content';
        btnContent.textContent = '时间排序';
        btnContent.style.cssText = 'color: #000000 !important; text-align: center;';

        sortBtn.appendChild(btnContent);

        sortBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sortVolumes(volumeFormItem, btnContent);
        });

        targetFeedbackWrapper.appendChild(sortBtn);
    }

    const observer = new MutationObserver(() => {
        injectSortButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    injectSortButton();
})();
