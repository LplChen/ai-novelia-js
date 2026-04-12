// ==UserScript==
// @name         Novelia 文库简介自动排版按钮
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  完美适配 Naive UI 的自动排版脚本，原生级 UI 融合，解决无法触发双向绑定的问题。
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

            // 规则 A：后引号接前引号 (如：” “)
            for (let i = 0; i < 70; i++) {
                if (rightQuotes.test(chunk[i]) && leftQuotes.test(chunk[i+1])) {
                    breakIdx = i;
                    break;
                }
            }

            // 规则 B：寻找71字内最后一个分界标点
            if (breakIdx === -1) {
                for (let i = 70; i >= 0; i--) {
                    if (breakMarks.test(chunk[i])) {
                        breakIdx = i;
                        break;
                    }
                    if ((chunk[i] === '—' || chunk[i] === '…') && chunk[i-1] === chunk[i]) {
                        breakIdx = i;
                        break;
                    }
                }
            }

            if (breakIdx !== -1) {
                result += remaining.substring(0, breakIdx + 1) + '\n';
                remaining = remaining.substring(breakIdx + 1);
            } else {
                // 规则 C：如果71字内没标点，向后寻找第一个分界符
                let found = false;
                for (let i = 71; i < remaining.length; i++) {
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
        // 首选：通过模拟系统原生的文本插入来触发完整的数据流 (最可靠)
        const success = document.execCommand('insertText', false, newText);

        // 备选：如果浏览器拦截了 execCommand，走底层 setter
        if (!success) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            nativeInputValueSetter.call(textarea, newText);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 滚动回顶部
        textarea.setSelectionRange(0, 0);
        textarea.blur();
    }

    // 注入按钮 UI
    function injectUI() {
        const textarea = document.querySelector('.n-input__textarea-el[placeholder*="小说简介"]');
        if (!textarea) return;

        // 寻找包含这个 textarea 的上一级 form-item，进而找到属于它的 feedback-wrapper
        const formItem = textarea.closest('.n-form-item');
        if (!formItem) return;

        const feedbackWrapper = formItem.querySelector('.n-form-item-feedback-wrapper');
        if (!feedbackWrapper || feedbackWrapper.querySelector('.custom-format-btn')) return;

        // 调整 Wrapper 布局，使其靠右
        feedbackWrapper.style.display = 'flex';
        feedbackWrapper.style.justifyContent = 'flex-end';
        feedbackWrapper.style.paddingTop = '4px';

        // 创建按钮
        const formatBtn = document.createElement('button');
        formatBtn.className = 'custom-format-btn'; // 打上标记防止重复注入

        // 【核心】窃取网站原有的“次级按钮”样式，完美实现主题随动
        const referenceButton = document.querySelector('.n-button--secondary');
        if (referenceButton) {
            // 复制全部类名（包含了框架动态生成的 Hash 主题类名，如 __button-dark-...）
            formatBtn.className += ' ' + referenceButton.className;
            // 将按钮尺寸强行修改为小号，更精致
            formatBtn.classList.remove('n-button--medium-type', 'n-button--large-type');
            formatBtn.classList.add('n-button--small-type');
        } else {
            // 兜底原生类名
            formatBtn.className += ' n-button n-button--default-type n-button--small-type n-button--secondary';
        }

        // 去除继承自 referenceButton 的默认 tabindex 行为
        formatBtn.setAttribute('tabindex', '0');
        formatBtn.setAttribute('type', 'button');

        // 按钮内容结构（匹配 Naive UI 内部结构）
        formatBtn.innerHTML = `
            <span class="n-button__content">✨ 自动排版</span>
            <div aria-hidden="true" class="n-base-wave"></div>
            <div aria-hidden="true" class="n-button__border"></div>
            <div aria-hidden="true" class="n-button__state-border"></div>
        `;

        // 绑定点击事件
        formatBtn.addEventListener('click', (e) => {
            e.preventDefault(); // 阻止按钮可能的触发表单提交
            const currentText = textarea.value;
            if (!currentText.trim()) return;

            const formattedText = autoFormatSynopsis(currentText);
            triggerVueUpdate(textarea, formattedText);
        });

        // 将按钮追加到 feedback-wrapper 最右侧
        feedbackWrapper.appendChild(formatBtn);
    }

    // 使用 setInterval 替代 MutationObserver，在 SPA 路由切换时更稳定，且性能消耗更低
    setInterval(injectUI, 1000);

})();
