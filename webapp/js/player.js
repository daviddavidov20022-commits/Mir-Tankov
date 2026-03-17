/**
 * МИР ТАНКОВ — Видеоплеер (player.js)
 * Встроенный просмотр YouTube (через прокси), VK Video, Twitch
 * 
 * YouTube проксируется через Invidious/Piped — обход замедления!
 */

// ==========================================
// YOUTUBE ПРОКСИ-ФРОНТЕНДЫ (обход замедления)
// Это публичные серверы, которые загружают видео
// с YouTube через свои серверы (в Европе/США)
// и отдают его пользователю без ограничений.
// ==========================================
const YT_PROXIES = [
    // Piped instances (проксируют видео через свой сервер)
    { name: 'Piped (Kavin)', embed: 'https://piped.kavin.rocks/embed', type: 'piped' },
    { name: 'Piped Video', embed: 'https://piped.video/embed', type: 'piped' },
    { name: 'Piped (Lunar)', embed: 'https://piped.lunar.icu/embed', type: 'piped' },
    // Invidious instances
    { name: 'Invidious (FDN)', embed: 'https://invidious.fdn.fr/embed', type: 'invidious' },
    { name: 'Invidious (Nerdvpn)', embed: 'https://inv.nerdvpn.de/embed', type: 'invidious' },
    { name: 'Invidious (Privacydev)', embed: 'https://invidious.privacydev.net/embed', type: 'invidious' },
    // Оригинальный YouTube (fallback, если прокси не нужен)
    { name: 'YouTube (оригинал)', embed: 'https://www.youtube.com/embed', type: 'youtube' },
];

// Текущий выбранный прокси (по умолчанию — первый Piped)
let currentProxyIndex = parseInt(localStorage.getItem('yt_proxy_index') || '0');
if (currentProxyIndex >= YT_PROXIES.length) currentProxyIndex = 0;

// ==========================================
// КОНФИГ ПЛАТФОРМ
// ==========================================
const PLATFORMS = {
    youtube: {
        name: 'YouTube',
        placeholder: 'Вставь ссылку YouTube...',
        color: 'youtube',
        parseUrl: parseYoutubeUrl,
        buildEmbed: buildYoutubeEmbed,
    },
    vk: {
        name: 'VK Видео',
        placeholder: 'Вставь ссылку VK Видео...',
        color: 'vk',
        parseUrl: parseVkUrl,
        buildEmbed: buildVkEmbed,
    },
    twitch: {
        name: 'Twitch',
        placeholder: 'Имя канала или ссылка Twitch...',
        color: 'twitch',
        parseUrl: parseTwitchUrl,
        buildEmbed: buildTwitchEmbed,
    },
};

// Быстрый доступ — каналы
const QUICK_CHANNELS = [
    {
        name: 'ISERVERI',
        platform: 'youtube',
        url: 'https://www.youtube.com/@ISERVERI/live',
        icon: '🔴',
        desc: 'YouTube Live',
    },
    {
        name: 'ISERVERI',
        platform: 'twitch',
        url: 'https://www.twitch.tv/serverenok',
        icon: '💜',
        desc: 'Twitch канал',
    },
    {
        name: 'iserveri',
        platform: 'vk',
        url: 'https://vk.com/video/@iserveri',
        icon: '💙',
        desc: 'VK Видео',
    },
    {
        name: 'WOT Лучшее',
        platform: 'youtube',
        url: 'https://www.youtube.com/results?search_query=мир+танков+лучшие+моменты',
        icon: '🎯',
        desc: 'YouTube поиск',
    },
];

let currentPlatform = 'youtube';
let isPlaying = false;
let history = JSON.parse(localStorage.getItem('player_history') || '[]');

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initUser();
    createParticles();
    renderQuickChannels();
    renderHistory();
    renderProxySelector();

    // Enter для запуска
    document.getElementById('urlInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') playVideo();
    });

    // Открыть платформу если передана в URL
    const params = new URLSearchParams(window.location.search);
    const urlPlatform = params.get('platform');
    const urlSrc = params.get('src');
    if (urlPlatform && PLATFORMS[urlPlatform]) {
        switchPlatform(urlPlatform);
    }
    if (urlSrc) {
        document.getElementById('urlInput').value = decodeURIComponent(urlSrc);
        setTimeout(() => playVideo(), 300);
    }
});

function initTelegram() {
    try {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            tg.ready();
            tg.expand();
            tg.setHeaderColor('#0a0e14');
            tg.setBackgroundColor('#0a0e14');
        }
    } catch (e) { }
}

function initUser() {
    const tg = window.Telegram?.WebApp;
    const nameEl = document.getElementById('userName');
    if (tg?.initDataUnsafe?.user?.first_name && nameEl) {
        nameEl.textContent = tg.initDataUnsafe.user.first_name;
    }
}

// ==========================================
// ФОНОВЫЕ ЧАСТИЦЫ
// ==========================================
function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'bg-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (8 + Math.random() * 12) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.width = (1 + Math.random() * 3) + 'px';
        p.style.height = p.style.width;
        container.appendChild(p);
    }
}

// ==========================================
// ПЕРЕКЛЮЧЕНИЕ ПЛАТФОРМ
// ==========================================
function switchPlatform(platform) {
    if (!PLATFORMS[platform]) return;
    currentPlatform = platform;

    // Tabs
    document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('player-tab--active'));
    const activeTab = document.getElementById('tab' + platform.charAt(0).toUpperCase() + platform.slice(1));
    if (activeTab) activeTab.classList.add('player-tab--active');

    // Input
    const input = document.getElementById('urlInput');
    const btn = document.getElementById('playBtn');
    const container = document.getElementById('playerContainer');

    input.placeholder = PLATFORMS[platform].placeholder;
    input.className = 'player-input player-input--' + platform;
    btn.className = 'player-btn player-btn--' + platform;

    // Update container color bar
    container.className = 'player-container player-container--' + platform;

    // Update now playing pulse
    const pulse = document.getElementById('nowPlayingPulse');
    if (pulse) pulse.className = 'now-playing__pulse now-playing__pulse--' + platform;

    // Показать/скрыть селектор прокси (только для YouTube)
    const proxySection = document.getElementById('proxySection');
    if (proxySection) {
        proxySection.style.display = platform === 'youtube' ? 'block' : 'none';
    }
}

// ==========================================
// ПАРСЕРЫ URL
// ==========================================

function parseYoutubeUrl(url) {
    url = url.trim();

    // youtu.be/ID
    let match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'video', id: match[1] };

    // youtube.com/watch?v=ID
    match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'video', id: match[1] };

    // youtube.com/embed/ID
    match = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'video', id: match[1] };

    // youtube.com/shorts/ID
    match = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'video', id: match[1] };

    // youtube.com/live/ID
    match = url.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'video', id: match[1] };

    // youtube.com/@channel/live → live stream embed
    match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)\/live/i);
    if (match) return { type: 'channel_live', handle: match[1] };

    // youtube.com/@channel → channel page embed
    match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel', handle: match[1] };

    // youtube.com/channel/ID
    match = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel_id', id: match[1] };

    // Just an 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return { type: 'video', id: url };

    // YouTube search/playlist URL — open as-is through search
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return { type: 'search', query: url };
    }

    // Treat as search
    return { type: 'search', query: url };
}

function buildYoutubeEmbed(parsed) {
    const proxy = YT_PROXIES[currentProxyIndex];
    const embedBase = proxy.embed;

    if (parsed.type === 'video') {
        if (proxy.type === 'piped') {
            return `${embedBase}/${parsed.id}?autoplay=1`;
        }
        if (proxy.type === 'invidious') {
            return `${embedBase}/${parsed.id}?autoplay=1&quality=hd720`;
        }
        // youtube original
        return `${embedBase}/${parsed.id}?autoplay=1&rel=0`;
    }
    if (parsed.type === 'channel_live') {
        if (proxy.type === 'youtube') {
            return `${embedBase}/live_stream?channel=${parsed.handle}&autoplay=1`;
        }
        // Piped/Invidious — каналы по имени сложнее, попробуем поиск
        return `${embedBase.replace('/embed', '')}/c/${parsed.handle}`;
    }
    if (parsed.type === 'channel_id') {
        if (proxy.type === 'youtube') {
            return `${embedBase}/live_stream?channel=${parsed.id}&autoplay=1`;
        }
        return `${embedBase.replace('/embed', '')}/channel/${parsed.id}`;
    }
    if (parsed.type === 'channel') {
        if (proxy.type === 'youtube') {
            return `${embedBase}?listType=search&list=${parsed.handle}&autoplay=1`;
        }
        return `${embedBase.replace('/embed', '')}/@${parsed.handle}`;
    }
    if (parsed.type === 'search') {
        if (proxy.type === 'youtube') {
            return `${embedBase}?listType=search&list=${encodeURIComponent(parsed.query)}&autoplay=1`;
        }
        return `${embedBase.replace('/embed', '')}/search?q=${encodeURIComponent(parsed.query)}`;
    }
    return null;
}

function parseVkUrl(url) {
    url = url.trim();

    // vk.com/video-XXXXX_XXXXX
    let match = url.match(/video(-?\d+)_(\d+)/);
    if (match) return { type: 'video', oid: match[1], id: match[2] };

    // vk.com/video_ext.php?oid=XXX&id=XXX&hash=XXX
    match = url.match(/video_ext\.php\?(.+)/);
    if (match) return { type: 'ext', params: match[1] };

    // vk.com/video/@user
    match = url.match(/vk\.com\/video\/@([a-zA-Z0-9_]+)/);
    if (match) return { type: 'user', username: match[1] };

    // vk.com/clips/@user
    match = url.match(/vk\.com\/clips\/([a-zA-Z0-9_]+)/);
    if (match) return { type: 'user', username: match[1] };

    // Just try to parse as a VK video URL
    if (url.includes('vk.com')) {
        return { type: 'raw', url: url };
    }

    return { type: 'search', query: url };
}

function buildVkEmbed(parsed) {
    if (parsed.type === 'video') {
        return `https://vk.com/video_ext.php?oid=${parsed.oid}&id=${parsed.id}&hd=2`;
    }
    if (parsed.type === 'ext') {
        return `https://vk.com/video_ext.php?${parsed.params}`;
    }
    if (parsed.type === 'user' || parsed.type === 'raw') {
        return null;
    }
    return null;
}

function parseTwitchUrl(url) {
    url = url.trim();

    // twitch.tv/channel
    let match = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (match) return { type: 'channel', name: match[1] };

    // twitch.tv/videos/ID
    match = url.match(/twitch\.tv\/videos\/(\d+)/i);
    if (match) return { type: 'video', id: match[1] };

    // Just a channel name
    if (/^[a-zA-Z0-9_]{2,30}$/.test(url)) return { type: 'channel', name: url };

    return { type: 'channel', name: url.replace(/\s+/g, '') };
}

function buildTwitchEmbed(parsed) {
    const parent = window.location.hostname || 'localhost';
    if (parsed.type === 'channel') {
        return `https://player.twitch.tv/?channel=${parsed.name}&parent=${parent}&muted=false`;
    }
    if (parsed.type === 'video') {
        return `https://player.twitch.tv/?video=v${parsed.id}&parent=${parent}&autoplay=true`;
    }
    return null;
}

// ==========================================
// ПРОКСИ-СЕЛЕКТОР (выбор сервера YouTube)
// ==========================================
function renderProxySelector() {
    const container = document.getElementById('proxySection');
    if (!container) return;

    const proxy = YT_PROXIES[currentProxyIndex];
    const isOriginal = proxy.type === 'youtube';

    container.innerHTML = `
        <div class="proxy-selector">
            <div class="proxy-selector__header" onclick="toggleProxyList()">
                <div class="proxy-selector__info">
                    <div class="proxy-selector__label">🔓 YouTube сервер</div>
                    <div class="proxy-selector__current">
                        <span class="proxy-selector__dot ${isOriginal ? 'proxy-selector__dot--warn' : 'proxy-selector__dot--ok'}"></span>
                        <span class="proxy-selector__name">${proxy.name}</span>
                    </div>
                </div>
                <div class="proxy-selector__arrow" id="proxyArrow">▾</div>
            </div>
            ${!isOriginal ? `
                <div class="proxy-selector__status proxy-selector__status--ok">
                    ✅ Прокси-сервер — YouTube работает без ограничений
                </div>
            ` : `
                <div class="proxy-selector__status proxy-selector__status--warn">
                    ⚠️ Может не работать из-за замедления YouTube в РФ
                </div>
            `}
            <div class="proxy-selector__list" id="proxyList" style="display: none;">
                ${YT_PROXIES.map((p, i) => `
                    <div class="proxy-selector__item ${i === currentProxyIndex ? 'proxy-selector__item--active' : ''}" 
                         onclick="selectProxy(${i})">
                        <span class="proxy-selector__item-dot ${p.type === 'youtube' ? 'proxy-selector__dot--warn' : 'proxy-selector__dot--ok'}"></span>
                        <span class="proxy-selector__item-name">${p.name}</span>
                        <span class="proxy-selector__item-type">${p.type === 'piped' ? '🚀 Прокси' : p.type === 'invidious' ? '🛡 Прокси' : '⚠️ Прямой'}</span>
                        ${i === currentProxyIndex ? '<span class="proxy-selector__item-check">✓</span>' : ''}
                    </div>
                `).join('')}
                <div class="proxy-selector__hint">
                    💡 Если видео не грузится — попробуй другой сервер
                </div>
            </div>
        </div>
    `;
}

function toggleProxyList() {
    const list = document.getElementById('proxyList');
    const arrow = document.getElementById('proxyArrow');
    if (!list) return;

    const isVisible = list.style.display !== 'none';
    list.style.display = isVisible ? 'none' : 'block';
    if (arrow) arrow.textContent = isVisible ? '▾' : '▴';
}

function selectProxy(index) {
    if (index < 0 || index >= YT_PROXIES.length) return;
    currentProxyIndex = index;
    localStorage.setItem('yt_proxy_index', String(index));
    renderProxySelector();

    const proxy = YT_PROXIES[index];
    showToast('🔓', `Сервер: ${proxy.name}`);

    // Если уже играет YouTube — перезапустить с новым прокси
    if (isPlaying && currentPlatform === 'youtube') {
        playVideo();
    }

    try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (e) { }
}

// Автоматическая проверка прокси — пингуем текущий
async function checkCurrentProxy() {
    const proxy = YT_PROXIES[currentProxyIndex];
    if (proxy.type === 'youtube') return; // оригинал не проверяем

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(proxy.embed.replace('/embed', ''), {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal,
        });
        clearTimeout(timeout);
        console.log(`[Proxy] ${proxy.name} — доступен`);
    } catch (e) {
        console.warn(`[Proxy] ${proxy.name} — недоступен, пробуем следующий`);
        // Попробовать следующий прокси
        const nextIndex = (currentProxyIndex + 1) % YT_PROXIES.length;
        if (nextIndex !== currentProxyIndex) {
            selectProxy(nextIndex);
            showToast('🔄', `Сервер ${proxy.name} недоступен, переключаю...`);
        }
    }
}

// ==========================================
// ВОСПРОИЗВЕДЕНИЕ
// ==========================================
function playVideo() {
    const input = document.getElementById('urlInput');
    const url = input.value.trim();

    if (!url) {
        shakeInput();
        showToast('⚠️', 'Вставь ссылку или введи название!');
        return;
    }

    const platform = PLATFORMS[currentPlatform];
    const parsed = platform.parseUrl(url);
    const embedUrl = platform.buildEmbed(parsed);

    if (!embedUrl) {
        showToast('❌', 'Не удалось распознать ссылку. Попробуй другую.');
        shakeInput();
        return;
    }

    // Show player
    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const loading = document.getElementById('playerLoading');
    const nowPlaying = document.getElementById('nowPlaying');
    const nowValue = document.getElementById('nowPlayingValue');

    container.style.display = 'block';
    loading.classList.remove('player-loading--hidden');

    // Remove old iframe
    const oldIframe = aspect.querySelector('iframe');
    if (oldIframe) oldIframe.remove();

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.setAttribute('frameborder', '0');

    // Показать название прокси для YouTube
    let displayText = url;
    if (currentPlatform === 'youtube') {
        const proxy = YT_PROXIES[currentProxyIndex];
        if (proxy.type !== 'youtube') {
            displayText = `${url} (через ${proxy.name})`;
        }
    }

    iframe.onload = () => {
        setTimeout(() => {
            loading.classList.add('player-loading--hidden');
        }, 500);
    };

    // Если iframe не загрузился за 8 сек — предложить сменить прокси
    const loadTimeout = setTimeout(() => {
        loading.classList.add('player-loading--hidden');
        if (currentPlatform === 'youtube' && YT_PROXIES[currentProxyIndex].type !== 'youtube') {
            showToast('💡', 'Долго грузится? Попробуй другой сервер ↓', 5000);
        }
    }, 8000);

    iframe.onload = () => {
        clearTimeout(loadTimeout);
        setTimeout(() => {
            loading.classList.add('player-loading--hidden');
        }, 500);
    };

    aspect.appendChild(iframe);

    // Now playing bar
    nowPlaying.style.display = 'flex';
    nowValue.textContent = displayText;
    isPlaying = true;

    // Auto-scroll to player
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Save to history
    addToHistory(url, currentPlatform);

    // Haptic
    try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (e) { }
}

function closePlayer() {
    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const nowPlaying = document.getElementById('nowPlaying');

    const iframe = aspect.querySelector('iframe');
    if (iframe) iframe.remove();

    container.style.display = 'none';
    nowPlaying.style.display = 'none';
    isPlaying = false;
}

function playFromQuickChannel(url, platform) {
    switchPlatform(platform);
    document.getElementById('urlInput').value = url;
    playVideo();
}

// ==========================================
// UI HELPERS
// ==========================================
function shakeInput() {
    const input = document.getElementById('urlInput');
    input.style.animation = 'shake 0.5s ease';
    setTimeout(() => { input.style.animation = ''; }, 500);
}

function showToast(icon, text, duration = 3000) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__text">${text}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ==========================================
// БЫСТРЫЙ ДОСТУП
// ==========================================
function renderQuickChannels() {
    const grid = document.getElementById('quickGrid');
    if (!grid) return;

    grid.innerHTML = QUICK_CHANNELS.map((ch, i) => `
        <div class="quick-channel quick-channel--${ch.platform}" 
             onclick="playFromQuickChannel('${ch.url}', '${ch.platform}')"
             style="animation-delay: ${0.05 + i * 0.05}s">
            <div class="quick-channel__icon quick-channel__icon--${ch.platform}">
                ${ch.icon}
            </div>
            <div class="quick-channel__info">
                <span class="quick-channel__name">${ch.name}</span>
                <span class="quick-channel__platform">${ch.desc}</span>
            </div>
        </div>
    `).join('');
}

// ==========================================
// ИСТОРИЯ
// ==========================================
function addToHistory(url, platform) {
    history = history.filter(h => h.url !== url);

    history.unshift({
        url,
        platform,
        time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
    });

    if (history.length > 15) history = history.slice(0, 15);
    localStorage.setItem('player_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const section = document.getElementById('historySection');
    const list = document.getElementById('historyList');
    if (!section || !list) return;

    if (history.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = history.map(h => `
        <div class="history-item" onclick="playFromHistory('${encodeURIComponent(h.url)}', '${h.platform}')">
            <div class="history-item__dot history-item__dot--${h.platform}"></div>
            <div class="history-item__text">${escapeHtml(h.url)}</div>
            <div class="history-item__time">${h.time}</div>
        </div>
    `).join('');
}

function playFromHistory(encodedUrl, platform) {
    const url = decodeURIComponent(encodedUrl);
    switchPlatform(platform);
    document.getElementById('urlInput').value = url;
    playVideo();
}

function clearHistory() {
    history = [];
    localStorage.removeItem('player_history');
    renderHistory();
    showToast('🗑', 'История очищена');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================
function goBack() {
    const myId = localStorage.getItem('my_telegram_id');
    let url = 'index.html';
    if (myId) url += `?telegram_id=${myId}`;
    window.location.href = url;
}

function openGame(url) {
    const myId = localStorage.getItem('my_telegram_id');
    if (myId) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}telegram_id=${myId}`;
    }
    window.location.href = url;
}

// Expose globals
window.switchPlatform = switchPlatform;
window.playVideo = playVideo;
window.closePlayer = closePlayer;
window.playFromQuickChannel = playFromQuickChannel;
window.playFromHistory = playFromHistory;
window.clearHistory = clearHistory;
window.goBack = goBack;
window.openGame = openGame;
window.toggleProxyList = toggleProxyList;
window.selectProxy = selectProxy;
