// ==UserScript==
// @name         LightNovel.jp 绿站文库搜索按钮
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  在LightNovel.jp的书籍标题后增加去噪后的Novelia搜索按钮
// @author       Gemini
// @match        https://lightnovel.jp/publicationdate/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置样式 ---
    GM_addStyle(`
        .custom-search-btn {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 8px;
            background-color: #FAEF8B;
            color: white;
            border-radius: 4px;
            text-decoration: none;
            font-size: 12px;
            cursor: pointer;
            border: none;
            transition: background 0.2s;
        }
        .custom-search-btn:hover {
            background-color: #63E2B7;
            color: white;
            text-decoration: none;
        }
    `);

    // --- 功能: 标题去噪与搜索按钮 ---

    // 核心清洗函数：去除卷号、括号、特殊字符
    function cleanTitleText(text) {
        let title = text;

        // 1. 去除全角/半角括号及其内容：(上), (1), <中>, 【下】, （02）
        title = title.replace(/(\(|（|<|【|\[)[^)）>】\]]*?(\)|）|>|】|\])/g, '');

        // 2. 提前去除尾部可能残留的标点符号和空格
        // (极重要：防止类似 "Title iv." 结尾的句号阻挡末尾罗马数字的正则匹配)
        title = title.replace(/[.,:;!?。，、！？\s\-・]+$/, '');

        // 3. 去除特定的卷号标识词及其后面的内容 (新增对 vol.ii, ep.iv 这种带罗马数字组合的支持)
        // 提取罗马字母匹配池供组合使用
        const romanPattern = "(?:(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3})?|(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3}))";
        const volumeRegex = new RegExp(`\\s*(?:LV|ep|sp|ex|extra|NO.|vol|volume)\\.?\\s*(?:\\d+|${romanPattern})`, 'gi');
        title = title.replace(volumeRegex, '');

        // 4. 去除 Unicode 专用罗马数字字符 (Ⅰ, Ⅱ, ⅰ, ⅱ...) 以及 日文常见的带圈数字 (①, ②, ㉑...)
        // \u2160-\u217F 覆盖大写和小写 Unicode 罗马数字
        // \u2460-\u2473, \u3251-\u325F, \u32B1-\u32BF 覆盖 1 到 50 的带圈数字
        title = title.replace(/[\u2160-\u217F\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]+/g, '');

        // 5. 去除由普通英文字母拼写的罗马数字卷号 (支持 1-99，包含 x, i, v 等所有小写情况)
        const romanTens = "(?:[XＸxｘ][CＣcｃ]|[XＸxｘ][LＬlｌ]|[LＬlｌ][XＸxｘ]{0,3}|[XＸxｘ]{1,3})";
        const romanUnits = "(?:[IＩiｉ][XＸxｘ]|[IＩiｉ][VＶvｖ]|[VＶvｖ][IＩiｉ]{0,3}|[IＩiｉ]{1,3})";

        // 匹配锚定在末尾的罗马数字
        const romanRegex = new RegExp(`(?:${romanTens}(?:${romanUnits})?|${romanUnits})$`);

        title = title.replace(romanRegex, (match, offset, string) => {
            if (offset === 0) return '';
            const prevChar = string.charAt(offset - 1);
            // 防误删机制：如果罗马数字前面紧挨着普通英文字母，当作英文单词保留 (如 Matrix 保留 ix)。
            // 如果前面是中日文或空格，安全删除。
            if (/[a-zA-Zａ-ｚＡ-Ｚ]/.test(prevChar)) {
                return match;
            }
            return '';
        });

        // 6. 去除行尾的纯数字卷号 (带空格情况)
        title = title.replace(/\s+\d{1,3}$/, '');
        title = title.replace(/\s+0*\d+\s*$/, '');

        // 7. 去除末尾紧连的数字 (如 Overlord16)
        title = title.replace(/(\D+)\d+$/, '$1');

        // 8. 再次清理彻底暴露的尾部标点
        title = title.replace(/[.,:;!?。，、！？\s\-・]+$/, '');

        return title.trim();
    }

    function addSearchButtons() {
        const titleCells = document.querySelectorAll('td.title');

        titleCells.forEach(td => {
            // 避免重复添加
            if (td.querySelector('.custom-search-btn')) return;

            // 获取原始文本 (不包含子元素的文本，防止获取到已经存在的标签)
            // 这里直接取innerText通常包含子元素，所以要小心，我们只取第一部分文本节点通常更安全
            // 考虑到td.title里可能包含其他的标签(虽然目前只看到文本)，为了准确获取书名，优先取第一个文本节点
            let rawTitle = "";
            if (td.childNodes.length > 0 && td.childNodes[0].nodeType === 3) { // Node.TEXT_NODE
                 rawTitle = td.childNodes[0].nodeValue.trim();
            } else {
                 // 回退方案：获取所有文本但排除我们自己添加的按钮文本
                 // 由于我们先获取文本再添加按钮，直接用innerText即可
                 rawTitle = td.innerText.replace("🔍 Novelia", "").trim();
            }

            const cleanName = cleanTitleText(rawTitle);

            // 创建搜索链接
            const searchUrl = `https://n.novelia.cc/wenku?page=1&query=${encodeURIComponent(cleanName)}&selected=0`;

            // 创建按钮元素
            const btn = document.createElement('a');
            btn.href = searchUrl;
            btn.className = 'custom-search-btn';
            btn.innerText = '🔍 Novelia';
            btn.target = '_blank'; // 新标签页打开
            btn.title = `搜索: ${cleanName}`; // 鼠标悬停显示处理后的标题

            // 将按钮添加到标题后面
            td.appendChild(btn);
        });
    }

    // --- 执行主逻辑 ---
    function main() {
        addSearchButtons();
    }

    // 页面加载后执行
    main();

    // 如果网站使用AJAX动态加载（翻页等），可能需要监听变化
    // 这里添加一个简单的MutationObserver来应对动态内容
    const observer = new MutationObserver((mutations) => {
        let shouldRun = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                shouldRun = true;
            }
        });
        if (shouldRun) {
            main();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
