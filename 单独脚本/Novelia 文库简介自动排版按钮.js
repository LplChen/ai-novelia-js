// ==UserScript==
// @name         Novelia 文库简介自动排版按钮
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动排版文库小说简介，去除空格空行，按71字加标点折行，智能匹配引号及特殊符号
// @author       Gemini
// @match        https://n.novelia.cc/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 核心排版逻辑
    function formatText(text) {
        // 1. 去除所有全角/半角空格和空行(换行符)
        let cleanText = text.替换(/[\s\u3000]+/g, '');

        // 2. 如果清理后字数依然超过500，终止排版，直接返回原文本
        if (cleanText.length > 500) return text;

        let lines = [];
        let p = 0;
        // 标点符号正则 (含中英文常见分界标点)
        const puncRegex = /[。\.！!？\?—\-；;：:”’」』》>）\)】\]}…]/;

        while (p < cleanText.length) {
            let maxLookahead = p + 71;
            let absoluteBreak = -1;

            // 规则优先：寻找强制换行点（后引号接前引号，或遇到 ●）
            for (let k = p; k < Math.min(cleanText.length, maxLookahead); k++) {
                if ((cleanText[k] === '”' && cleanText[k+1] === '“') ||
                    (cleanText[k] === '」' && cleanText[k+1] === '「') ||
                    (cleanText[k] === '』' && cleanText[k+1] === '『')) {
                    absoluteBreak = k; // 在后引号处断开
                    break;
                }
                if (k > p && cleanText[k] === '●') {
                    absoluteBreak = k - 1; // 在 ● 之前断开，使其落入下一行
                    break;
                }
            }

            if (absoluteBreak !== -1) {
                lines.push(cleanText.substring(p, absoluteBreak + 1));
                p = absoluteBreak + 1;
                continue;
            }

            // 如果剩余字符本身就不超过71个字
            if (cleanText.length - p <= 71) {
                let remainingBreak = -1;
                for (let k = p; k < cleanText.length - 1; k++) {
                    if ((cleanText[k] === '”' && cleanText[k+1] === '“') ||
                        (cleanText[k] === '」' && cleanText[k+1] === '「') ||
                        (cleanText[k] === '』' && cleanText[k+1] === '『')) {
                        remainingBreak = k;
                        break;
                    }
                    if (k > p && cleanText[k] === '●') {
                        remainingBreak = k - 1;
                        break;
                    }
                }
                if (remainingBreak !== -1) {
                    lines.push(cleanText.substring(p, remainingBreak + 1));
                    p = remainingBreak + 1;
                } else {
                    lines.push(cleanText.substring(p));
                    p = cleanText.length;
                }
                continue;
            }

            // 超过71个字，往回找寻最近的一个标点符号作为分界
            let lastPunc = -1;
            for (let k = p + 70; k >= p; k--) {
                if (puncRegex.test(cleanText[k])) {
                    lastPunc = k;
                    break;
                }
            }

            if (lastPunc !== -1) {
                // 确保破折号 (——) 和 省略号 (……) 这类连续标点不被从中间切断
                while (lastPunc + 1 < cleanText.length && (cleanText[lastPunc + 1] === '—' || cleanText[lastPunc + 1] === '…')) {
                    lastPunc++;
                }
                lines.push(cleanText.substring(p, lastPunc + 1));
                p = lastPunc + 1;
            } else {
                // 如果前71个字内完全没有标点符号，则向后寻找“第一个”遇到的标点符号
                let nextPunc = -1;
                for (let k = p + 71; k < cleanText.length; k++) {
                    if (puncRegex.test(cleanText[k])) {
                        nextPunc = k;
                        while (nextPunc + 1 < cleanText.length && (cleanText[nextPunc + 1] === '—' || cleanText[nextPunc + 1] === '…')) {
                            nextPunc++;
                        }
                        break;
                    }
                    // 顺带检查是否有强制换行符
                    if (cleanText[k] === '●' && k > p) {
                        nextPunc = k - 1;
                        break;
                    }
                    if (k < cleanText.length - 1 && ((cleanText[k] === '”' && cleanText[k+1] === '“') ||
                        (cleanText[k] === '」' && cleanText[k+1] === '「') ||
                        (cleanText[k] === '』' && cleanText[k+1] === '『'))) {
                        nextPunc = k;
                        break;
                    }
                }

                if (nextPunc !== -1) {
                    lines.push(cleanText.substring(p, nextPunc + 1));
                    p = nextPunc + 1;
                } else {
                    // 全文一直到末尾都找不到标点
                    lines.push(cleanText.substring(p));
                    p = cleanText.length;
                }
            }
        }
        return lines.join('\n');
    }

    // 触发 Vue 的响应式数据更新
    function setNativeValue(textarea, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeInputValueSetter.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // 定位目标容器：<span class="n-form-item-label__text">分级</span> 的 feedback 区域
    function findPlacement() {
        const labels = document.querySelectorAll('span.n-form-item-label__text');
        for (let label of labels) {
            if (label.textContent.trim() === '分级') {
                const formItem = label.closest('.n-form-item');
                if (formItem) {
                    return formItem.querySelector('.n-form-item-feedback-wrapper');
                }
            }
        }
        return null;
    }

    // 定位小说简介输入框
    function getTextarea() {
        const labels = document.querySelectorAll('span.n-form-item-label__text');
        for (let label of labels) {
            if (label.textContent.trim() === '简介') {
                const formItem = label.closest('.n-form-item');
                if (formItem) {
                    return formItem.querySelector('textarea');
                }
            }
        }
        // 兜底方案
        return document.querySelector('textarea[placeholder="请输入小说简介"]');
    }

    // 注入按钮并挂载事件
    function injectButton(wrapper) {
        const btn = document.createElement('button');
        btn.id = 'auto-format-btn';

        // 提取 Primary（主要）按钮的样式
        const sampleBtn = document.querySelector('.n-button--primary-type');
        if (sampleBtn) {
            btn.className = sampleBtn.className;
        } else {
            // 兜底类名也改为 primary
            btn.className = 'n-button n-button--primary-type n-button--medium-type';
        }

        // 修改父容器布局，使按钮靠最右侧
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'flex-end';
        wrapper.style.alignItems = 'center';

        btn.innerHTML = '<span class="n-button__content">自动排版</span>';

        // 严格遵循所要求的行高限制，重置部分 Naive UI 默认属性
        btn.style.height = '1.25em';
        btn.style.lineHeight = '1.25';
        btn.style.minHeight = 'unset';
        btn.style.padding = '0 10px';
        btn.style.fontSize = '12px';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const textarea = getTextarea();
            if (!textarea) return;

            const newText = formatText(textarea.value);
            if (newText !== textarea.value) {
                setNativeValue(textarea, newText);
            }
        });

        wrapper.appendChild(btn);
    }

    function checkAndInject() {
        // 仅在 wenku-edit 路由下执行
        if (!location.href.includes('/wenku-edit/')) return;
        // 如果已经插入过，则不重复插入
        if (document.getElementById('auto-format-btn')) return;

        const wrapper = findPlacement();
        if (wrapper) {
            injectButton(wrapper);
        }
    }

    // 应对单页面应用 (SPA) 跳转导致的加载延迟
    const observer = new MutationObserver(() => {
        checkAndInject();
    });

    // 监听整个 Body 的 DOM 变动
    observer.observe(document.body, { childList: true, subtree: true });

    // 初始化执行一次
    checkAndInject();

})();
