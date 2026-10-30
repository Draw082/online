/* 手机端字体加载失败时，自动切换备用 CDN（jsdelivr） */
(function () {
    if (!window.matchMedia || !document.fonts || !document.fonts.load) return;
    if (!matchMedia('(hover: none) and (pointer: coarse)').matches) return;

    var switched = false;

    function backup() {
        if (switched) return;
        switched = true;
        [
            'lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css',
            'lxgw-wenkai-webfont@1.7.0/lxgwwenkai-bold.css',
            '@fontsource/noto-serif-sc@5.2.8/400.css',
            '@fontsource/noto-serif-sc@5.2.8/700.css'
        ].forEach(function (p) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = 'https://cdn.jsdelivr.net/npm/' + p;
            document.head.appendChild(l);
        });
    }

    function probe() {
        document.fonts.load('16px "LXGW WenKai"', '中')
            .then(function (f) { if (!f.length) backup(); })
            .catch(backup);
        document.fonts.load('16px "Noto Serif SC"', '中')
            .then(function (f) { if (!f.length) backup(); })
            .catch(backup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', probe);
    } else {
        probe();
    }
})();