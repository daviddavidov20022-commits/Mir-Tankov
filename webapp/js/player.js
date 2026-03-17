/**
 * МИР ТАНКОВ — Видеоплеер (player.js)
 * Встроенный просмотр YouTube (через Invidious прокси), VK Video, Twitch
 * 
 * YouTube проксируется через Invidious — обход замедления!
 * Invidious — открытый фронтенд для YouTube, серверы в Европе/Латинской Америке
 */

// ==========================================
// YOUTUBE ПРОКСИ (Invidious — проверенные инстансы)
// Данные с https://api.invidious.io/instances.json
// ==========================================
const YT_PROXIES = [
    // Проверенные Invidious инстансы (март 2026, uptime 99%+)
    { name: 'Invidious 🇩🇪 Германия', host: 'https://yewtu.be', type: 'invidious', flag: '🇩🇪' },
    { name: 'Invidious 🇺🇦 Украина', host: 'https://invidious.nerdvpn.de', type: 'invidious', flag: '🇺🇦' },
    { name: 'Invidious 🇨🇱 Чили', host: 'https://inv.nadeko.net', type: 'invidious', flag: '🇨🇱' },
    // Оригинальный YouTube (может не работать из-за замедления)
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
        placeholder: 'Вставь ссылку YouTube видео...',
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

// Быстрый доступ — каналы (только прямые ссылки, которые можно embed'ить!)
const QUICK_CHANNELS = [
    {
        name: 'ISERVERI',
        platform: 'twitch',
        url: 'https://www.twitch.tv/serverenok',
        icon: '💜',
        desc: 'Twitch стрим',
    },
    {
        name: 'iserveri',
        platform: 'vk',
        url: 'https://vk.com/video/@iserveri',
        icon: '💙',
        desc: 'VK Видео',
    },
    {
        name: 'ISERVERI',
        platform: 'youtube',
        url: 'https://www.youtube.com/@ISERVERI',
        icon: '🔴',
        desc: 'YouTube канал',
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

/**
 * Извлекает ID видео из любого YouTube URL
 * Поддерживает: watch?v=, youtu.be/, embed/, shorts/, live/
 * Возвращает null если это не ссылка на конкретное видео
 */
function extractYoutubeVideoId(url) {
    // youtu.be/ID
    let m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];

    // youtube.com/watch?v=ID
    m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];

    // youtube.com/embed/ID
    m = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];

    // youtube.com/shorts/ID
    m = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];

    // youtube.com/live/ID
    m = url.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];

    // Просто 11-символьный ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    return null;
}

function parseYoutubeUrl(url) {
    url = url.trim();

    // Пробуем извлечь ID видео
    const videoId = extractYoutubeVideoId(url);
    if (videoId) return { type: 'video', id: videoId };

    // youtube.com/@channel/live → live стрим
    let match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)\/live/i);
    if (match) return { type: 'channel_live', handle: match[1] };

    // youtube.com/@channel → страница канала (нельзя embed, откроем в Invidious)
    match = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel', handle: match[1] };

    // youtube.com/channel/ID
    match = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
    if (match) return { type: 'channel_id', id: match[1] };

    // Ссылка на поиск/плейлист — НЕ поддерживается для embed
    if (url.includes('youtube.com/results') || url.includes('search_query')) {
        return { type: 'error_search' };
    }

    if (url.includes('youtube.com/playlist')) {
        return { type: 'error_playlist' };
    }

    // Любая другая YouTube ссылка
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return { type: 'error_unknown' };
    }

    // Не YouTube ссылка — может быть название видео
    return { type: 'error_not_video' };
}

function buildYoutubeEmbed(parsed) {
    const proxy = YT_PROXIES[currentProxyIndex];
    const host = proxy.host;

    if (parsed.type === 'video') {
        // Основной кейс — конкретное видео по ID
        if (proxy.type === 'invidious') {
            return `${host}/embed/${parsed.id}?autoplay=1&quality=hd720&local=true`;
        }
        // YouTube оригинал
        return `${host}/embed/${parsed.id}?autoplay=1&rel=0`;
    }

    // Каналы и лайвы обрабатываются через resolveYoutubeChannel (async)
    // Здесь вернём null — playVideo() обработает
    return null;
}

/**
 * Найти стрим или последнее видео канала через Invidious API
 * Приоритет: активный лайв-стрим > последнее видео
 * Поддерживает @handle и channelId
 */
async function resolveYoutubeChannel(parsed) {
    const proxy = YT_PROXIES[currentProxyIndex];
    const host = proxy.host;

    // Если прокси — оригинальный YouTube, API нет
    if (proxy.type === 'youtube') {
        return null;
    }

    try {
        let channelId = null;

        // Если у нас handle — сначала ищем канал
        if (parsed.type === 'channel' || parsed.type === 'channel_live') {
            const handle = parsed.handle;
            const searchResp = await fetch(`${host}/api/v1/search?q=${encodeURIComponent('@' + handle)}&type=channel`, {
                signal: AbortSignal.timeout(8000)
            });
            if (!searchResp.ok) throw new Error('Search API failed');
            const searchData = await searchResp.json();
            if (searchData.length > 0 && searchData[0].authorId) {
                channelId = searchData[0].authorId;
            }
        } else if (parsed.type === 'channel_id') {
            channelId = parsed.id;
        }

        if (!channelId) {
            return null;
        }

        // 1) Сначала ищем АКТИВНЫЙ СТРИМ
        try {
            const streamsResp = await fetch(`${host}/api/v1/channels/${channelId}/streams`, {
                signal: AbortSignal.timeout(8000)
            });
            if (streamsResp.ok) {
                const streamsData = await streamsResp.json();
                const streams = streamsData.videos || streamsData;
                // Ищем стрим с liveNow === true
                const liveStream = streams.find(v => v.liveNow === true);
                if (liveStream && liveStream.videoId) {
                    return {
                        embedUrl: `${host}/embed/${liveStream.videoId}?autoplay=1&quality=hd720&local=true`,
                        title: liveStream.title || '🔴 Прямая трансляция',
                        channelName: liveStream.author || parsed.handle || 'Канал',
                        isLive: true,
                    };
                }
            }
        } catch (e) {
            console.warn('[resolveYoutubeChannel] Streams endpoint error:', e.message);
        }

        // 2) Проверяем последние видео — может быть лайв среди них
        try {
            const videosResp = await fetch(`${host}/api/v1/channels/${channelId}/videos?sort_by=newest`, {
                signal: AbortSignal.timeout(8000)
            });
            if (videosResp.ok) {
                const videosData = await videosResp.json();
                const videos = videosData.videos || videosData;
                
                // Сначала ищем live среди видео
                const liveVideo = videos.find(v => v.liveNow === true);
                if (liveVideo && liveVideo.videoId) {
                    return {
                        embedUrl: `${host}/embed/${liveVideo.videoId}?autoplay=1&quality=hd720&local=true`,
                        title: liveVideo.title || '🔴 Прямая трансляция',
                        channelName: liveVideo.author || parsed.handle || 'Канал',
                        isLive: true,
                    };
                }

                // Если лайва нет — берём последнее видео
                if (videos.length > 0 && videos[0].videoId) {
                    return {
                        embedUrl: `${host}/embed/${videos[0].videoId}?autoplay=1&quality=hd720&local=true`,
                        title: videos[0].title || 'Последнее видео',
                        channelName: videos[0].author || parsed.handle || 'Канал',
                        isLive: false,
                    };
                }
            }
        } catch (e) {
            console.warn('[resolveYoutubeChannel] Videos endpoint error:', e.message);
        }

        return null;
    } catch (e) {
        console.warn('[resolveYoutubeChannel] Error:', e.message);
        return null;
    }
}

function parseVkUrl(url) {
    url = url.trim();

    // vk.com/video-XXXXX_XXXXX
    let match = url.match(/video(-?\d+)_(\d+)/);
    if (match) return { type: 'video', oid: match[1], id: match[2] };

    // vk.com/video_ext.php?oid=XXX&id=XXX&hash=XXX
    match = url.match(/video_ext\.php\?(.+)/);
    if (match) return { type: 'ext', params: match[1] };

    // vk.com/video/@user — страница канала, не конкретное видео
    match = url.match(/vk\.com\/video\/@([a-zA-Z0-9_]+)/);
    if (match) return { type: 'user', username: match[1] };

    if (url.includes('vk.com')) {
        return { type: 'raw', url: url };
    }

    return { type: 'error', query: url };
}

function buildVkEmbed(parsed) {
    if (parsed.type === 'video') {
        return `https://vk.com/video_ext.php?oid=${parsed.oid}&id=${parsed.id}&hd=2`;
    }
    if (parsed.type === 'ext') {
        return `https://vk.com/video_ext.php?${parsed.params}`;
    }
    return null;
}

function parseTwitchUrl(url) {
    url = url.trim();

    // twitch.tv/videos/ID
    let match = url.match(/twitch\.tv\/videos\/(\d+)/i);
    if (match) return { type: 'video', id: match[1] };

    // twitch.tv/channel
    match = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (match && match[1].toLowerCase() !== 'videos') return { type: 'channel', name: match[1] };

    // Просто имя канала
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
// ПРОКСИ-СЕЛЕКТОР (Выбор сервера YouTube)
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
                    ✅ Прокси-сервер — YouTube работает без ограничений
                </div>
            ` : `
                <div class="proxy-selector__status proxy-selector__status--warn">
                    ⚠️ Оригинал — может не работать из-за замедления YouTube в РФ
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
                    💡 Если видео не грузится — попробуй другой сервер<br>
                    📌 Нужна ссылка на <b>конкретное видео</b>, не на поиск/канал
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

    // Если уже что-то играет — перезапустить с новым прокси
    if (isPlaying && currentPlatform === 'youtube') {
        playVideo();
    }

    try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (e) { }
}

// ==========================================
// ВОСПРОИЗВЕДЕНИЕ
// ==========================================
async function playVideo() {
    const input = document.getElementById('urlInput');
    const url = input.value.trim();

    if (!url) {
        shakeInput();
        showToast('⚠️', 'Вставь ссылку на видео!');
        return;
    }

    const platform = PLATFORMS[currentPlatform];
    const parsed = platform.parseUrl(url);

    // Обработка ошибок парсинга (YouTube)
    if (parsed.type === 'error_search') {
        showToast('❌', 'Ссылка на поиск YouTube не поддерживается! Вставь ссылку на конкретное видео.', 5000);
        shakeInput();
        return;
    }
    if (parsed.type === 'error_playlist') {
        showToast('❌', 'Плейлисты пока не поддерживаются. Вставь ссылку на конкретное видео.', 5000);
        shakeInput();
        return;
    }
    if (parsed.type === 'error_not_video') {
        showToast('❌', 'Нужна ссылка на конкретное видео! Пример: youtube.com/watch?v=xxxxx', 5000);
        shakeInput();
        return;
    }
    if (parsed.type === 'error_unknown' || parsed.type === 'error') {
        showToast('❌', 'Не удалось распознать ссылку. Вставь ссылку на видео.', 5000);
        shakeInput();
        return;
    }

    // VK: каналы нельзя embed'ить
    if (currentPlatform === 'vk' && (parsed.type === 'user' || parsed.type === 'raw')) {
        showToast('❌', 'Вставь ссылку на конкретное видео VK! Пример: vk.com/video-123_456', 5000);
        shakeInput();
        return;
    }

    let embedUrl = platform.buildEmbed(parsed);
    let resolvedInfo = null;

    // YouTube: каналы — ищем стрим или последнее видео через API
    if (!embedUrl && currentPlatform === 'youtube' &&
        (parsed.type === 'channel' || parsed.type === 'channel_id' || parsed.type === 'channel_live')) {
        showToast('🔍', 'Ищу стрим или видео канала...', 6000);
        const resolved = await resolveYoutubeChannel(parsed);
        if (resolved) {
            embedUrl = resolved.embedUrl;
            resolvedInfo = resolved;
            if (resolved.isLive) {
                showToast('🔴', `Стрим: ${resolved.title}`, 3000);
            } else {
                showToast('📹', `Стрим не найден. Последнее видео: ${resolved.title}`, 4000);
            }
        } else {
            showToast('❌', 'Канал не найден или нет видео. Попробуй другой сервер или вставь прямую ссылку.', 5000);
            shakeInput();
            return;
        }
    }

    if (!embedUrl) {
        showToast('❌', 'Не удалось построить ссылку. Попробуй другую ссылку.', 4000);
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

    // Показать информацию о том, что играет
    let displayText = url;
    if (resolvedInfo) {
        const liveTag = resolvedInfo.isLive ? '🔴 LIVE' : '📹';
        displayText = `${liveTag} ${resolvedInfo.title}`;
    } else if (currentPlatform === 'youtube') {
        const proxy = YT_PROXIES[currentProxyIndex];
        if (proxy.type !== 'youtube') {
            displayText = `через ${proxy.name}`;
        }
    }

    // Если iframe не загрузился за 10 сек — предложить сменить прокси
    const loadTimeout = setTimeout(() => {
        loading.classList.add('player-loading--hidden');
        if (currentPlatform === 'youtube') {
            const proxy = YT_PROXIES[currentProxyIndex];
            if (proxy.type !== 'youtube') {
                showToast('💡', 'Долго грузится? Попробуй другой сервер ↓', 5000);
            } else {
                showToast('💡', 'YouTube замедлен. Выбери прокси-сервер выше!', 5000);
            }
        }
    }, 10000);

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
