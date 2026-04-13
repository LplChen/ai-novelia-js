// ==UserScript==
// @name       Novelia 文库简介自动排版按钮
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  完美适配 Naive UI，限制按钮高度为line-height:1.25，新增 ● 作为前置换行符。
// @author       Gemini
// @match        *://n.novelia.cc/wenku-edit/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 核心排版逻辑
    function autoFormatSynopsis(rawText) {
        // 1. 删掉所有的空格(全角&半角)和空行
        let cleanedText = rawText.replace(/[ \u3000\t\r\n]+/g, '');

        // 2. 超过500字限制判断
        if (cleanedText.length > 500) {
            alert(`⚠️ 提示：去除空行后字数仍高达 ${cleanedText.length} 字（超出500字上限）。\n\n为防止内容被强制截断丢失，本次仅执行“去空”操作，不进行分段排版。请手动删减后再试。`);
            return cleanedText;
        }

        // 定义标点符号正则 (支持中英文)
        const breakMarks = /[。！？\?\;；：:’”》）\]\}]/;
        const leftQuotes = /[“‘《（\[\{]/;
        const rightQuotes = /[’”》）\]\}]/;

        let result = "";
        let remaining = cleanedText;

        while (remaining.length > 0) {
            if (remaining.length <= 71) {
                result += remaining;
                break;
            }

            let chunk = remaining.substring(0, 71);
            let breakIdx = -1;
            let breakOffset = 1; // 默认：在标点之后换行，保留标点在当前行

            // 规则 A：后引号接前引号 (如：” “)
            for (let i = 0; i < 70; i++) {
                if (rightQuotes.test(chunk[i]) && leftQuotes.test(chunk[i+1])) {
                    breakIdx = i;
                    breakOffset = 1;
                    break;
                }
            }

            // 规则 B：寻找71字内最后一个分界标点 或 ●
            if (breakIdx === -1) {
                // 注意：i > 0，防止刚到句首就碰到 ● 导致死循环（不在第0个字符前换行）
                for (let i = 70; i > 0; i--) {
                    if (chunk[i] === '●') {
                        breakIdx = i;
                        breakOffset = 0; // 【核心新增】● 的特殊处理：在它之前换行，使其进入下一行
                        break;
                    }
                    if (breakMarks.test(chunk[i])) {
                        breakIdx = i;
                        breakOffset = 1; // 常规标点：在它之后换行
                        break;
                    }
                    // 破折号或省略号 (— 或 …)
                    if ((chunk[i] === '—' || chunk[i] === '…') && chunk[i-1] === chunk[i]) {
                        breakIdx = i;
                        breakOffset = 1;
                        break;
                    }
                }
            }

            if (breakIdx !== -1) {
                result += remaining.substring(0, breakIdx + breakOffset) + '\n';
                remaining = remaining.substring(breakIdx + breakOffset);
            } else {
                // 规则 C：如果71字内没有任何分界符，向后寻找第一个分界符
                let found = false;
                for (let i = 71; i < remaining.length; i++) {
                    if (remaining[i] === '●') {
                        result += remaining.substring(0, i) + '\n';
                        remaining = remaining.substring(i);
                        found = true; break;
                    }
                    if (rightQuotes.test(remaining[i]) && i + 1 < remaining.length && leftQuotes.test(remaining[i+1])) {
                        result += remaining.substring(0, i + 1) + '\n';
                        remaining = remaining.substring(i + 1);
                        found = true; break;
                    }
                    if (breakMarks.test(remaining[i])) {
                        result += remaining.substring(0, i + 1) + '\n';
                        remaining = remaining.substring(i + 1);
                        found = true; break;
                    }
                    if ((remaining[i] === '—' || remaining[i] === '…') && remaining[i+1] === remaining[i]) {
                        result += remaining.substring(0, i + 2) + '\n';
                        remaining = remaining.substring(i + 2);
                        found = true; break;
                    }
                }

                if (!found) {
                    result += remaining;
                    break;
                }
            }
        }

        return result;
    }

    // 暴力突破 Vue 3 双向绑定的赋值方案
    function triggerVueUpdate(textarea, newText) {
        textarea.focus();
        textarea.select();
        const success = document.execCommand('insertText', false, newText);

        if (!success) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            nativeInputValueSetter.call(textarea, newText);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        textarea.setSelectionRange(0, 0);
        textarea.blur();
    }

    // 注入按钮 UI
    function injectUI() {
        const textarea = document.querySelector('.n-input__textarea-el[placeholder*="小说简介"]');
        if (!textarea) return;

        // 【更新】：精准寻找 class="n-form-item-blank"
        const formItemBlank = textarea.closest('.n-form-item-blank');
        if (!formItemBlank) return;

        // 【更新】：寻找它紧挨着的下一个元素 class="n-form-item-feedback-wrapper"
        const feedbackWrapper = formItemBlank.nextElementSibling;
        if (!feedbackWrapper || !feedbackWrapper.classList.contains('n-form-item-feedback-wrapper')) return;

        if (feedbackWrapper.querySelector('.custom-format-btn')) return;

        // 让 wrapper 变成 flex 容器，把按钮推到最右边
        feedbackWrapper.style.display = 'flex';
        feedbackWrapper.style.justifyContent = 'flex-end';

        // 创建按钮
        const formatBtn = document.createElement('button');
        formatBtn.className = 'custom-format-btn';

        // 窃取网站原有的“次级按钮”主题（适配亮/暗色）
        const referenceButton = document.querySelector('.n-button--secondary');
        if (referenceButton) {
            formatBtn.className += ' ' + referenceButton.className;
            // 剔除可能影响高度的原生大小类名
            formatBtn.classList.remove('n-button--medium-type', 'n-button--large-type', 'n-button--small-type');
        } else {
            formatBtn.className += ' n-button n-button--default-type n-button--secondary';
        }

        formatBtn.setAttribute('tabindex', '0');
        formatBtn.setAttribute('type', 'button');

        // 【核心样式更新】：强制接管高度，保持原始 line-height: 1.25 不撑破容器
        formatBtn.style.cssText = `
            line-height: 1.25 !important;
            height: auto !important;
            min-height: 0 !important;
            padding: 0px 8px !important;
            font-size: 13px !important;
            margin-left: auto !important;
            align-self: flex-start;
        `;

        formatBtn.innerHTML = `
            <span class="n-button__content">✨ 自动排版</span>
            <div aria-hidden="true" class="n-base-wave"></div>
            <div aria-hidden="true" class="n-button__border"></div>
            <div aria-hidden="true" class="n-button__state-border"></div>
        `;

        formatBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentText = textarea.value;
            if (!currentText.trim()) return;

            const formattedText = autoFormatSynopsis(currentText);
            triggerVueUpdate(textarea, formattedText);
        });

        // 插入到 n-form-item-feedback-wrapper 内部
        feedbackWrapper.appendChild(formatBtn);
    }

    setInterval(injectUI, 1000);

})();
