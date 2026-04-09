/**
 * МИР ТАНКОВ — Видеоплеер (player.js)
 * YouTube: обычный embed (для стримов нужен VPN, или используйте Twitch)
 * VK Video / Twitch: embed через iframe (работает без ограничений)
 */

// ==========================================
// КОНФИГ ПЛАТФОРМ
// ==========================================
const PLATFORMS = {
    youtube: {
        name: 'YouTube',
        placeholder: 'Ссылка на видео или канал/стрим...',
        color: 'youtube',
        parseUrl: parseYoutubeUrl,
        buildEmbed: buildYoutubeEmbed,
    },
    vk: {
        name: 'VK Видео',
        placeholder: 'Ссылка на видео VK...',
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

// Быстрый доступ
const QUICK_CHANNELS = [
    { name: 'ISERVERI', platform: 'twitch', url: 'https://www.twitch.tv/serverenok', icon: '💜', desc: 'Twitch стрим' },
    { name: 'iserveri', platform: 'vk', url: 'https://vk.com/video/@iserveri', icon: '💙', desc: 'VK Видео' },
    { name: 'ISERVERI', platform: 'youtube', url: 'https://www.youtube.com/@ISERVERI', icon: '🔴', desc: 'YouTube канал' },
];

let currentPlatform = 'vk';
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

    // Прячем прокси-секцию (больше не нужна)
    const proxySection = document.getElementById('proxySection');
    if (proxySection) proxySection.style.display = 'none';

    document.getElementById('urlInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') playVideo();
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('platform') && PLATFORMS[params.get('platform')]) {
        switchPlatform(params.get('platform'));
    }
    if (params.get('src')) {
        document.getElementById('urlInput').value = decodeURIComponent(params.get('src'));
        setTimeout(() => playVideo(), 300);
    }
});

function initTelegram() {
    try {
        const tg = window.Telegram?.WebApp;
        if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0e14'); tg.setBackgroundColor('#0a0e14'); }
    } catch (e) { }
}

function initUser() {
    const tg = window.Telegram?.WebApp;
    const nameEl = document.getElementById('userName');
    if (tg?.initDataUnsafe?.user?.first_name && nameEl) {
        nameEl.textContent = tg.initDataUnsafe.user.first_name;
    }
}

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

    document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('player-tab--active'));
    const activeTab = document.getElementById('tab' + platform.charAt(0).toUpperCase() + platform.slice(1));
    if (activeTab) activeTab.classList.add('player-tab--active');

    const input = document.getElementById('urlInput');
    const btn = document.getElementById('playBtn');
    const container = document.getElementById('playerContainer');

    input.placeholder = PLATFORMS[platform].placeholder;
    input.className = 'player-input player-input--' + platform;
    btn.className = 'player-btn player-btn--' + platform;
    container.className = 'player-container player-container--' + platform;

    const pulse = document.getElementById('nowPlayingPulse');
    if (pulse) pulse.className = 'now-playing__pulse now-playing__pulse--' + platform;
}

// ==========================================
// ПАРСЕРЫ URL
// ==========================================
function extractYoutubeVideoId(url) {
    let m;
    m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
    m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/); if (m) return m[1];
    m = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
    m = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
    m = url.match(/\/live\/([a-zA-Z0-9_-]{11})/); if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    return null;
}

function parseYoutubeUrl(url) {
    url = url.trim();

    const videoId = extractYoutubeVideoId(url);
    if (videoId) return { type: 'video', id: videoId };

    // @channel/live → live stream embed
    let match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)\/live/i);
    if (match) return { type: 'channel_live', handle: match[1] };

    // @channel → channel page (will try to embed live)
    match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel', handle: match[1] };

    // /channel/ID
    match = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel_id', id: match[1] };

    if (url.includes('youtube.com/results') || url.includes('search_query')) return { type: 'error_search' };
    if (url.includes('youtube.com/playlist')) return { type: 'error_playlist' };
    if (url.includes('youtube.com') || url.includes('youtu.be')) return { type: 'error_unknown' };
    return { type: 'error_not_video' };
}

function buildYoutubeEmbed(parsed) {
    if (parsed.type === 'video') {
        return `https://www.youtube.com/embed/${parsed.id}?autoplay=1&rel=0`;
    }
    if (parsed.type === 'channel_live') {
        // YouTube embed для live стрима по хэндлу
        return `https://www.youtube.com/embed/live_stream?channel=${parsed.handle}&autoplay=1`;
    }
    if (parsed.type === 'channel') {
        // Для каналов тоже пробуем embed live
        return `https://www.youtube.com/embed/live_stream?channel=${parsed.handle}&autoplay=1`;
    }
    if (parsed.type === 'channel_id') {
        return `https://www.youtube.com/embed/live_stream?channel=${parsed.id}&autoplay=1`;
    }
    return null;
}

function parseVkUrl(url) {
    url = url.trim();
    let match = url.match(/video(-?\d+)_(\d+)/);
    if (match) return { type: 'video', oid: match[1], id: match[2] };
    match = url.match(/video_ext\.php\?(.+)/);
    if (match) return { type: 'ext', params: match[1] };
    match = url.match(/vk\.com\/video\/@([a-zA-Z0-9_]+)/);
    if (match) return { type: 'user', username: match[1] };
    if (url.includes('vk.com')) return { type: 'raw', url: url };
    return { type: 'error', query: url };
}

function buildVkEmbed(parsed) {
    if (parsed.type === 'video') return `https://vk.com/video_ext.php?oid=${parsed.oid}&id=${parsed.id}&hd=2`;
    if (parsed.type === 'ext') return `https://vk.com/video_ext.php?${parsed.params}`;
    return null;
}

function parseTwitchUrl(url) {
    url = url.trim();
    let match = url.match(/twitch\.tv\/videos\/(\d+)/i);
    if (match) return { type: 'video', id: match[1] };
    match = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (match && match[1].toLowerCase() !== 'videos') return { type: 'channel', name: match[1] };
    if (/^[a-zA-Z0-9_]{2,30}$/.test(url)) return { type: 'channel', name: url };
    return { type: 'channel', name: url.replace(/\s+/g, '') };
}

function buildTwitchEmbed(parsed) {
    const parent = window.location.hostname || 'localhost';
    if (parsed.type === 'channel') return `https://player.twitch.tv/?channel=${parsed.name}&parent=${parent}&muted=false`;
    if (parsed.type === 'video') return `https://player.twitch.tv/?video=v${parsed.id}&parent=${parent}&autoplay=true`;
    return null;
}

// ==========================================
// ВОСПРОИЗВЕДЕНИЕ
// ==========================================
function playVideo() {
    const input = document.getElementById('urlInput');
    const url = input.value.trim();

    if (!url) { shakeInput(); showToast('⚠️', 'Вставь ссылку!'); return; }

    const platform = PLATFORMS[currentPlatform];
    const parsed = platform.parseUrl(url);

    // Ошибки
    if (parsed.type === 'error_search') { showToast('❌', 'Ссылка на поиск не поддерживается!', 4000); shakeInput(); return; }
    if (parsed.type === 'error_playlist') { showToast('❌', 'Плейлисты не поддерживаются.', 4000); shakeInput(); return; }
    if (parsed.type === 'error_not_video') { showToast('❌', 'Вставь ссылку на видео или канал!', 4000); shakeInput(); return; }
    if (parsed.type === 'error_unknown' || parsed.type === 'error') { showToast('❌', 'Не удалось распознать ссылку.', 4000); shakeInput(); return; }

    // VK: каналы нельзя embed
    if (currentPlatform === 'vk' && (parsed.type === 'user' || parsed.type === 'raw')) {
        showToast('❌', 'Вставь ссылку на конкретное видео VK!', 4000);
        shakeInput();
        return;
    }

    const embedUrl = platform.buildEmbed(parsed);
    if (!embedUrl) { showToast('❌', 'Не удалось построить ссылку.', 4000); shakeInput(); return; }

    // Показываем плеер
    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const loading = document.getElementById('playerLoading');
    const nowPlaying = document.getElementById('nowPlaying');
    const nowValue = document.getElementById('nowPlayingValue');

    container.style.display = 'block';
    loading.classList.remove('player-loading--hidden');

    // Очистка
    const oldIframe = aspect.querySelector('iframe');
    if (oldIframe) oldIframe.remove();
    const oldCard = aspect.querySelector('.yt-open-card');
    if (oldCard) oldCard.remove();

    // Создаём iframe
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.setAttribute('frameborder', '0');

    // Таймаут загрузки
    const loadTimeout = setTimeout(() => {
        loading.classList.add('player-loading--hidden');
        if (currentPlatform === 'youtube') {
            showToast('💡', 'YouTube замедлен в РФ. Для стримов используй Twitch!', 5000);
        }
    }, 12000);

    iframe.onload = () => {
        clearTimeout(loadTimeout);
        setTimeout(() => loading.classList.add('player-loading--hidden'), 500);
    };

    aspect.appendChild(iframe);

    // Now playing
    nowPlaying.style.display = 'flex';
    nowValue.textContent = url;
    isPlaying = true;

    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    addToHistory(url, currentPlatform);

    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch (e) { }
}

function closePlayer() {
    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const nowPlaying = document.getElementById('nowPlaying');

    const iframe = aspect.querySelector('iframe');
    if (iframe) iframe.remove();
    const card = aspect.querySelector('.yt-open-card');
    if (card) card.remove();

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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
            <div class="quick-channel__icon quick-channel__icon--${ch.platform}">${ch.icon}</div>
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
    history.unshift({ url, platform, time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) });
    if (history.length > 15) history = history.slice(0, 15);
    localStorage.setItem('player_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const section = document.getElementById('historySection');
    const list = document.getElementById('historyList');
    if (!section || !list) return;
    if (history.length === 0) { section.style.display = 'none'; return; }
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
    switchPlatform(platform);
    document.getElementById('urlInput').value = decodeURIComponent(encodedUrl);
    playVideo();
}

function clearHistory() {
    history = [];
    localStorage.removeItem('player_history');
    renderHistory();
    showToast('🗑', 'История очищена');
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================
function goBack() {
    const myId = localStorage.getItem('my_telegram_id');
    window.location.href = myId ? `index.html?telegram_id=${myId}` : 'index.html';
}

function openGame(url) {
    const myId = localStorage.getItem('my_telegram_id');
    if (myId) { const sep = url.includes('?') ? '&' : '?'; url += `${sep}telegram_id=${myId}`; }
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
