/* =========================================================
   中山韵典在线 · 交互逻辑（完整修复版）
   依赖：js/database.js
   ========================================================= */

(function () {
    'use strict';

    const dialectDatabase = window.parseDialectDatabase(window.DIALECT_DATABASE_TEXT || '');

    /* ---- 为生僻字动态注入 SiteRare 的 @font-face ---- */
    function injectRareFontFace() {
        const chars = window.RARE_CHARS || [];
        if (!chars.length) return;

        const ranges = chars
            .filter((ch) => typeof ch === 'string' && ch)
            .map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase())
            .join(', ');

        if (!ranges) return;

        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-family: "SiteRare";
                src: local("TH-Tshyn-P1"),
                     url("font/TH-Tshyn-P1.ttf") format("truetype"),
                     url("https://fonts4speak-1509099110.cos.ap-beijing.myqcloud.com/TH-Tshyn-P1.ttf") format("truetype");
                unicode-range: ${ranges};
                font-display: block;
            }
        `;
        document.head.appendChild(style);
    }
    injectRareFontFace();

    /* ---------------- DOM ---------------- */
    const searchInput      = document.getElementById('searchInput');
    const searchBtn        = document.getElementById('searchBtn');
    const resultsContainer = document.getElementById('resultsContainer');
    const searchModeSelect = document.getElementById('searchMode');
    const modeDescription  = document.getElementById('modeDescription');
    const luckyWord        = document.getElementById('luckyWord');

    const grammarModal     = document.getElementById('grammarModal');
    const modalConfirm     = document.getElementById('modalConfirm');
    const modalCancel      = document.getElementById('modalCancel');

    const inputAlertModal  = document.getElementById('inputAlertModal');
    const inputAlertMessage= document.getElementById('inputAlertMessage');
    const inputAlertConfirm= document.getElementById('inputAlertConfirm');

    const page404          = document.getElementById('page404');
    const navHome          = document.getElementById('nav-home');
    const navGrammar       = document.getElementById('nav-grammar');
    const navAbout         = document.getElementById('nav-about');

    const PAGE_HOME  = document.getElementById('home-page');
    const PAGE_ABOUT = document.getElementById('about-page');

    const PDF_LINK = 'https://pay.donline.top/';

    let currentSearchQuery = '';
    let currentSearchMode  = 'default';

    /* =========================================================
       工具函数
       ========================================================= */
    function isSyllableMatch(pSyl, query) {
        let p = pSyl.toLowerCase();
        let q = query.toLowerCase();

        // 只要用户没打声调，就视同没打，走模糊匹配
        const isStrict = /[āáǎàēéěèêūúǔùōóǒòīíǐìǖǘǚǜ\u0300-\u036F]/.test(q);

        if (isStrict) {
            // 带有声调，必须精确匹配
            if (p === q || canonicalTonePinyin(p) === canonicalTonePinyin(q)) {
                if (q.includes('ê') && !p.includes('ê') && !p.includes('e\u0302')) return false;
                return true;
            }
            if (q === 'ê') {
                return p.normalize('NFD').startsWith('e\u0302');
            }
            return false;
        } else {
            // 没带声调：把 a 和 ɑ 统一，g 和 ɡ 统一，再去掉所有声调对比
            const strip = (str) => {
                return str.normalize('NFD').replace(/[\u0300-\u036F]/g, '')
                          .replace(/ɑ/g, 'a')
                          .replace(/ɡ/g, 'g')
                          .replace(/ŋ/g, 'ng')
                          .replace(/ê/g, 'e');
            };
            let pBase = strip(p);
            let qBase = strip(q);

            if (pBase === qBase) return true;
            if (pBase.replace(/r$/, '') === qBase) return true; // 儿化容错
            return false;
        }
    }
   
    function matchPinyinString(pinyinRaw, query) {
        if (!pinyinRaw) return false;
        const p = pinyinRaw.toLowerCase().trim();
        const q = query.toLowerCase().trim();

        if (q.includes(' ')) {
            const pSyls = p.split(/\s+/);
            const qSyls = q.split(/\s+/);
            for (let i = 0; i <= pSyls.length - qSyls.length; i++) {
                let match = true;
                for (let j = 0; j < qSyls.length; j++) {
                    if (!isSyllableMatch(pSyls[i + j], qSyls[j])) {
                        match = false;
                        break;
                    }
                }
                if (match) return true;
            }
            return false;
        } else {
            const pSyls = p.split(/\s+/);
            return pSyls.some(syl => isSyllableMatch(syl, q));
        }
    }

    function applyGlobalImages() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (node.parentElement.tagName.match(/^(SCRIPT|STYLE|TEXTAREA|TITLE)$/i)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) {
            if (walker.currentNode.nodeValue.includes('IMG:')) {
                nodes.push(walker.currentNode);
            }
        }
        nodes.forEach(node => {
            const text = node.nodeValue;
            const span = document.createElement('span');
            span.innerHTML = text.replace(/IMG:(\w+)/g, '<img src="images/$1.png" alt="图片" class="inline-img-char">');
            node.parentNode.replaceChild(span, node);
        });
    }

    function processErhua(text) {
        if (!text) return text;
        return text.replace(/儿'/g, '<span class="erhua-char">儿</span>');
    }

    function replaceImageMarkers(text, isTitle) {
        if (!text) return text;
        const cls = isTitle ? 'character-img' : 'inline-img-char';
        return text.replace(/IMG:(\w+)/g,
            (m, name) => `<img src="images/${name}.png" alt="图片" class="${cls}">`);
    }

    function processTextWithImages(text, isTitle) {
        if (!text) return text;
        return processErhua(replaceImageMarkers(text, isTitle));
    }

    function removeTones(pinyin) {
        if (!pinyin) return '';
        return pinyin
            .replace(/[āáǎàɑ]/g, 'a')
            .replace(/[ēéěèê]/g, 'e')
            .replace(/[īíǐì]/g, 'i')
            .replace(/[ōóǒò]/g, 'o')
            .replace(/[ūúǔù]/g, 'u')
            .replace(/[ǖǘǚǜü]/g, 'v')
            .replace(/[g]/g, 'ɡ')
            .replace(/[\u0300-\u036F]/g, '');
    }

    function canonicalTonePinyin(str) {
        if (!str) return '';
        let s = str.toLowerCase().normalize('NFD');
        s = s.replace(/u\u0308/g, 'v')
             .replace(/\u0251/g, 'a')
             .replace(/\u014b/g, 'ng');
        return s.replace(/[\u0300-\u036F]+/g, (m) => {
            if (m.includes('\u0304')) return '1';
            if (m.includes('\u0301')) return '2';
            if (m.includes('\u030C')) return '3';
            if (m.includes('\u0300')) return '4';
            if (m.includes('\u0309')) return '5';
            return '';
        });
    }

    function hasToneMark(str) {
        return /[āáǎàēéěèêūúǔùōóǒòīíǐìǖǘǚǜ\u0300-\u036F]/.test(str || '');
    }

    function getPlainText(text) {
        if (!text) return '';
        let s = text.replace(/儿'/g, '儿').replace(/IMG:\w+/g, '[字]');
        return s.replace(/<[^>]*>/g, '');
    }

      /* =========================================================
       智能高亮：支持拼音模糊高亮、汉字跨标点/儿化高亮、繁简互通
       ========================================================= */
    function buildPinyinRegex(query) {
        let rawChars = query.normalize('NFD')
                            .replace(/[\u0300-\u036F]/g, '')
                            .replace(/ɑ/g, 'a')
                            .replace(/ɡ/g, 'g')
                            .replace(/ŋ/g, 'ng')
                            .split('');
        
        // 【核心修改】把所有预组合的带调字母（āáǎàēéěè等）全部强行包含进去
        const map = {
            'a': '[aɑāáǎà](?:[\\u0300-\\u036F]*)',
            'e': '[eēéěèê](?:[\\u0300-\\u036F]*)',
            'i': '[iīíǐì](?:[\\u0300-\\u036F]*)',
            'o': '[oōóǒò](?:[\\u0300-\\u036F]*)',
            'u': '[uūúǔù](?:[\\u0300-\\u036F]*)',
            'v': '[vüǖǘǚǜ](?:[\\u0300-\\u036F]*)',
            'ü': '[vüǖǘǚǜ](?:[\\u0300-\\u036F]*)'
        };
        
        let regexParts = [];
        for (let i = 0; i < rawChars.length; i++) {
            let char = rawChars[i];
            
            if (char === 'n' && rawChars[i+1] === 'g') {
                // 处理 ng 匹配 ŋ 的情况，并且允许带声调
                regexParts.push('(?:n(?:[\\u0300-\\u036F]*)[gɡ]|ŋ(?:[\\u0300-\\u036F]*))');
                i++; // 跳过 g
            } else if (map[char]) {
                regexParts.push(map[char]);
            } else if (char === 'g') {
                regexParts.push('[gɡ](?:[\\u0300-\\u036F]*)');
            } else if (char === ' ') {
                regexParts.push('\\s*');
            } else {
                regexParts.push(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            }
        }
        
        return new RegExp(`(${regexParts.join('')})`, 'gi');
    }
   
         function buildChineseRegex(query) {
        // 提取纯汉字和字母（绝对不删掉“儿”）
        let cleanQuery = query.replace(/[^\p{Script=Han}a-zA-Z]/gu, '');
        if (!cleanQuery) return null;

        let parts = [];
        for (let char of cleanQuery) {
            let jiantiChar = toSimplified(char); 
            let charsToMatch = Array.from(new Set([jiantiChar, char])).join('');
            let charClass = charsToMatch.length > 1 ? `[${charsToMatch}]` : charsToMatch;
            parts.push(charClass);
        }
        
        // 允许中间、开头、结尾出现标点、空格或单引号
        let joinStr = `[，,。.！!？?；;：:、\\s']*`;
        // 关键：首尾也都加上 joinStr，把“巴儿'巴儿'”最后的单引号也吃进高亮框里
        let regexStr = joinStr + parts.join(joinStr) + joinStr;
        return new RegExp(`(${regexStr})`, 'g');
    }

    // 新的高亮函数
    function highlightText(text, query, isTitle) {
        if (!text) return '';
        // 先替换图片，避免正则误伤 HTML 标签
        const processed = replaceImageMarkers(text, isTitle); 
        if (!query) return processErhua(processed);

        let regex = null;
        if (isPinyinQuery(query)) {
            regex = buildPinyinRegex(query);
        } else {
            regex = buildChineseRegex(query);
        }

        if (!regex) return processErhua(processed);

        const temp = document.createElement('div');
        temp.innerHTML = processed;

        const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach((node) => {
            const t = node.nodeValue;
            if (!t) return;
            const newHtml = t.replace(regex, (match) => `<span class="highlight">${match}</span>`);
            if (newHtml !== t) {
                const span = document.createElement('span');
                span.innerHTML = newHtml;
                node.parentNode.replaceChild(span, node);
            }
        });

        // 高亮完成后，统一处理儿化小字
        return processErhua(temp.innerHTML);
    }

    function containsInvalidChars(str) {
        if (!str) return false;
      const valid = /^[\p{Script=Han}a-zA-Z\sɑāáǎàēéěèêūúǔùōóǒòīíǐìǖǘǚǜüŋɡ\u0300-\u036F]*$/u;
        return !valid.test(str);
    }

    function showInputAlert(message) {
        inputAlertMessage.textContent = message;
        inputAlertModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function hideInputAlert() {
        inputAlertModal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }

    function isAllChinese(str) {
        return /^[\p{Script=Han}]+$/u.test(str);
    }

    function isSingleLetter(str) {
        return /^[a-zA-Z]$/.test(str);
    }

    function isPinyinQuery(query) {
        if (/[\p{Script=Han}]/u.test(query)) return false;
        if (query.includes(' ')) return true;
     return /[a-zA-Zɑāáǎàēéěèêōóǒòīíǐìūúǔùǖǘǚǜüŋɡ\u0300-\u036F]/.test(query);
    }

    function isVocabQuery(query) {
        const han = query.match(/[\p{Script=Han}]/gu);
        if (han && han.length >= 2) return true;
        return query.includes(' ');
    }

    function getCharacterText(item) {
        if (typeof item.character === 'string') {
            return item.character.replace(/儿'/g, '儿').replace(/IMG:\w+/g, '[字]');
        }
        return '';
    }

    function isSpecialEntry(item) {
        const t = getCharacterText(item);
        return t === '凡例' || t === '特殊标注含义说明';
    }

    function allowsSpecialEntry(item, query) {
        const t = getCharacterText(item);
        if (t === '凡例') return query === '凡例';
        if (t === '特殊标注含义说明') {
            return query === '特殊标注含义说明' || query === '特殊标注';
        }
        return true;
    }

    function countChineseMatches(item, query) {
        let count = 0;
        const scan = (s) => {
            if (!s) return;
            const t = getPlainText(s);
            let i = 0;
            while ((i = t.indexOf(query, i)) !== -1) { count++; i += query.length; }
        };
        scan(getCharacterText(item));
        for (const py of item.pinyins) {
            (py.meanings || []).forEach((m) => {
                scan(m.text);
                (m.examples || []).forEach((ex) => {
                    scan(ex.dialect);
                    scan(ex.translation);
                });
            });
            (py.entries || []).forEach((e) => {
                scan(e.title);
                scan(e.definition);
                (e.examples || []).forEach((ex) => {
                    scan(ex.dialect);
                    scan(ex.translation);
                });
            });
        }
        return count;
    }

    function hasPinyinExactlyLetter(item, letter) {
        const l = letter.toLowerCase();
        return item.pinyins.some((py) => removeTones(py.pinyin.trim().toLowerCase()) === l);
    }

    function removeErhuaFromText(str) {
        return str.replace(/儿'/g, '').replace(/儿/g, '');
    }

    // 初始化 OpenCC 转换器
    let t2sConverter = null;
    if (typeof OpenCC !== 'undefined' && OpenCC.Converter) {
        t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });
    }

    function toSimplified(str) {
        if (!str) return '';
        if (t2sConverter) {
            // 逐字转换，绝对不进行词汇级别的替换
            return Array.from(str).map(char => t2sConverter(char)).join('');
        }
        return str;
    }

        function getPinyinMatchLevel(item, query) {
        const q = query.toLowerCase().trim();
        const qHasTone = hasToneMark(query);
        
        const check = (pinyinRaw) => {
            if (!pinyinRaw) return 3;
            const p = pinyinRaw.toLowerCase().trim();
            
            // 【最核心】如果用户输入的和字典原文一模一样，或者带调视同，无脑排第一！
            if (p === q || canonicalTonePinyin(p) === canonicalTonePinyin(q)) return 0;
            
            if (q.includes(' ')) {
                return matchPinyinString(p, q) ? 0 : 3;
            } else {
                // 把字典的音节拆开，抹平 a/ɑ、g/ɡ 的区别
                const pSyls = p.split(/\s+/).map(syl => 
                    syl.replace(/ɑ/g, 'a').replace(/ɡ/g, 'g').replace(/ŋ/g, 'ng')
                );
                const qNorm = q.replace(/ɑ/g, 'a').replace(/ɡ/g, 'g').replace(/ŋ/g, 'ng');
                
                // 如果抹平后，存在某个音节和用户输入完全一样，排第一
                if (pSyls.some(syl => {
                    if (syl === qNorm) return true;
                    if (!qHasTone && removeTones(syl) === removeTones(qNorm)) return true;
                    return false;
                })) {
                    return 0;
                }
                // 如果只是模糊匹配上了（比如带不带调的区别），排第二
                if (pSyls.some(syl => isSyllableMatch(syl, q))) {
                    return 1;
                }
            }
            return 3;
        };

        let level = 3;
        for (const py of item.pinyins) {
            level = Math.min(level, check(py.pinyin));
            for (const e of (py.entries || [])) {
                level = Math.min(level, check(e.entryPinyin));
            }
        }
        return level === 3 ? 2 : level;
    }
   
    /* =========================================================
       匹配逻辑
       ========================================================= */
    function matchesSearchDefault(item, query) {
        if (!query) return false;
        if (!allowsSpecialEntry(item, query)) return false;

        const q = query.toLowerCase();
        const qHasTone = hasToneMark(query);
        const queryS = toSimplified(query);

        if (isAllChinese(query) && [...query].length === 1) {
            return typeof item.character === 'string' &&
                   toSimplified(getCharacterText(item)).includes(queryS);
        }

        if (typeof item.character === 'string') {
            if (toSimplified(getCharacterText(item)).includes(queryS)) return true;
        } else if (item.character.type === 'img') {
            if (query === 'IMG:' + item.character.src || query === item.character.src) return true;
        }

        const pinyinMatch = (raw) => matchPinyinString(raw, query);

        for (const py of item.pinyins) {
            if (pinyinMatch(py.pinyin)) return true;

            for (const e of (py.entries || [])) {
                if (pinyinMatch(e.entryPinyin)) return true;

                if (e.title) {
                    // 把数据库的“儿'”统一换成“儿”，方便用户不打单引号也能搜到
                    const title = e.title.replace(/儿'/g, '儿').replace(/IMG:\w+/g, '[字]');
                    const titleS = toSimplified(title);
                    const queryS = toSimplified(query);
                    
                    // 1. 精确包含匹配（搜“儿子”就只匹配“儿子”）
                    if (titleS.includes(queryS)) return true;
                    
                    // 2. 剔除标点后的匹配
                    const cleanTitle = titleS.replace(/[^\p{Script=Han}a-zA-Z]/gu, '').toLowerCase();
                    const cleanQuery = queryS.replace(/[^\p{Script=Han}a-zA-Z]/gu, '').toLowerCase();
                    if (cleanQuery && cleanTitle.includes(cleanQuery)) return true;
                }
            }
        }
        return false;
    }

    function matchesSearchReverse(item, query) {
        if (!query) return false;
        if (!allowsSpecialEntry(item, query)) return false;
        if (matchesSearchDefault(item, query)) return true;

        const q = query.toLowerCase();
        const qHasTone = hasToneMark(query);

        const textMatch = (s) => {
            if (!s) return false;
            const t = toSimplified(getPlainText(s));
            const qS = toSimplified(query);
            if (t.includes(qS)) return true;
            if (!qHasTone && removeTones(t.toLowerCase()).includes(removeTones(qS.toLowerCase()))) return true;
            return false;
        };

        for (const py of item.pinyins) {
            for (const m of (py.meanings || [])) {
                if (textMatch(m.text)) return true;
                for (const ex of (m.examples || [])) {
                    if (textMatch(ex.dialect)) return true;
                    if (textMatch(ex.translation)) return true;
                }
            }
            for (const e of (py.entries || [])) {
                if (textMatch(e.definition)) return true;
                for (const ex of (e.examples || [])) {
                    if (textMatch(ex.dialect)) return true;
                    if (textMatch(ex.translation)) return true;
                }
            }
            if (textMatch(py.notes)) return true;
        }
        return false;
    }

    /* =========================================================
       渲染
       ========================================================= */
    function showInitialMessage() {
        resultsContainer.innerHTML = `
            <div class="no-results" id="initialMessage">
                <i class="fas fa-search"></i>
                <h3>欢迎使用中山韵典在线</h3>
                <p>请输入定州方言字词或拼音进行查询，结果将显示在这里</p>
                <p style="margin-top: 15px; font-size: 0.9rem; color: #777;">
                    若您需要以拼音搜索词组，请用空格分隔音节。<br>
                    本网站实时与最新重制的《中山韵典》纸质版内容同步，两者内容更新时间不再独立。<br>
                    您可以搜索“凡例”以浏览《中山韵典》的《凡例》。<br>
                    提供“默认模式”和“反查模式”两种搜索方式
                </p>
            </div>
        `;
    }

    function renderEntry(item, query) {
        const charHtml = (typeof item.character === 'object' && item.character.type === 'img')
            ? `<img src="images/${item.character.src}.png" alt="图片" class="character-img">`
            : highlightText(item.character, query, true);

        let html = `
            <div class="character-item">
                <div class="character-header">
                    <div class="character-title">${charHtml}</div>
                </div>
        `;

        item.pinyins.forEach((py) => {
            html += `
                <div class="pinyin-container">
                    <div class="pinyin-item">
                        <div class="pinyin-text">${highlightText(py.pinyin, query, false)}</div>
            `;

            if (py.meanings && py.meanings.length) {
                html += `<div class="meaning-container">`;
                py.meanings.forEach((m) => {
                    if (m.text) {
                        html += `<div class="meaning-item">${highlightText(m.text, query, false)}</div>`;
                    }
                    if (m.examples && m.examples.length) {
                        html += `<div class="example-container">`;
                        m.examples.forEach((ex) => {
                            html += `<div class="example-dialect">${highlightText(ex.dialect, query, false)}</div>`;
                            if (ex.translation) {
                                html += `<div class="example-translation">${highlightText(ex.translation, query, false)}</div>`;
                            }
                        });
                        html += `</div>`;
                    }
                });
                html += `</div>`;
            }

            if (py.entries && py.entries.length) {
                html += `<div class="entry-container">`;
                py.entries.forEach((e) => {
                    html += `
                        <div class="entry-item">
                            <div class="entry-title">【${highlightText(e.title, query, false)}】</div>
                            ${e.entryPinyin ? `<div class="entry-pinyin">${highlightText(e.entryPinyin, query, false)}</div>` : ''}
                            ${e.definition ? `<div class="entry-definition">${highlightText(e.definition, query, false)}</div>` : ''}
                    `;
                    if (e.examples && e.examples.length) {
                        e.examples.forEach((ex) => {
                            html += `<div class="example-container">`;
                            html += `<div class="example-dialect">${highlightText(ex.dialect, query, false)}</div>`;
                            if (ex.translation) {
                                html += `<div class="example-translation">${highlightText(ex.translation, query, false)}</div>`;
                            }
                            html += `</div>`;
                        });
                    }
                    html += `</div>`;
                });
                html += `</div>`;
            }

            if (py.notes) {
                html += `
                    <div class="note-container">
                        <div class="note-title">注意</div>
                        <div class="note-content">${highlightText(py.notes, query, false)}</div>
                    </div>
                `;
            }

            html += `</div></div>`;
        });

        html += `</div>`;
        return html;
    }

    function displayResults(results, query) {
        resultsContainer.innerHTML = results.map((item) => renderEntry(item, query)).join('');
    }

    function displayAllEntries() {
        currentSearchQuery = '';
        const shown = dialectDatabase.filter((item) => !isSpecialEntry(item));

        const head = `
            <div class="no-results">
                <i class="fas fa-database"></i>
                <h3>显示全部内容</h3>
                <p>当前数据库中共有 ${shown.length} 个条目</p>
                <p style="margin-top: 15px; font-size: 0.9rem; color: #777;">
                    搜索"Every"即可显示本页面。
                </p>
            </div>
        `;
        resultsContainer.innerHTML = head + shown.map((item) => renderEntry(item, '')).join('');
    }

    /* =========================================================
       404 / 页面切换 / 弹窗
       ========================================================= */
    function switchTo404() {
        document.querySelector('header').style.display = 'none';
        document.querySelector('nav').style.display = 'none';
        document.querySelector('footer').style.display = 'none';
        PAGE_HOME.style.display = 'none';
        PAGE_ABOUT.style.display = 'none';

        grammarModal.classList.remove('show');
        inputAlertModal.classList.remove('show');

        page404.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        [navHome, navGrammar, navAbout].forEach((a) => a && a.classList.remove('active'));
    }

    function switchPage(pageId) {
        document.querySelector('header').style.display = 'block';
        document.querySelector('nav').style.display = 'block';
        document.querySelector('footer').style.display = 'block';

        PAGE_HOME.style.display = 'none';
        PAGE_ABOUT.style.display = 'none';
        page404.style.display = 'none';
        document.body.style.overflow = 'auto';

        if (pageId === 'home') {
            PAGE_HOME.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (pageId === 'about') {
            PAGE_ABOUT.style.display = 'block';
        }

        navHome.classList.toggle('active', pageId === 'home');
        navAbout.classList.toggle('active', pageId === 'about');
        navGrammar.classList.remove('active');
    }

    function showModal() {
        grammarModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function hideModal() {
        grammarModal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }

    /* =========================================================
       搜索入口
       ========================================================= */
    function searchDialect(query, mode) {
        if (!query || !query.trim()) {
            showInitialMessage();
            return;
        }

        if (query.toLowerCase() === 'every') {
            displayAllEntries();
            return;
        }

        if (query.includes('腚')) {
            switchTo404();
            return;
        }

        if (containsInvalidChars(query)) {
            showInputAlert('请输入汉字或拼音，不支持其他字符。');
            return;
        }

        currentSearchQuery = query;

        const matcher = mode === 'reverse' ? matchesSearchReverse : matchesSearchDefault;
        let results = dialectDatabase.filter((item) => matcher(item, query));

        if (isAllChinese(query) && [...query].length > 1) {
            results.sort((a, b) => countChineseMatches(b, query) - countChineseMatches(a, query));
        }

        if (isSingleLetter(query)) {
            const exact = results.filter((i) => hasPinyinExactlyLetter(i, query));
            const rest  = results.filter((i) => !hasPinyinExactlyLetter(i, query));
            results = exact.concat(rest);
        }

        if (isPinyinQuery(query) && !query.includes(' ')) {
            results.sort((a, b) => getPinyinMatchLevel(a, query) - getPinyinMatchLevel(b, query));
        }

        if (isVocabQuery(query)) {
            const exact = [], erhua = [], other = [];
            const qNoErhua = removeErhuaFromText(query);
            results.forEach((item) => {
                let hasExact = false, hasErhua = false;
                item.pinyins.forEach((py) => {
                    (py.entries || []).forEach((e) => {
                        if (!e.title) return;
                        const title = e.title.replace(/儿'/g, '儿').replace(/IMG:\w+/g, '[字]');
                        if (title.includes(query)) hasExact = true;
                        else if (removeErhuaFromText(title).includes(qNoErhua)) hasErhua = true;
                    });
                });
                if (hasExact) exact.push(item);
                else if (hasErhua) erhua.push(item);
                else other.push(item);
            });
            results = exact.concat(erhua, other);
        }

        if (results.length) {
            displayResults(results, query);
        } else {
            resultsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-question-circle"></i>
                    <h3>搜索不到结果</h3>
                    <p>未找到与"${query}"相关的定州方言词条</p>
                    <p>该词条可能尚未收录，不代表一定不存于定州方言。</p>
                    <p>当前仅支持使用简体汉字或拼音查询。</p>
                </div>
            `;
        }
    }

    /* =========================================================
       事件绑定 & 初始化
       ========================================================= */
    searchBtn.addEventListener('click', () => {
        searchDialect(searchInput.value.trim(), currentSearchMode);
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchDialect(searchInput.value.trim(), currentSearchMode);
        }
    });

    searchModeSelect.addEventListener('change', function () {
        currentSearchMode = this.value;
        modeDescription.textContent = currentSearchMode === 'default'
            ? '默认模式：仅支持按定州方言查询。反查模式：支持按定州方言查询和通过释义反查。'
            : '反查模式：支持按定州方言查询和通过释义反查。默认模式：仅支持按定州方言查询。';

        const v = searchInput.value.trim();
        if (v && !v.includes('腚')) searchDialect(v, currentSearchMode);
        else showInitialMessage();
    });

    const luckyPool = dialectDatabase
        .map((e) => e.character)
        .filter((c) => typeof c === 'string' && [...c].length === 1 && !/[\uE000-\uF8FF]/.test(c));

    function rollLucky() {
        if (!luckyPool.length) return;
        const w = luckyPool[Math.floor(Math.random() * luckyPool.length)];
        luckyWord.textContent = w;
        luckyWord.setAttribute('data-word', w);
    }
    rollLucky();

    document.querySelectorAll('.example-word').forEach((el) => {
        el.addEventListener('click', () => {
            const word = el.getAttribute('data-word');
            if (!word) return;
            searchInput.value = word;
            searchDialect(word, currentSearchMode);
            if (el === luckyWord) setTimeout(rollLucky, 0);
        });
    });

    navHome.addEventListener('click', (e) => { e.preventDefault(); switchPage('home'); });
    navAbout.addEventListener('click', (e) => { e.preventDefault(); switchPage('about'); });
    navGrammar.addEventListener('click', (e) => { e.preventDefault(); showModal(); });

    modalConfirm.addEventListener('click', () => {
        hideModal();
        window.open(PDF_LINK, '_blank');
    });
    modalCancel.addEventListener('click', () => {
        hideModal();
        switchPage('home');
    });
    grammarModal.addEventListener('click', (e) => {
        if (e.target === grammarModal) hideModal();
    });

    inputAlertConfirm.addEventListener('click', hideInputAlert);
    inputAlertModal.addEventListener('click', (e) => {
        if (e.target === inputAlertModal) hideInputAlert();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (grammarModal.classList.contains('show')) hideModal();
            if (inputAlertModal.classList.contains('show')) hideInputAlert();
        }
    });

    switchPage('home');
    searchInput.value = '';
    showInitialMessage();
    applyGlobalImages();
})();
