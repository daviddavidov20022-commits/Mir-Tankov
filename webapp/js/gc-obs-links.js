// ============================================================
// OBS LINK FUNCTIONS for Global Challenge
// ============================================================

function _gcGetWidgetBase() {
    const pathParts = window.location.pathname.split('/');
    pathParts[pathParts.length - 1] = 'gc-widget.html';
    return window.location.origin + pathParts.join('/');
}

function gcCopyObsLink() {
    const base = _gcGetWidgetBase();
    const url = myTelegramId ? base + '?telegram_id=' + myTelegramId : base;
    _gcCopyText(url, 'OBS ссылка скопирована! Добавьте как Browser Source в OBS.');
}

function gcCopyObsLinkWithConfig() {
    const config = gcGetWidgetConfig();
    const base = _gcGetWidgetBase();
    const params = new URLSearchParams();
    if (myTelegramId) params.set('telegram_id', myTelegramId);
    params.set('layout', config.layout);
    params.set('theme', config.theme);
    params.set('accent', config.accent.replace('#', ''));
    params.set('border', config.border);
    params.set('bg', config.bgOpacity);
    params.set('font', config.fontSize);
    if (!config.showTimer) params.set('timer', '0');
    if (!config.showMyStats) params.set('me', '0');
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
