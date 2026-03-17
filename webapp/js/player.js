/**
 * МИР ТАНКОВ — Видеоплеер (player.js)
 * YouTube: открытие через Invidious в браузере Telegram (обход замедления)
 * VK Video / Twitch: embed через iframe (работает без ограничений)
 */

// ==========================================
// YOUTUBE ПРОКСИ (Invidious — проверенные инстансы)
// Embed отключен на публичных инстансах, используем redirect в браузер
// ==========================================
const YT_PROXIES = [
    { name: 'Invidious 🇩🇪 Германия', host: 'https://yewtu.be', type: 'invidious', flag: '🇩🇪' },
    { name: 'Invidious 🇺🇦 Украина', host: 'https://invidious.nerdvpn.de', type: 'invidious', flag: '🇺🇦' },
    { name: 'Invidious 🇨🇱 Чили', host: 'https://inv.nadeko.net', type: 'invidious', flag: '🇨🇱' },
    { name: 'YouTube ⚠️ оригинал', host: 'https://www.youtube.com', type: 'youtube', flag: '⚠️' },
];

let currentProxyIndex = parseInt(localStorage.getItem('yt_proxy_index') || '0');
if (currentProxyIndex >= YT_PROXIES.length) currentProxyIndex = 0;

// ==========================================
// КОНФИГ ПЛАТФОРМ
// ==========================================
const PLATFORMS = {
    youtube: {
        name: 'YouTube',
        placeholder: 'Вставь ссылку YouTube видео или канала...',
        color: 'youtube',
        parseUrl: parseYoutubeUrl,
        buildEmbed: () => null, // YouTube открывается в браузере, не в iframe
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

// Быстрый доступ
const QUICK_CHANNELS = [
    { name: 'ISERVERI', platform: 'twitch', url: 'https://www.twitch.tv/serverenok', icon: '💜', desc: 'Twitch стрим' },
    { name: 'iserveri', platform: 'vk', url: 'https://vk.com/video/@iserveri', icon: '💙', desc: 'VK Видео' },
    { name: 'ISERVERI', platform: 'youtube', url: 'https://www.youtube.com/@ISERVERI', icon: '🔴', desc: 'YouTube канал' },
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

    const proxySection = document.getElementById('proxySection');
    if (proxySection) proxySection.style.display = platform === 'youtube' ? 'block' : 'none';
}

// ==========================================
// ПАРСЕРЫ URL
// ==========================================
function extractYoutubeVideoId(url) {
    let m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = url.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    return null;
}

function parseYoutubeUrl(url) {
    url = url.trim();
    const videoId = extractYoutubeVideoId(url);
    if (videoId) return { type: 'video', id: videoId };

    let match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)\/live/i);
    if (match) return { type: 'channel_live', handle: match[1] };

    match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel', handle: match[1] };

    match = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel_id', id: match[1] };

    if (url.includes('youtube.com/results') || url.includes('search_query')) return { type: 'error_search' };
    if (url.includes('youtube.com/playlist')) return { type: 'error_playlist' };
    if (url.includes('youtube.com') || url.includes('youtu.be')) return { type: 'error_unknown' };
    return { type: 'error_not_video' };
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
// YOUTUBE: Invidious API (поиск стримов и видео каналов)
// ==========================================
function buildYoutubeWatchUrl(videoId) {
    const proxy = YT_PROXIES[currentProxyIndex];
    if (proxy.type === 'invidious') {
        return `${proxy.host}/watch?v=${videoId}&local=true&quality=hd720`;
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
}

async function resolveYoutubeChannel(parsed) {
    const proxy = YT_PROXIES[currentProxyIndex];
    const host = proxy.host;
    if (proxy.type === 'youtube') return null;

    try {
        let channelId = null;

        if (parsed.type === 'channel' || parsed.type === 'channel_live') {
            const searchResp = await fetch(`${host}/api/v1/search?q=${encodeURIComponent('@' + parsed.handle)}&type=channel`, {
                signal: AbortSignal.timeout(8000)
            });
            if (!searchResp.ok) throw new Error('Search failed');
            const searchData = await searchResp.json();
            if (searchData.length > 0 && searchData[0].authorId) {
                channelId = searchData[0].authorId;
            }
        } else if (parsed.type === 'channel_id') {
            channelId = parsed.id;
        }

        if (!channelId) return null;

        // 1) Ищем АКТИВНЫЙ СТРИМ
        try {
            const resp = await fetch(`${host}/api/v1/channels/${channelId}/streams`, { signal: AbortSignal.timeout(8000) });
            if (resp.ok) {
                const data = await resp.json();
                const streams = data.videos || data;
                const live = streams.find(v => v.liveNow === true);
                if (live && live.videoId) {
                    return { videoId: live.videoId, title: live.title || 'Прямая трансляция', isLive: true };
                }
            }
        } catch (e) { /* ignore */ }

        // 2) Ищем live среди последних видео
        try {
            const resp = await fetch(`${host}/api/v1/channels/${channelId}/videos?sort_by=newest`, { signal: AbortSignal.timeout(8000) });
            if (resp.ok) {
                const data = await resp.json();
                const videos = data.videos || data;
                const live = videos.find(v => v.liveNow === true);
                if (live && live.videoId) {
                    return { videoId: live.videoId, title: live.title || 'Прямая трансляция', isLive: true };
                }
                if (videos.length > 0 && videos[0].videoId) {
                    return { videoId: videos[0].videoId, title: videos[0].title || 'Последнее видео', isLive: false };
                }
            }
        } catch (e) { /* ignore */ }

        return null;
    } catch (e) {
        console.warn('[resolveYoutubeChannel]', e.message);
        return null;
    }
}

// ==========================================
// YOUTUBE: Открытие в браузере Telegram
// ==========================================
function openYoutubeInBrowser(videoId, title, isLive) {
    const watchUrl = buildYoutubeWatchUrl(videoId);

    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const nowPlaying = document.getElementById('nowPlaying');
    const nowValue = document.getElementById('nowPlayingValue');
    const loading = document.getElementById('playerLoading');

    // Очистка
    const oldIframe = aspect.querySelector('iframe');
    if (oldIframe) oldIframe.remove();
    const oldCard = aspect.querySelector('.yt-open-card');
    if (oldCard) oldCard.remove();

    container.style.display = 'block';
    loading.classList.add('player-loading--hidden');

    // Красивая карточка вместо iframe
    const card = document.createElement('div');
    card.className = 'yt-open-card';
    card.innerHTML = `
        <div class="yt-open-card__inner">
            <div class="yt-open-card__icon">${isLive ? '🔴' : '▶️'}</div>
            <div class="yt-open-card__title">${escapeHtml(title || 'YouTube видео')}</div>
            <div class="yt-open-card__desc">
                ${isLive ? 'Прямая трансляция' : 'Видео'} откроется через Invidious — без замедления
            </div>
            <button class="yt-open-card__btn" onclick="openWatchUrl('${watchUrl}')">
                ${isLive ? '🔴 Смотреть стрим' : '▶ Смотреть видео'}
            </button>
            <div class="yt-open-card__hint">Откроется во встроенном браузере Telegram</div>
        </div>
    `;
    aspect.appendChild(card);

    nowPlaying.style.display = 'flex';
    nowValue.textContent = `${isLive ? '🔴 LIVE' : '📹'} ${title}`;
    isPlaying = true;

    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Сразу открываем
    openWatchUrl(watchUrl);

    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch (e) { }
}

function openWatchUrl(url) {
    try {
        const tg = window.Telegram?.WebApp;
        if (tg?.openLink) {
            tg.openLink(url);
        } else {
            window.open(url, '_blank');
        }
    } catch (e) {
        window.open(url, '_blank');
    }
}

// ==========================================
// ПРОКСИ-СЕЛЕКТОР
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
                    <div class="proxy-selector__label">🔓 YouTube сервер (обход замедления)</div>
                    <div class="proxy-selector__current">
                        <span class="proxy-selector__dot ${isOriginal ? 'proxy-selector__dot--warn' : 'proxy-selector__dot--ok'}"></span>
                        <span class="proxy-selector__name">${proxy.flag} ${proxy.name}</span>
                    </div>
                </div>
                <div class="proxy-selector__arrow" id="proxyArrow">▾</div>
            </div>
            ${!isOriginal ? `
                <div class="proxy-selector__status proxy-selector__status--ok">
                    ✅ Видео откроется через Invidious — без замедления
                </div>
            ` : `
                <div class="proxy-selector__status proxy-selector__status--warn">
                    ⚠️ Оригинал — может не работать из-за замедления
                </div>
            `}
            <div class="proxy-selector__list" id="proxyList" style="display: none;">
                ${YT_PROXIES.map((p, i) => `
                    <div class="proxy-selector__item ${i === currentProxyIndex ? 'proxy-selector__item--active' : ''}" 
                         onclick="selectProxy(${i}); event.stopPropagation();">
                        <span class="proxy-selector__item-dot ${p.type === 'youtube' ? 'proxy-selector__dot--warn' : 'proxy-selector__dot--ok'}"></span>
                        <span class="proxy-selector__item-name">${p.flag} ${p.name}</span>
                        <span class="proxy-selector__item-type">${p.type === 'invidious' ? '🚀 Прокси' : '⚠️ Прямой'}</span>
                        ${i === currentProxyIndex ? '<span class="proxy-selector__item-check">✓</span>' : ''}
                    </div>
                `).join('')}
                <div class="proxy-selector__hint">
                    💡 YouTube откроется в браузере Telegram через выбранный сервер
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
    showToast('🔓', `Сервер: ${YT_PROXIES[index].name}`);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch (e) { }
}

// ==========================================
// ВОСПРОИЗВЕДЕНИЕ
// ==========================================
async function playVideo() {
    const input = document.getElementById('urlInput');
    const url = input.value.trim();

    if (!url) {
        shakeInput();
        showToast('⚠️', 'Вставь ссылку!');
        return;
    }

    const platform = PLATFORMS[currentPlatform];
    const parsed = platform.parseUrl(url);

    // Ошибки парсинга
    if (parsed.type === 'error_search') { showToast('❌', 'Ссылка на поиск не поддерживается!', 5000); shakeInput(); return; }
    if (parsed.type === 'error_playlist') { showToast('❌', 'Плейлисты не поддерживаются.', 5000); shakeInput(); return; }
    if (parsed.type === 'error_not_video') { showToast('❌', 'Вставь ссылку на видео или канал!', 5000); shakeInput(); return; }
    if (parsed.type === 'error_unknown' || parsed.type === 'error') { showToast('❌', 'Не удалось распознать ссылку.', 5000); shakeInput(); return; }

    if (currentPlatform === 'vk' && (parsed.type === 'user' || parsed.type === 'raw')) {
        showToast('❌', 'Вставь ссылку на конкретное видео VK!', 5000);
        shakeInput();
        return;
    }

    // ==========================================
    // YouTube — открываем через Invidious в браузере Telegram
    // ==========================================
    if (currentPlatform === 'youtube') {
        let videoId = null;
        let title = 'YouTube видео';
        let isLive = false;

        if (parsed.type === 'video') {
            videoId = parsed.id;
        } else if (parsed.type === 'channel' || parsed.type === 'channel_id' || parsed.type === 'channel_live') {
            showToast('🔍', 'Ищу стрим канала...', 6000);
            const resolved = await resolveYoutubeChannel(parsed);
            if (resolved) {
                videoId = resolved.videoId;
                title = resolved.title;
                isLive = resolved.isLive;
                showToast(isLive ? '🔴' : '📹', isLive ? `Стрим: ${title}` : `Последнее видео: ${title}`, 3000);
            } else {
                showToast('❌', 'Канал не найден. Попробуй другой сервер.', 5000);
                shakeInput();
                return;
            }
        }

        if (videoId) {
            openYoutubeInBrowser(videoId, title, isLive);
            addToHistory(url, currentPlatform);
            return;
        }

        showToast('❌', 'Не удалось распознать видео.', 4000);
        shakeInput();
        return;
    }

    // ==========================================
    // VK / Twitch — embed через iframe
    // ==========================================
    const embedUrl = platform.buildEmbed(parsed);
    if (!embedUrl) { showToast('❌', 'Не удалось построить ссылку.', 4000); shakeInput(); return; }

    const container = document.getElementById('playerContainer');
    const aspect = document.getElementById('playerAspect');
    const loading = document.getElementById('playerLoading');
    const nowPlaying = document.getElementById('nowPlaying');
    const nowValue = document.getElementById('nowPlayingValue');

    container.style.display = 'block';
    loading.classList.remove('player-loading--hidden');

    const oldIframe = aspect.querySelector('iframe');
    if (oldIframe) oldIframe.remove();
    const oldCard = aspect.querySelector('.yt-open-card');
    if (oldCard) oldCard.remove();

    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.setAttribute('frameborder', '0');

    const loadTimeout = setTimeout(() => loading.classList.add('player-loading--hidden'), 10000);
    iframe.onload = () => { clearTimeout(loadTimeout); setTimeout(() => loading.classList.add('player-loading--hidden'), 500); };

    aspect.appendChild(iframe);

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
window.toggleProxyList = toggleProxyList;
window.selectProxy = selectProxy;
window.openWatchUrl = openWatchUrl;
