/**
 * МИР ТАНКОВ — Видеоплеер (player.js)
 * Встроенный просмотр YouTube, VK Video, Twitch
 */

// ==========================================
// КОНФИГ
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
    if (parsed.type === 'video') {
        return `https://www.youtube.com/embed/${parsed.id}?autoplay=1&rel=0`;
    }
    if (parsed.type === 'channel_live') {
        // Embed live stream for a channel handle
        return `https://www.youtube.com/embed/live_stream?channel=${parsed.handle}&autoplay=1`;
    }
    if (parsed.type === 'channel_id') {
        return `https://www.youtube.com/embed/live_stream?channel=${parsed.id}&autoplay=1`;
    }
    if (parsed.type === 'channel') {
        // For handles we can try to embed search
        return `https://www.youtube.com/embed?listType=search&list=${parsed.handle}&autoplay=1`;
    }
    if (parsed.type === 'search') {
        return `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(parsed.query)}&autoplay=1`;
    }
    return null;
}

function parseVkUrl(url) {
    url = url.trim();

    // vk.com/video-XXXXX_XXXXX или vk.com/video_ext.php?oid=X&id=X&hash=X
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
    // For user/channel — we can't embed a page, show message
    if (parsed.type === 'user' || parsed.type === 'raw') {
        return null; // will show error
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

    iframe.onload = () => {
        setTimeout(() => {
            loading.classList.add('player-loading--hidden');
        }, 500);
    };

    // Auto-hide loading after timeout
    setTimeout(() => {
        loading.classList.add('player-loading--hidden');
    }, 4000);

    aspect.appendChild(iframe);

    // Now playing bar
    nowPlaying.style.display = 'flex';
    nowValue.textContent = url;
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
    // Remove duplicate
    history = history.filter(h => h.url !== url);

    history.unshift({
        url,
        platform,
        time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
    });

    // Keep max 15
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
