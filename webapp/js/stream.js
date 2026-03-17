/**
 * МИР ТАНКОВ — Стрим-хаб (stream.js)
 * Twitch стрим + мультиплатформенный чат
 * Админ: управление списком каналов
 */

// ==========================================
// КОНФИГУРАЦИЯ
// ==========================================
const DEFAULT_CHANNEL = 'iserveri';
const TWITCH_WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_CHAT_MESSAGES = 200;
// API URL — определяем автоматически (как в top-page.js)
const BOT_API_URL = (() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('api') || localStorage.getItem('api_host');
    if (host) return host;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://${window.location.hostname}:8081`;
    }
    const savedApi = localStorage.getItem('api_url');
    if (savedApi) return savedApi;
    return 'https://mir-tankov-api.onrender.com';
})();

// Каналы по умолчанию (если localStorage пуст)
const DEFAULT_CHANNELS = [
    { name: 'ISERVERI', channel: 'iserveri', desc: 'Мир Танков' },
];

// Загружаем каналы из localStorage (или defaults)
let savedChannels = null;
try {
    const raw = localStorage.getItem('stream_channels');
    if (raw) savedChannels = JSON.parse(raw);
} catch (e) { }
let CHANNELS = savedChannels || [...DEFAULT_CHANNELS];

let currentChannel = DEFAULT_CHANNEL;
let currentPlatform = 'twitch';
let twitchWs = null;
let chatMessages = [];
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let isAdmin = false;
let myTelegramId = 0;
let myUsername = 'Танкист';
let platformChatVisible = false;

const DEFAULT_COLORS = [
    '#FF4500', '#00FF7F', '#1E90FF', '#9ACD32', '#FF69B4',
    '#FFD700', '#00CED1', '#FF6347', '#8A2BE2', '#2E8B57',
    '#DAA520', '#D2691E', '#5F9EA0', '#FF7F50', '#6495ED',
];

let lastChatTimestamp = 0;
let chatPollInterval = null;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initUser();
    identifyMe();
    createParticles();
    loadChannelsFromServer();
    loadStreamConfig();
    initPlayer();
    connectTwitchChat();
    initChatInput();
    checkAdmin();
    startChatPolling();
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

function identifyMe() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('telegram_id');
    if (urlId) { myTelegramId = parseInt(urlId); return; }

    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        myUsername = tg.initDataUnsafe.user.first_name || 'Танкист';
        localStorage.setItem('my_telegram_id', String(myTelegramId));
        return;
    }

    const saved = localStorage.getItem('my_telegram_id');
    if (saved) myTelegramId = parseInt(saved);
}

async function checkAdmin() {
    const debugEl = document.getElementById('adminDebug');
    
    if (!myTelegramId) {
        if (debugEl) debugEl.textContent = '⚠️ telegram_id не определён';
        return;
    }
    
    try {
        const url = `${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`;
        if (debugEl) debugEl.textContent = `🔍 Проверка: tg_id=${myTelegramId}, url=${BOT_API_URL}`;
        
        const resp = await fetch(url);
        const data = await resp.json();
        
        if (data.is_admin) {
            isAdmin = true;
            const adminPanel = document.getElementById('adminPanel');
            if (adminPanel) adminPanel.style.display = 'block';
            if (debugEl) debugEl.textContent = `✅ Админ! tg_id=${myTelegramId}`;
        } else {
            if (debugEl) debugEl.textContent = `❌ Не админ. tg_id=${myTelegramId}, resp: ${JSON.stringify(data).substring(0, 80)}`;
        }
    } catch (e) {
        if (debugEl) debugEl.textContent = `❌ API ошибка: ${e.message} | URL: ${BOT_API_URL}`;
        setTimeout(() => checkAdmin(), 3000);
    }
}

function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 15; i++) {
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
// МУЛЬТИПЛАТФОРМЕННЫЙ ПЛЕЕР
// ==========================================
function initPlayer() {
    const iframe = document.getElementById('streamPlayerIframe');
    if (!iframe) return;
    const parent = window.location.hostname || 'localhost';

    if (currentPlatform === 'twitch') {
        iframe.src = `https://player.twitch.tv/?channel=${currentChannel}&parent=${parent}&muted=false`;
    } else if (currentPlatform === 'vk') {
        // VK Video embed: поддерживает прямые трансляции
        iframe.src = `https://vk.com/video_ext.php?oid=${currentChannel}&hd=2&autoplay=1`;
    } else if (currentPlatform === 'youtube') {
        iframe.src = `https://www.youtube.com/embed/live_stream?channel=${currentChannel}&autoplay=1`;
    }
    
    updatePlatformChat();
}

function switchPlatform(platform) {
    currentPlatform = platform;
    
    // Обновить табы
    document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.toggle('platform-tab--active', tab.dataset.platform === platform);
    });
    
    // Обновить placeholder канала
    const channelInput = document.getElementById('channelInput');
    if (channelInput) {
        if (platform === 'twitch') channelInput.placeholder = 'Имя канала или twitch.tv/...';
        else if (platform === 'vk') channelInput.placeholder = 'Ссылка VK стрима (vk.com/video...)';
        else if (platform === 'youtube') channelInput.placeholder = 'Ссылка YouTube или ID канала';
    }
    
    // Обновить индикатор платформы у чата
    const platformInfo = document.getElementById('chatPlatformInfo');
    const chatInput = document.getElementById('chatInput');
    if (platformInfo) {
        if (platform === 'twitch') {
            platformInfo.textContent = '💜 → Twitch';
            platformInfo.style.color = '#9146FF';
        } else if (platform === 'vk') {
            platformInfo.textContent = '🔵 → VK';
            platformInfo.style.color = '#0077FF';
        } else if (platform === 'youtube') {
            platformInfo.textContent = '🔴 → YouTube';
            platformInfo.style.color = '#FF0000';
        }
    }
    if (chatInput) chatInput.placeholder = `Написать в ${platform.toUpperCase()}...`;
    
    // Twitch IRC чат только для Twitch
    if (platform === 'twitch') {
        connectTwitchChat();
    } else {
        disconnectTwitchChat();
    }
    
    addSystemMessage(`Платформа: ${platform.toUpperCase()}`);
    showToast(platform === 'twitch' ? '💜' : platform === 'vk' ? '🔵' : '🔴', `${platform.toUpperCase()}`);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch(e) {}
}

function updatePlatformChat() {
    const embed = document.getElementById('platformChatEmbed');
    const iframe = document.getElementById('platformChatIframe');
    const title = document.getElementById('platformChatTitle');
    const parent = window.location.hostname || 'localhost';
    
    if (currentPlatform === 'twitch') {
        if (title) title.textContent = '💜 Чат Twitch (войди чтобы писать)';
        if (iframe) iframe.src = `https://www.twitch.tv/embed/${currentChannel}/chat?parent=${parent}&darkpopout`;
    } else if (currentPlatform === 'vk') {
        if (title) title.textContent = '🔵 Чат VK (войди чтобы писать)';
        if (iframe) iframe.src = '';
    } else if (currentPlatform === 'youtube') {
        if (title) title.textContent = '🔴 Чат YouTube (войди чтобы писать)';
        if (iframe) iframe.src = '';
    }
}

function togglePlatformChat() {
    const embed = document.getElementById('platformChatEmbed');
    if (!embed) return;
    platformChatVisible = !platformChatVisible;
    embed.style.display = platformChatVisible ? 'block' : 'none';
    if (platformChatVisible) updatePlatformChat();
}

/**
 * Извлечь имя канала из ссылки или текста
 */
function extractTwitchChannel(input) {
    input = input.trim();
    const match = input.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (match) return match[1].toLowerCase();
    const clean = input.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return clean || null;
}

function changeChannel(channelName) {
    let newChannel;
    if (channelName) {
        newChannel = channelName;
    } else {
        const input = document.getElementById('channelInput');
        newChannel = extractTwitchChannel(input.value);
    }
    if (!newChannel) { showToast('❌', 'Введи имя канала!'); return; }

    currentChannel = newChannel;
    
    initPlayer();
    if (currentPlatform === 'twitch') {
        disconnectTwitchChat();
        connectTwitchChat();
    }
    
    document.getElementById('streamTitle').textContent = newChannel.toUpperCase();
    document.getElementById('channelSettings').style.display = 'none';
    document.getElementById('channelInput').value = newChannel;
    
    addSystemMessage(`Канал переключён на ${newChannel}`);
    showToast('📺', `Канал: ${newChannel}`);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch (e) { }
}

function toggleChannelSettings() {
    const el = document.getElementById('channelSettings');
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (isHidden) renderPopularChannels();
}

function renderPopularChannels() {
    const container = document.getElementById('popularChannels');
    if (!container) return;
    container.innerHTML = CHANNELS.map(ch => `
        <button class="popular-ch ${ch.channel === currentChannel ? 'popular-ch--active' : ''}" 
                onclick="changeChannel('${ch.channel}')">
            <span class="popular-ch__name">${escapeHtml(ch.name)}</span>
            <span class="popular-ch__desc">${escapeHtml(ch.desc)}</span>
        </button>
    `).join('');
}

// ==========================================
// АДМИН: УПРАВЛЕНИЕ КАНАЛАМИ
// ==========================================
function saveChannels() {
    localStorage.setItem('stream_channels', JSON.stringify(CHANNELS));
    syncChannelsToServer();
}

function addChannel() {
    const nameInput = document.getElementById('adminChName');
    const urlInput = document.getElementById('adminChUrl');
    const descInput = document.getElementById('adminChDesc');

    const name = nameInput.value.trim();
    const channelRaw = urlInput.value.trim();
    const desc = descInput.value.trim() || 'Стрим';

    if (!name) { showToast('❌', 'Введи название канала!'); return; }
    if (!channelRaw) { showToast('❌', 'Введи ссылку или имя Twitch!'); return; }

    const channel = extractTwitchChannel(channelRaw);
    if (!channel) { showToast('❌', 'Не удалось определить канал!'); return; }

    // Проверка дубликатов
    if (CHANNELS.some(ch => ch.channel === channel)) {
        showToast('⚠️', `${channel} уже добавлен!`);
        return;
    }

    CHANNELS.push({ name, channel, desc });
    saveChannels();
    renderAdminChannelList();
    renderPopularChannels();

    // Очистка полей
    nameInput.value = '';
    urlInput.value = '';
    descInput.value = '';

    showToast('✅', `Канал ${name} добавлен!`);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch (e) { }
}

function removeChannel(index) {
    if (index < 0 || index >= CHANNELS.length) return;
    const ch = CHANNELS[index];
    CHANNELS.splice(index, 1);
    saveChannels();
    renderAdminChannelList();
    renderPopularChannels();
    showToast('🗑', `Канал ${ch.name} удалён`);
}

function moveChannel(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= CHANNELS.length) return;
    [CHANNELS[index], CHANNELS[newIndex]] = [CHANNELS[newIndex], CHANNELS[index]];
    saveChannels();
    renderAdminChannelList();
    renderPopularChannels();
}

function renderAdminChannelList() {
    const list = document.getElementById('adminChannelList');
    if (!list) return;

    if (CHANNELS.length === 0) {
        list.innerHTML = '<div style="color:#5A6577;font-size:0.75rem;text-align:center;padding:12px;">Нет каналов</div>';
        return;
    }

    list.innerHTML = CHANNELS.map((ch, i) => `
        <div class="admin-ch-item">
            <div class="admin-ch-item__info">
                <span class="admin-ch-item__name">${escapeHtml(ch.name)}</span>
                <span class="admin-ch-item__channel">twitch.tv/${escapeHtml(ch.channel)}</span>
                <span class="admin-ch-item__desc">${escapeHtml(ch.desc)}</span>
            </div>
            <div class="admin-ch-item__actions">
                ${i > 0 ? `<button class="admin-ch-btn" onclick="moveChannel(${i}, -1)" title="Вверх">↑</button>` : ''}
                ${i < CHANNELS.length - 1 ? `<button class="admin-ch-btn" onclick="moveChannel(${i}, 1)" title="Вниз">↓</button>` : ''}
                <button class="admin-ch-btn admin-ch-btn--delete" onclick="removeChannel(${i})" title="Удалить">✕</button>
            </div>
        </div>
    `).join('');
}

function toggleAdminPanel() {
    const panel = document.getElementById('adminPanel');
    if (!panel) return;
    const content = document.getElementById('adminPanelContent');
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (isHidden) renderAdminChannelList();
}

// ==========================================
// TWITCH CHAT (WebSocket IRC)
// ==========================================
function disconnectTwitchChat() {
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    if (twitchWs) {
        try { twitchWs.close(); } catch(e) {}
        twitchWs = null;
    }
    isConnected = false;
    updateConnectionStatus('offline');
}

function connectTwitchChat() {
    if (twitchWs && twitchWs.readyState === WebSocket.OPEN) return;

    addSystemMessage(`Подключение к чату ${currentChannel}...`);
    updateConnectionStatus('connecting');

    try {
        twitchWs = new WebSocket(TWITCH_WS_URL);
    } catch (e) {
        addSystemMessage('❌ Ошибка подключения к Twitch');
        scheduleReconnect();
        return;
    }

    twitchWs.onopen = () => {
        twitchWs.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        twitchWs.send('PASS SCHMOOPIIE');
        twitchWs.send('NICK justinfan' + Math.floor(Math.random() * 100000));
        twitchWs.send('JOIN #' + currentChannel);
        
        isConnected = true;
        reconnectAttempts = 0;
        updateConnectionStatus('connected');
        addSystemMessage(`✅ Подключено к чату ${currentChannel}`);
    };

    twitchWs.onmessage = (event) => {
        const lines = event.data.split('\r\n');
        for (const line of lines) {
            if (!line) continue;
            if (line.startsWith('PING')) {
                twitchWs.send('PONG :tmi.twitch.tv');
                continue;
            }
            if (line.includes('PRIVMSG')) parseTwitchMessage(line);
            if (line.includes('USERNOTICE')) parseTwitchNotice(line);
        }
    };

    twitchWs.onerror = () => {
        console.warn('[TwitchChat] WebSocket error');
    };

    twitchWs.onclose = () => {
        isConnected = false;
        updateConnectionStatus('disconnected');
        if (reconnectAttempts < 10) {
            scheduleReconnect();
        } else {
            addSystemMessage('❌ Не удалось подключиться. Обнови страницу.');
        }
    };
}

function disconnectTwitchChat() {
    if (twitchWs) { twitchWs.close(); twitchWs = null; }
    isConnected = false;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
}

function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    addSystemMessage(`🔄 Переподключение через ${Math.round(delay / 1000)}с...`);
    reconnectTimeout = setTimeout(() => connectTwitchChat(), delay);
}

function updateConnectionStatus(status) {
    const badge = document.getElementById('chatBadgeTwitch');
    if (!badge) return;
    if (status === 'connected') {
        badge.className = 'chat-platform-badge chat-platform-badge--twitch chat-platform-badge--active';
        badge.textContent = '💜 Twitch ●';
    } else if (status === 'connecting') {
        badge.className = 'chat-platform-badge chat-platform-badge--twitch';
        badge.textContent = '💜 Twitch ○';
    } else {
        badge.className = 'chat-platform-badge chat-platform-badge--twitch chat-platform-badge--offline';
        badge.textContent = '💜 Twitch ✕';
    }
}

// ==========================================
// ПАРСИНГ TWITCH IRC
// ==========================================
function parseTwitchMessage(raw) {
    try {
        let tags = {};
        let rest = raw;
        if (raw.startsWith('@')) {
            const spaceIdx = raw.indexOf(' ');
            const tagStr = raw.substring(1, spaceIdx);
            rest = raw.substring(spaceIdx + 1);
            tagStr.split(';').forEach(pair => {
                const [k, v] = pair.split('=');
                tags[k] = v || '';
            });
        }

        const msgMatch = rest.match(/PRIVMSG\s+#\S+\s+:(.+)/);
        if (!msgMatch) return;

        const text = msgMatch[1].trim();
        const displayName = tags['display-name'] || 'Unknown';
        const color = tags['color'] || getRandomColor(displayName);
        const isMod = tags['mod'] === '1';
        const isSub = tags['subscriber'] === '1';
        const isVip = (tags['badges'] || '').includes('vip');
        const isBroadcaster = (tags['badges'] || '').includes('broadcaster');

        let badges = '';
        if (isBroadcaster) badges += '🎬';
        else if (isMod) badges += '🗡️';
        if (isVip) badges += '💎';
        if (isSub) badges += '⭐';

        addChatMessage({
            platform: 'twitch',
            username: displayName,
            text: text,
            color: color,
            badges: badges,
            time: new Date(),
        });
    } catch (e) {
        console.warn('[TwitchChat] Parse error:', e);
    }
}

function parseTwitchNotice(raw) {
    try {
        let tags = {};
        if (raw.startsWith('@')) {
            const spaceIdx = raw.indexOf(' ');
            const tagStr = raw.substring(1, spaceIdx);
            tagStr.split(';').forEach(pair => {
                const [k, v] = pair.split('=');
                tags[k] = v || '';
            });
        }
        const msgType = tags['msg-id'] || '';
        const displayName = tags['display-name'] || '';
        if (msgType === 'sub' || msgType === 'resub') addSystemMessage(`⭐ ${displayName} подписался!`);
        else if (msgType === 'raid') addSystemMessage(`🚀 Рейд от ${displayName}!`);
        else if (msgType === 'subgift') addSystemMessage(`🎁 ${displayName} подарил подписку!`);
    } catch (e) { }
}

function getRandomColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

// ==========================================
// ЧАТ UI
// ==========================================
function addChatMessage(msg) {
    chatMessages.push(msg);
    if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
    renderChatMessage(msg);
}

function renderChatMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `chat-msg chat-msg--${msg.platform}`;
    const platformIcon = msg.platform === 'twitch' ? '💜' : '📱';
    const timeStr = msg.time.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

    el.innerHTML = `
        <span class="chat-msg__platform">${platformIcon}</span>
        <span class="chat-msg__badges">${msg.badges || ''}</span>
        <span class="chat-msg__name" style="color: ${msg.color}">${escapeHtml(msg.username)}</span>
        <span class="chat-msg__separator">:</span>
        <span class="chat-msg__text">${escapeHtml(msg.text)}</span>
        <span class="chat-msg__time">${timeStr}</span>
    `;

    container.appendChild(el);
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) container.scrollTop = container.scrollHeight;
    while (container.children.length > MAX_CHAT_MESSAGES + 10) container.removeChild(container.firstChild);
}

function addSystemMessage(text) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'chat-system-msg';
    el.innerHTML = `<span class="chat-system-msg__icon">🎮</span><span>${escapeHtml(text)}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

// ==========================================
// ОТПРАВКА СООБЩЕНИЙ
// ==========================================
function initChatInput() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    const username = user?.first_name || 'Танкист';

    // Показываем сразу локально
    addChatMessage({
        platform: 'telegram',
        username: username,
        text: text,
        color: '#29B6F6',
        badges: '📱',
        time: new Date(),
        local: true,
    });

    input.value = '';
    try { tg?.HapticFeedback?.impactOccurred('light'); } catch (e) { }

    // Отправляем на сервер (общий чат + Twitch)
    if (myTelegramId) {
        try {
            // 1. В общий чат (видят все пользователи webapp)
            fetch(`${BOT_API_URL}/api/stream/chat/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_id: myTelegramId, username, text }),
            });

            // 2. В Twitch чат (видят все на Twitch)
            fetch(`${BOT_API_URL}/api/stream/chat/twitch-send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: currentChannel, username, text }),
            });
        } catch (e) {
            console.warn('[Chat] Send error:', e);
        }
    }
}

function toggleChatPlatform() {
    showToast('📱', 'Отправка через Telegram');
}

// ==========================================
// POLLING ТЕЛЕГРАМ СООБЩЕНИЙ
// ==========================================
function startChatPolling() {
    if (chatPollInterval) clearInterval(chatPollInterval);
    chatPollInterval = setInterval(pollChatMessages, 2000);
}

const shownMessageIds = new Set();

async function pollChatMessages() {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/chat?after=${lastChatTimestamp}`);
        const data = await resp.json();
        if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
                // Пропускаем свои сообщения (уже показаны локально)
                if (msg.telegram_id === myTelegramId) {
                    lastChatTimestamp = Math.max(lastChatTimestamp, msg.timestamp);
                    continue;
                }
                // Пропускаем дубликаты
                if (shownMessageIds.has(msg.id)) continue;
                shownMessageIds.add(msg.id);

                addChatMessage({
                    platform: 'telegram',
                    username: msg.username,
                    text: msg.text,
                    color: '#29B6F6',
                    badges: '📱',
                    time: new Date(msg.timestamp * 1000),
                });
                lastChatTimestamp = Math.max(lastChatTimestamp, msg.timestamp);
            }
        }
    } catch (e) {
        // Тихо — не спамим ошибками
    }
}

// ==========================================
// ЗАГРУЗКА КАНАЛОВ С СЕРВЕРА
// ==========================================
async function loadChannelsFromServer() {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/channels`);
        const data = await resp.json();
        if (data.channels && data.channels.length > 0) {
            CHANNELS = data.channels;
        }
    } catch (e) {
        console.warn('[Channels] Load error, using defaults');
    }
}

async function syncChannelsToServer() {
    if (!isAdmin || !myTelegramId) return;
    try {
        await fetch(`${BOT_API_URL}/api/stream/channels/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, channels: CHANNELS }),
        });
    } catch (e) {
        console.warn('[Channels] Sync error:', e);
    }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ
// ==========================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

// ==========================================
// КОНФИГ ТРАНСЛЯЦИИ (АДМИН)
// ==========================================
function saveStreamConfig() {
    const config = {
        twitch: {
            enabled: document.getElementById('adminTwitchEnabled')?.checked || false,
            channel: document.getElementById('adminTwitchChannel')?.value?.trim() || '',
        },
        youtube: {
            enabled: document.getElementById('adminYoutubeEnabled')?.checked || false,
            channel: document.getElementById('adminYoutubeChannel')?.value?.trim() || '',
        },
        vk: {
            enabled: document.getElementById('adminVkEnabled')?.checked || false,
            channel: document.getElementById('adminVkChannel')?.value?.trim() || '',
        },
    };
    
    localStorage.setItem('stream_config', JSON.stringify(config));
    
    // Сохранить на сервер (серверный TwitchReader переключится автоматически)
    if (myTelegramId) {
        fetch(`${BOT_API_URL}/api/stream/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, config }),
        }).catch(e => console.warn('[Config] Save error'));
    }
    
    applyStreamConfig(config);
    showToast('💾', 'Настройки сохранены!');
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch(e) {}
}

async function loadStreamConfig() {
    // Сначала из сервера
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/config`);
        const data = await resp.json();
        if (data.config) {
            applyStreamConfig(data.config);
            fillAdminForm(data.config);
            localStorage.setItem('stream_config', JSON.stringify(data.config));
            return;
        }
    } catch(e) {}
    
    // Fallback: localStorage
    try {
        const raw = localStorage.getItem('stream_config');
        if (raw) {
            const config = JSON.parse(raw);
            applyStreamConfig(config);
            fillAdminForm(config);
        }
    } catch(e) {}
}

function fillAdminForm(config) {
    if (config.twitch) {
        const el = document.getElementById('adminTwitchEnabled');
        if (el) el.checked = config.twitch.enabled;
        const ch = document.getElementById('adminTwitchChannel');
        if (ch && config.twitch.channel) ch.value = config.twitch.channel;
    }
    if (config.youtube) {
        const el = document.getElementById('adminYoutubeEnabled');
        if (el) el.checked = config.youtube.enabled;
        const ch = document.getElementById('adminYoutubeChannel');
        if (ch && config.youtube.channel) ch.value = config.youtube.channel;
    }
    if (config.vk) {
        const el = document.getElementById('adminVkEnabled');
        if (el) el.checked = config.vk.enabled;
        const ch = document.getElementById('adminVkChannel');
        if (ch && config.vk.channel) ch.value = config.vk.channel;
    }
}

function applyStreamConfig(config) {
    // Показывать/скрывать вкладки платформ
    document.querySelectorAll('.platform-tab').forEach(tab => {
        const platform = tab.dataset.platform;
        if (config[platform]) {
            tab.style.display = config[platform].enabled ? 'flex' : 'none';
        }
    });
}

function updateStreamConfig() {
    // Вызывается при изменении полей — подсветка
}

// ==========================================
// ДОНАТЫ И ЗАКАЗ МУЗЫКИ
// ==========================================
async function getMyCheeseBalance() {
    if (!myTelegramId) {
        identifyMe(); // Пробуем определить ID еще раз
    }
    
    if (!myTelegramId) return 0;

    try {
        // Пробуем получить с сервера
        const resp = await fetch(`${BOT_API_URL}/api/profile?telegram_id=${myTelegramId}`);
        if (!resp.ok) throw new Error('API error');
        
        const data = await resp.json();
        // Проверяем все возможные поля баланса
        const balance = data.cheese ?? data.coins ?? data.balance ?? 0;
        
        // Обновляем локальный кеш на всякий случай
        try {
            const local = JSON.parse(localStorage.getItem(`mt_data_${myTelegramId}`) || '{}');
            local.coins = balance;
            localStorage.setItem(`mt_data_${myTelegramId}`, JSON.stringify(local));
        } catch(e) {}
        
        return balance;
    } catch(e) {
        console.warn("Falling back to local storage for balance:", e);
        // Fallback: localStorage
        try {
            // Ищем в разных ключах, которые могут быть в приложении
            const local = JSON.parse(localStorage.getItem(`mt_data_${myTelegramId}`) || localStorage.getItem('userData') || '{}');
            return local.coins || local.cheese || 0;
        } catch(e2) { return 0; }
    }
}

async function openDonateModal() {
    document.getElementById('donateModal').style.display = 'flex';
    const balance = await getMyCheeseBalance();
    if (isAdmin) {
        document.getElementById('donateBalance').textContent = `Баланс: ∞ 🧀 (ADMIN — бесплатно)`;
    } else {
        document.getElementById('donateBalance').textContent = `Баланс: ${balance} 🧀`;
    }
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch(e) {}
}

function closeDonateModal() {
    document.getElementById('donateModal').style.display = 'none';
}

function setDonateAmount(val) {
    document.getElementById('donateAmount').value = val;
    try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch(e) {}
}

async function sendDonate() {
    const amount = parseInt(document.getElementById('donateAmount').value) || 0;
    const message = document.getElementById('donateMessage').value.trim();
    
    if (amount < 10) {
        showToast('❌', 'Минимум 10 🧀');
        return;
    }
    
    if (!myTelegramId) {
        showToast('❌', 'Нужна авторизация через Telegram');
        return;
    }
    
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/donate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                username: myUsername || 'Танкист',
                amount: amount,
                message: message,
            }),
        });
        const data = await resp.json();
        
        if (data.success) {
            closeDonateModal();
            showToast('🧀', `Донат ${amount} 🧀 отправлен!`);
            document.getElementById('donateMessage').value = '';
            // Обновить баланс в localStorage
            try {
                const local = JSON.parse(localStorage.getItem(`mt_data_${myTelegramId}`) || '{}');
                local.coins = data.new_balance;
                localStorage.setItem(`mt_data_${myTelegramId}`, JSON.stringify(local));
            } catch(e) {}
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch(e) {}
        } else {
            showToast('❌', data.error || 'Ошибка доната');
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error'); } catch(e) {}
        }
    } catch(e) {
        showToast('❌', 'Ошибка сети');
    }
}

async function openMusicModal() {
    document.getElementById('musicModal').style.display = 'flex';
    const balance = await getMyCheeseBalance();
    document.getElementById('musicBalance').textContent = `Баланс: ${balance} 🧀`;
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch(e) {}
}

function closeMusicModal() {
    document.getElementById('musicModal').style.display = 'none';
}

async function sendMusicRequest() {
    const url = document.getElementById('musicUrl').value.trim();
    
    if (!url) {
        showToast('❌', 'Вставь ссылку на видео');
        return;
    }
    
    if (!myTelegramId) {
        showToast('❌', 'Нужна авторизация через Telegram');
        return;
    }
    
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/music/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                username: myUsername || 'Танкист',
                url: url,
                amount: 50,
            }),
        });
        const data = await resp.json();
        
        if (data.success) {
            closeMusicModal();
            showToast('🎵', 'Трек добавлен в очередь!');
            document.getElementById('musicUrl').value = '';
            try {
                const local = JSON.parse(localStorage.getItem(`mt_data_${myTelegramId}`) || '{}');
                local.coins = data.new_balance;
                localStorage.setItem(`mt_data_${myTelegramId}`, JSON.stringify(local));
            } catch(e) {}
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch(e) {}
        } else {
            showToast('❌', data.error || 'Ошибка заказа');
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error'); } catch(e) {}
        }
    } catch(e) {
        showToast('❌', 'Ошибка сети');
    }
}

// Expose globals
window.changeChannel = changeChannel;
window.toggleChannelSettings = toggleChannelSettings;
window.sendChatMessage = sendChatMessage;
window.togglePlatformChat = togglePlatformChat;
window.switchPlatform = switchPlatform;
window.goBack = goBack;
window.openGame = openGame;
window.addChannel = addChannel;
window.removeChannel = removeChannel;
window.moveChannel = moveChannel;
window.toggleAdminPanel = toggleAdminPanel;
window.saveStreamConfig = saveStreamConfig;
window.updateStreamConfig = updateStreamConfig;
window.openDonateModal = openDonateModal;
window.closeDonateModal = closeDonateModal;
window.setDonateAmount = setDonateAmount;
window.sendDonate = sendDonate;
window.openMusicModal = openMusicModal;
window.closeMusicModal = closeMusicModal;
window.sendMusicRequest = sendMusicRequest;
