/**
 * МИР ТАНКОВ — Утилита для подстраниц сайта (site-page.js)
 * Подключается на всех страницах кроме index.html
 * Заменяет Telegram SDK, обеспечивает авторизацию и навигацию
 */

// Mock Telegram WebApp API для совместимости с существующими скриптами webapp
(function() {
    const telegramId = localStorage.getItem('site_telegram_id') || localStorage.getItem('my_telegram_id');
    const username = localStorage.getItem('site_username') || 'Танкист';

    // Если не авторизован — на логин
    if (!telegramId) {
        window.location.href = 'index.html';
        return;
    }

    // Mock Telegram WebApp object для совместимости
    window.Telegram = {
        WebApp: {
            ready: function() {},
            expand: function() {},
            close: function() {},
            setHeaderColor: function() {},
            setBackgroundColor: function() {},
            initDataUnsafe: {
                user: {
                    id: parseInt(telegramId),
                    first_name: username,
                    username: username,
                }
            },
            initData: `user=${encodeURIComponent(JSON.stringify({id: parseInt(telegramId), first_name: username}))}`,
            HapticFeedback: {
                impactOccurred: function() {},
                notificationOccurred: function() {},
                selectionChanged: function() {},
            },
            sendData: function(data) {
                console.log('[Site] sendData mock:', data);
            },
            showPopup: function(params, callback) {
                const result = confirm(params.message || params.title);
                if (callback) callback(result ? params.buttons?.[0]?.id : null);
            },
            showConfirm: function(message, callback) {
                const result = confirm(message);
                if (callback) callback(result);
            },
            showAlert: function(message, callback) {
                alert(message);
                if (callback) callback();
            },
            BackButton: {
                show: function() {},
                hide: function() {},
                onClick: function() {},
                isVisible: false,
            },
            MainButton: {
                show: function() {},
                hide: function() {},
                setText: function() {},
                onClick: function() {},
                isVisible: false,
            },
            themeParams: {
                bg_color: '#0a0e14',
                text_color: '#E8E6E3',
                hint_color: '#5A6577',
                link_color: '#C8AA6E',
                button_color: '#C8AA6E',
                button_text_color: '#0a0e14',
            },
            colorScheme: 'dark',
            platform: 'web',
            version: '7.0',
        },
    };

    // Убедимся что telegram_id передаётся в URL если его нет
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('telegram_id')) {
        const url = new URL(window.location.href);
        url.searchParams.set('telegram_id', telegramId);
        window.history.replaceState({}, '', url.toString());
    }

    // Сохраняем в localStorage для совместимости
    localStorage.setItem('my_telegram_id', telegramId);
    
    // Переопределяем API URL для совместимости
    window.BOT_API_URL = 'https://mir-tankov-production.up.railway.app';
    window.BOT_API_URL_APP = 'https://mir-tankov-production.up.railway.app';
})();
