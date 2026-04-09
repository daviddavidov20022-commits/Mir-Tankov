// ============================================================
// OBS LINK FUNCTIONS for Global Challenge
// ============================================================

function _gcGetWidgetBase() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    const origin = isLocal ? 'https://mir-tankov-production.up.railway.app' : window.location.origin;
    
    // Построение пути /webapp/gc-widget.html или /site/gc-widget.html
    const pathParts = window.location.pathname.split('/');
    if (isLocal && !pathParts.includes('webapp')) {
        // Если открыто как файл или на локалхосте без папки webapp, заставляем путь к webapp на railway
        return 'https://mir-tankov-production.up.railway.app/webapp/gc-widget.html';
    }
    pathParts[pathParts.length - 1] = 'gc-widget.html';
    return origin + pathParts.join('/');
}

function gcCopyObsLink() {
    const base = _gcGetWidgetBase();
    const params = new URLSearchParams();
    if (myTelegramId) params.set('telegram_id', myTelegramId);
    
    // Передаем API URL в виджет, если он не дефолтный (например, localhost)
    if (BOT_API_URL && !BOT_API_URL.includes('mir-tankov-production')) {
        params.set('api', BOT_API_URL);
    }
    
    const url = params.toString() ? base + '?' + params.toString() : base;
    _gcCopyText(url, 'OBS ссылка скопирована! Добавьте как Browser Source в OBS.');
}

function gcCopyObsLinkWithConfig() {
    const config = gcGetWidgetConfig();
    const base = _gcGetWidgetBase();
    const params = new URLSearchParams();
    if (myTelegramId) params.set('telegram_id', myTelegramId);
    
    // Передаем API URL в виджет, если он не дефолтный
    if (BOT_API_URL && !BOT_API_URL.includes('mir-tankov-production')) {
        params.set('api', BOT_API_URL);
    }

    params.set('layout', config.layout);
    params.set('theme', config.theme);
    params.set('accent', config.accent.replace('#', ''));
    params.set('border', config.border);
    params.set('bg', config.bgOpacity);
    params.set('font', config.fontSize);
    if (!config.showTimer) params.set('timer', '0');
    if (!config.showMyStats) params.set('me', '0');
    params.set('topcount', config.topCount || 3);
    if (!config.showTop3) params.set('top', '0');
    if (!config.showLive) params.set('live', '0');
    const url = base + '?' + params.toString();
    _gcCopyText(url, 'OBS ссылка с настройками скопирована!');
}

function _gcCopyText(text, msg) {
    navigator.clipboard.writeText(text).then(function() {
        showToast(msg);
    }).catch(function() {
        var input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast(msg);
    });
}
