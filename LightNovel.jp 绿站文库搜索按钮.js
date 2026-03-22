// ==UserScript==
// @name         LightNovel.jp搜索脚本
// @namespace    http://tampermonkey.net/
// @version      1.3
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
        // 正则解释：匹配 ( 或 （ 或 < 或 【 或 [ 开始，非闭合符号的内容，直到对应的闭合符号
        title = title.replace(/(\(|（|<|【|\[)[^)）>】\]]*?(\)|）|>|】|\])/g, '');

        // 2. 去除特定的卷号标识词：LV1, LV.2, ep.1, ep.02 (不区分大小写)
        title = title.replace(/\s*(LV|ep|sp)\.?\s*\d+/gi, '');

        // 3. 去除罗马数字：Ⅰ、Ⅱ...
        title = title.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+/g, '');

        // 4. 去除行尾的纯数字或类似 "02" 的编号 (需小心不要误删书名原本的数字，通常卷号前有空格)
        title = title.replace(/\s+\d{1,3}$/, '');

        // 5. 再次清理可能残留的卷号文字，如 "1", "02" 等单独出现的
        // 如果前面处理完了，这里主要处理行尾残留
        title = title.replace(/\s+0*\d+\s*$/, '');

        // 6. 去除尾部可能残留的标点符号
        title = title.replace(/[.,:;!?。，、！？\s]+$/, '');

        // 7. 去除末尾紧连的数字 (针对卷号和书名连在一起的情况)
        title = title.replace(/\d+$/, '');

        // 8. 去除带圈数字：①、②...
        title = title.replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+/g, '');

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
