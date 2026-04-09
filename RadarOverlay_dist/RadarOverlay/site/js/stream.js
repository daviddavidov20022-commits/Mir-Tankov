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
    const isLocalFile = window.location.protocol === 'file:';
    if (isLocalFile || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://127.0.0.1:8081`;
    }
    const savedApi = localStorage.getItem('api_url');
    if (savedApi) return savedApi;
    return 'https://mir-tankov-production.up.railway.app';
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
    const HARDCODED_ADMIN_ID = 6507474079;
    
    if (!myTelegramId) {
        if (debugEl) debugEl.textContent = '⚠️ telegram_id не определён';
        return;
    }
    
    // Fallback: показать шестерёнку по ID, даже если API лежит
    function showAdminUI() {
        isAdmin = true;
        const gearBtn = document.getElementById('adminGearBtn');
        if (gearBtn) gearBtn.style.display = 'block';
    }
    
    // Быстрый фоллбэк по хардкоду
    if (myTelegramId === HARDCODED_ADMIN_ID) {
        showAdminUI();
        if (debugEl) debugEl.textContent = `✅ Админ (local) tg_id=${myTelegramId}`;
    }
    
    try {
        const url = `${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`;
        const resp = await fetch(url);
        const data = await resp.json();
        
        if (data.is_admin) {
            showAdminUI();
            if (debugEl) debugEl.textContent = `✅ Админ! tg_id=${myTelegramId}`;
        }
    } catch (e) {
        if (debugEl) debugEl.textContent = `⚠️ API недоступен, локальный режим`;
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
    // В webapp используем превью-карточку вместо iframe
    // (iframe Twitch не работает в Telegram WebView)
    const preview = document.getElementById('streamPreview');
    if (preview) {
        updateStreamPreview(currentPlatform);
    }
    
    // Берём канал из конфига (сохранённого админом)
    const platformConfig = currentStreamConfig[currentPlatform] || {};
    const configChannel = platformConfig.channel || '';
    
    if (currentPlatform === 'twitch' && configChannel) {
        currentChannel = configChannel;
    }
    
    // Обновляем заголовок стрима
    const titleEl = document.getElementById('streamTitle');
    if (titleEl && configChannel) {
        const displayName = configChannel.replace(/^https?:\/\//, '').split('/').pop() || configChannel;
        titleEl.textContent = displayName.toUpperCase();
    }
    
    // Если в режиме виджета — обновляем виджет чата тоже
    if (currentChatMode === 'widget') {
        loadChatWidget();
    }
    
    updatePlatformChat();
}


function switchPlatform(platform) {
    currentPlatform = platform;
    
    // Обновить табы
    document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.toggle('platform-tab--active', tab.dataset.platform === platform);
    });
    
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
    
    // Обновляем плеер из конфига
    initPlayer();
    
    // Если в режиме виджета чата — обновляем виджет
    if (currentChatMode === 'widget') {
        loadChatWidget();
    }

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
    const platformIcons = { twitch: '💜', vkplay: '🔵', youtube: '🔴', telegram: '📱' };
    const platformIcon = platformIcons[msg.platform] || '💬';
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

                const platformColors = { twitch: '#9146FF', vkplay: '#0077FF', youtube: '#FF0000', telegram: '#29B6F6' };
                const platformBadges = { twitch: '', vkplay: '', youtube: '', telegram: '📱' };
                const plat = msg.platform || 'telegram';

                addChatMessage({
                    platform: plat,
                    username: msg.username,
                    text: msg.text,
                    color: msg.color || platformColors[plat] || '#29B6F6',
                    badges: msg.badges || platformBadges[plat] || '',
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
// ОТКРЫТИЕ СТРИМА В БРАУЗЕРЕ
// ==========================================
const STREAM_LINKS = {
    twitch: 'https://www.twitch.tv/serverenok',
    vk: 'https://live.vkvideo.ru/iserveri',
    youtube: 'https://www.youtube.com/@ISERVERI'
};

const STREAM_PREVIEW_DATA = {
    twitch: { icon: '💜', channel: 'SERVERENOK', platform: 'twitch.tv', color: '#9146FF', gradient: 'linear-gradient(135deg, #9146FF, #7B2FFF)' },
    vk: { icon: '🔵', channel: 'ISERVERI', platform: 'vk video', color: '#0077FF', gradient: 'linear-gradient(135deg, #0077FF, #0055CC)' },
    youtube: { icon: '🔴', channel: 'ISERVERI', platform: 'youtube.com', color: '#FF0000', gradient: 'linear-gradient(135deg, #FF0000, #CC0000)' }
};

function openStreamLink(platform) {
    const url = STREAM_LINKS[platform];
    if (!url) return;
    
    // Подсветим нажатую кнопку
    document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.toggle('platform-tab--active', tab.dataset.platform === platform);
    });
    
    // Обновим превью-карточку
    updateStreamPreview(platform);
    
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium'); } catch(e) {}
    
    // Открываем в браузере
    if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(url);
    } else {
        window.open(url, '_blank');
    }
}

function updateStreamPreview(platform) {
    const data = STREAM_PREVIEW_DATA[platform];
    if (!data) return;
    
    const embedWrap = document.getElementById('streamEmbedWrap');
    const embedIframe = document.getElementById('streamEmbedIframe');
    const scThumb = document.getElementById('scThumb');
    const scHint = document.getElementById('scHint');
    const icon = document.getElementById('previewIcon');
    const channel = document.getElementById('previewChannel');
    const platLabel = document.getElementById('previewPlatform');
    const glow = document.querySelector('.stream-preview__glow');
    
    // Проверяем есть ли embed URL из админ-настроек
    const platformConfig = currentStreamConfig[platform] || {};
    const embedUrl = platformConfig.embedUrl || '';  // Админ может вставить рабочий embed
    
    if (embedUrl) {
        // Есть настроенный embed — показываем iframe
        if (embedWrap && embedIframe) {
            embedIframe.src = embedUrl;
            embedWrap.style.display = 'block';
        }
        if (scThumb) scThumb.style.display = 'none';
        if (scHint) scHint.textContent = 'Смотри прямо здесь ↑';
    } else {
        // Нет embed — превью-карточка + открытие в браузере
        if (embedWrap) {
            embedWrap.style.display = 'none';
            if (embedIframe) embedIframe.src = '';
        }
        if (scThumb) scThumb.style.display = 'block';
        if (scHint) scHint.textContent = 'Откроется в браузере';
    }
    
    // Обновляем превью-карточку
    if (icon) icon.textContent = data.icon;
    if (channel) channel.textContent = data.channel;
    if (platLabel) {
        platLabel.textContent = data.platform;
        platLabel.style.color = data.color;
    }
    if (glow) {
        glow.style.background = `radial-gradient(circle, ${data.color}26, transparent 70%)`;
    }
    
    // Обновляем фон карточки
    const scThumbBg = document.getElementById('scThumbBg');
    if (scThumbBg) {
        const colors = {
            twitch: 'rgba(145,70,255,0.15)',
            vk: 'rgba(0,119,255,0.15)',
            youtube: 'rgba(255,0,0,0.15)'
        };
        scThumbBg.style.background = `radial-gradient(ellipse at 30% 50%,${colors[platform] || colors.twitch},transparent 60%)`;
    }
}


// ==========================================
// КОНФИГ ТРАНСЛЯЦИИ (АДМИН)
// ==========================================
let currentStreamConfig = {}; // Глобально хранит конфиг
let currentChatMode = 'unified'; // 'unified' или 'widget'

function saveStreamConfig() {
    const config = {
        unifiedChatWidget: document.getElementById('adminUnifiedChatWidget')?.value?.trim() || '',
        twitch: {
            enabled: document.getElementById('adminTwitchEnabled')?.checked || false,
            channel: document.getElementById('adminTwitchChannel')?.value?.trim() || '',
            chatWidget: document.getElementById('adminTwitchChatWidget')?.value?.trim() || '',
            embedUrl: document.getElementById('adminTwitchEmbed')?.value?.trim() || '',
        },
        youtube: {
            enabled: document.getElementById('adminYoutubeEnabled')?.checked || false,
            channel: document.getElementById('adminYoutubeChannel')?.value?.trim() || '',
            chatWidget: document.getElementById('adminYoutubeChatWidget')?.value?.trim() || '',
            embedUrl: document.getElementById('adminYoutubeEmbed')?.value?.trim() || '',
        },
        vk: {
            enabled: document.getElementById('adminVkEnabled')?.checked || false,
            channel: document.getElementById('adminVkChannel')?.value?.trim() || '',
            chatWidget: document.getElementById('adminVkChatWidget')?.value?.trim() || '',
            embedUrl: document.getElementById('adminVkEmbed')?.value?.trim() || '',
        },
    };
    
    currentStreamConfig = config;
    localStorage.setItem('stream_config', JSON.stringify(config));
    
    // Сохранить на сервер
    if (myTelegramId) {
        fetch(`${BOT_API_URL}/api/stream/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, config }),
        }).catch(e => console.warn('[Config] Save error'));
    }
    
    applyStreamConfig(config);
    // Обновляем плеер с новым конфигом
    initPlayer();
    showToast('💾', 'Настройки сохранены!');
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch(e) {}
}

async function loadStreamConfig() {
    // Сначала из сервера
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/config`);
        const data = await resp.json();
        if (data.config) {
            currentStreamConfig = data.config;
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
            currentStreamConfig = config;
            applyStreamConfig(config);
            fillAdminForm(config);
        }
    } catch(e) {}
}

function fillAdminForm(config) {
    // Unified widget
    const uw = document.getElementById('adminUnifiedChatWidget');
    if (uw && config.unifiedChatWidget) uw.value = config.unifiedChatWidget;
    
    if (config.twitch) {
        const el = document.getElementById('adminTwitchEnabled');
        if (el) el.checked = config.twitch.enabled;
        const ch = document.getElementById('adminTwitchChannel');
        if (ch && config.twitch.channel) ch.value = config.twitch.channel;
        const cw = document.getElementById('adminTwitchChatWidget');
        if (cw && config.twitch.chatWidget) cw.value = config.twitch.chatWidget;
        const em = document.getElementById('adminTwitchEmbed');
        if (em && config.twitch.embedUrl) em.value = config.twitch.embedUrl;
    }
    if (config.youtube) {
        const el = document.getElementById('adminYoutubeEnabled');
        if (el) el.checked = config.youtube.enabled;
        const ch = document.getElementById('adminYoutubeChannel');
        if (ch && config.youtube.channel) ch.value = config.youtube.channel;
        const cw = document.getElementById('adminYoutubeChatWidget');
        if (cw && config.youtube.chatWidget) cw.value = config.youtube.chatWidget;
        const em = document.getElementById('adminYoutubeEmbed');
        if (em && config.youtube.embedUrl) em.value = config.youtube.embedUrl;
    }
    if (config.vk) {
        const el = document.getElementById('adminVkEnabled');
        if (el) el.checked = config.vk.enabled;
        const ch = document.getElementById('adminVkChannel');
        if (ch && config.vk.channel) ch.value = config.vk.channel;
        const cw = document.getElementById('adminVkChatWidget');
        if (cw && config.vk.chatWidget) cw.value = config.vk.chatWidget;
        const em = document.getElementById('adminVkEmbed');
        if (em && config.vk.embedUrl) em.value = config.vk.embedUrl;
    }
}

function applyStreamConfig(config) {
    currentStreamConfig = config;
    // Показывать/скрывать вкладки платформ
    document.querySelectorAll('.platform-tab').forEach(tab => {
        const platform = tab.dataset.platform;
        if (config[platform]) {
            tab.style.display = config[platform].enabled ? 'flex' : 'none';
        }
    });
}

// ==========================================
// ПЕРЕКЛЮЧАТЕЛЬ ЧАТ-РЕЖИМА
// ==========================================
function switchChatMode(mode) {
    currentChatMode = mode;
    const unifiedBtn = document.getElementById('chatModeUnified');
    const widgetBtn = document.getElementById('chatModeWidget');
    const messagesEl = document.getElementById('chatMessages');
    const widgetEl = document.getElementById('chatWidgetContainer');
    const inputArea = document.querySelector('.stream-chat__input-area');
    
    if (mode === 'unified') {
        // Показываем наш единый чат
        if (messagesEl) messagesEl.style.display = 'block';
        if (widgetEl) widgetEl.style.display = 'none';
        if (inputArea) inputArea.style.display = 'flex';
        if (unifiedBtn) unifiedBtn.classList.add('chat-mode-btn--active');
        if (widgetBtn) widgetBtn.classList.remove('chat-mode-btn--active');
    } else {
        // Показываем виджет платформы
        if (messagesEl) messagesEl.style.display = 'none';
        if (widgetEl) widgetEl.style.display = 'block';
        if (inputArea) inputArea.style.display = 'none';
        if (unifiedBtn) unifiedBtn.classList.remove('chat-mode-btn--active');
        if (widgetBtn) widgetBtn.classList.add('chat-mode-btn--active');
        loadChatWidget();
    }
}

function loadChatWidget() {
    const iframe = document.getElementById('chatWidgetIframe');
    const container = document.getElementById('chatWidgetContainer');
    if (!iframe || !container) return;
    
    // 1. Приоритет: единый виджет (DonationAlerts и т.д.)
    const unifiedUrl = currentStreamConfig.unifiedChatWidget || '';
    if (unifiedUrl) {
        iframe.src = unifiedUrl;
        container.style.display = 'block';
        return;
    }
    
    // 2. Fallback: виджет конкретной платформы
    const config = currentStreamConfig[currentPlatform];
    const widgetUrl = config?.chatWidget || '';
    
    if (widgetUrl) {
        iframe.src = widgetUrl;
        container.style.display = 'block';
    } else {
        // 3. Автоматический fallback — Twitch chat embed
        if (currentPlatform === 'twitch') {
            const parent = window.location.hostname || 'localhost';
            const ch = config?.channel || currentChannel;
            iframe.src = `https://www.twitch.tv/embed/${ch}/chat?parent=${parent}&darkpopout`;
        } else {
            iframe.src = '';
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#5a7a5a;font-size:0.8rem;">⚠️ Виджет чата не настроен.<br>Админ может добавить URL в настройках ⚙️</div>';
        }
    }
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
    const modal = document.getElementById('donateModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const balance = await getMyCheeseBalance();
    const balEl = document.getElementById('donateBalance');
    if (isAdmin) {
        if (balEl) balEl.textContent = `Баланс: ∞ 🧀 (ADMIN — бесплатно)`;
    } else {
        if (balEl) balEl.textContent = `Баланс: ${balance} 🧀`;
    }
    // Update header balance too
    const hdrBal = document.getElementById('headerBalance');
    if (hdrBal) hdrBal.textContent = isAdmin ? '∞ 🧀' : `${balance} 🧀`;
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
    const senderName = (document.getElementById('donateSenderName')?.value || '').trim();
    
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
                username: senderName || myUsername || 'Танкист',
                sender_name: senderName,
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
    const modal = document.getElementById('musicModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const balance = await getMyCheeseBalance();
    const balEl = document.getElementById('musicBalance');
    if (balEl) balEl.textContent = `Баланс: ${balance} 🧀`;
    const hdrBal = document.getElementById('headerBalance');
    if (hdrBal) hdrBal.textContent = isAdmin ? '∞ 🧀' : `${balance} 🧀`;
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch(e) {}
}

function closeMusicModal() {
    const modal = document.getElementById('musicModal');
    if (modal) modal.style.display = 'none';
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

// ==========================================
// АДМИН ПАНЕЛЬ — МУЗЫКА И ДОНАТЫ
// ==========================================
async function saveMusicSettings() {
    const settings = {
        cost: parseInt(document.getElementById('adminMusicCost')?.value) || 50,
        min_views: parseInt(document.getElementById('adminMusicMinViews')?.value) || 1000,
        max_duration: parseInt(document.getElementById('adminMusicMaxDuration')?.value) || 300,
        paused: document.getElementById('adminMusicPaused')?.checked || false,
    };
    try {
        await fetch(`${BOT_API_URL}/api/stream/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, config: { music: settings } }),
        });
        localStorage.setItem('stream_music_settings', JSON.stringify(settings));
        showToast('✅', 'Настройки музыки сохранены');
    } catch(e) {
        localStorage.setItem('stream_music_settings', JSON.stringify(settings));
        showToast('💾', 'Сохранено локально');
    }
}

// Хранилище загруженных файлов (base64)
const uploadedFiles = {};

function handleFileUpload(input, key) {
    const file = input.files[0];
    if (!file) return;
    
    // Проверка размера (макс 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('❌', 'Файл слишком большой (макс 5 МБ)');
        input.value = '';
        return;
    }
    
    const status = document.getElementById('status' + key.replace('sound_', 'Sound_').replace('media_', 'Media_'));
    if (status) { status.textContent = '⏳ Загрузка...'; status.style.color = '#C8AA6E'; }
    
    const reader = new FileReader();
    reader.onload = async () => {
        uploadedFiles[key] = reader.result; // data:audio/mp3;base64,...
        
        // Сразу загрузить на сервер
        try {
            const resp = await fetch(`${BOT_API_URL}/api/stream/media/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegram_id: myTelegramId, key, data: reader.result }),
            });
            const result = await resp.json();
            if (result.success) {
                if (status) { status.textContent = '✅ ' + file.name; status.style.color = '#4CAF50'; }
                showToast('✅', `${file.name} загружен на сервер`);
                
                // Сразу сохранить флаг has_* в конфиг
                const flagKey = `has_${key}`;
                try {
                    await fetch(`${BOT_API_URL}/api/stream/config/save`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telegram_id: myTelegramId, config: { donate: { [flagKey]: true } } }),
                    });
                    // Обновить localStorage
                    const prev = JSON.parse(localStorage.getItem('stream_donate_settings') || '{}');
                    prev[flagKey] = true;
                    localStorage.setItem('stream_donate_settings', JSON.stringify(prev));
                } catch(e) { console.log('Config save error:', e); }
                
                // Если звук — проиграть превью
                if (key.startsWith('sound_')) {
                    const audio = new Audio(reader.result);
                    audio.volume = 0.5;
                    audio.play().catch(() => {});
                }
            } else {
                if (status) { status.textContent = '❌ Ошибка сервера'; status.style.color = '#f44'; }
                showToast('❌', result.error || 'Ошибка загрузки');
            }
        } catch(e) {
            if (status) { status.textContent = '⚠️ ' + file.name + ' (локально)'; status.style.color = '#FF9800'; }
            showToast('⚠️', 'Сервер недоступен, сохранено локально');
        }
    };
    reader.onerror = () => {
        if (status) { status.textContent = '❌ Ошибка'; status.style.color = '#f44'; }
        showToast('❌', 'Ошибка чтения файла');
    };
    reader.readAsDataURL(file);
}
window.handleFileUpload = handleFileUpload;

async function saveDonateSettings() {
    const volSlider = document.getElementById('adminSoundVolume');
    const prev = JSON.parse(localStorage.getItem('stream_donate_settings') || '{}');
    
    // Загружаем медиа-файлы на сервер
    const mediaKeys = ['sound_small', 'sound_medium', 'sound_large', 'media_small', 'media_medium', 'media_large'];
    for (const key of mediaKeys) {
        if (uploadedFiles[key]) {
            try {
                await fetch(`${BOT_API_URL}/api/stream/media/upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegram_id: myTelegramId, key, data: uploadedFiles[key] }),
                });
            } catch(e) { console.log('Upload error:', key, e); }
        }
    }
    
    const settings = {
        min_amount: parseInt(document.getElementById('adminDonateMin')?.value) || 10,
        alert_duration: parseInt(document.getElementById('adminAlertDuration')?.value) || 7,
        sound_enabled: document.getElementById('adminSoundEnabled')?.checked ?? true,
        sound_volume: (parseInt(volSlider?.value) || 70) / 100,
        has_sound_small: !!(uploadedFiles.sound_small || prev.has_sound_small),
        has_sound_medium: !!(uploadedFiles.sound_medium || prev.has_sound_medium),
        has_sound_large: !!(uploadedFiles.sound_large || prev.has_sound_large),
        animation_style: document.getElementById('adminAnimStyle')?.value || 'all',
        tts_enabled: document.getElementById('adminTtsEnabled')?.checked ?? true,
        tts_speed: (parseInt(document.getElementById('adminTtsSpeed')?.value) || 100) / 100,
        tts_min_amount: parseInt(document.getElementById('adminTtsMinAmount')?.value) || 30,
        has_media_small: !!(uploadedFiles.media_small || prev.has_media_small),
        has_media_medium: !!(uploadedFiles.media_medium || prev.has_media_medium),
        has_media_large: !!(uploadedFiles.media_large || prev.has_media_large),
    };
    try {
        await fetch(`${BOT_API_URL}/api/stream/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, config: { donate: settings } }),
        });
        localStorage.setItem('stream_donate_settings', JSON.stringify(settings));
        showToast('✅', 'Настройки донатов сохранены');
    } catch(e) {
        localStorage.setItem('stream_donate_settings', JSON.stringify(settings));
        showToast('💾', 'Сохранено локально');
    }
}

function loadAdminSettings() {
    try {
        const ms = JSON.parse(localStorage.getItem('stream_music_settings') || '{}');
        if (ms.cost) document.getElementById('adminMusicCost').value = ms.cost;
        if (ms.min_views !== undefined) document.getElementById('adminMusicMinViews').value = ms.min_views;
        if (ms.max_duration) document.getElementById('adminMusicMaxDuration').value = ms.max_duration;
        if (ms.paused) document.getElementById('adminMusicPaused').checked = ms.paused;
    } catch(e) {}
    try {
        const ds = JSON.parse(localStorage.getItem('stream_donate_settings') || '{}');
        if (ds.min_amount) document.getElementById('adminDonateMin').value = ds.min_amount;
        if (ds.alert_duration) document.getElementById('adminAlertDuration').value = ds.alert_duration;
         if (ds.sound_enabled !== undefined) document.getElementById('adminSoundEnabled').checked = ds.sound_enabled;
        if (ds.sound_volume !== undefined) {
            const v = Math.round(ds.sound_volume * 100);
            document.getElementById('adminSoundVolume').value = v;
            document.getElementById('adminSoundVolumeVal').textContent = v + '%';
        }
        if (ds.has_sound_small) { const el = document.getElementById('statusSound_small'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
        if (ds.has_sound_medium) { const el = document.getElementById('statusSound_medium'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
        if (ds.has_sound_large) { const el = document.getElementById('statusSound_large'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
        if (ds.animation_style) document.getElementById('adminAnimStyle').value = ds.animation_style;
        if (ds.tts_enabled !== undefined) document.getElementById('adminTtsEnabled').checked = ds.tts_enabled;
        if (ds.tts_speed !== undefined) {
            const s = Math.round(ds.tts_speed * 100);
            document.getElementById('adminTtsSpeed').value = s;
            document.getElementById('adminTtsSpeedVal').textContent = ds.tts_speed.toFixed(1) + 'x';
        }
        if (ds.tts_min_amount !== undefined) document.getElementById('adminTtsMinAmount').value = ds.tts_min_amount;
        if (ds.has_media_small) { const el = document.getElementById('statusMedia_small'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
        if (ds.has_media_medium) { const el = document.getElementById('statusMedia_medium'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
        if (ds.has_media_large) { const el = document.getElementById('statusMedia_large'); if (el) { el.textContent = '✅ Загружен'; el.style.color = '#4CAF50'; } }
    } catch(e) {}

    // OBS URL
    const obsEl = document.getElementById('obsAlertUrl');
    if (obsEl) obsEl.textContent = `${BOT_API_URL}/obs/alert.html`;

    // Слайдеры — живое обновление
    document.getElementById('adminSoundVolume')?.addEventListener('input', (e) => {
        document.getElementById('adminSoundVolumeVal').textContent = e.target.value + '%';
    });
    document.getElementById('adminTtsSpeed')?.addEventListener('input', (e) => {
        document.getElementById('adminTtsSpeedVal').textContent = (e.target.value / 100).toFixed(1) + 'x';
    });
}

function _ytTitle(url) {
    // Extract readable title from YouTube URL
    try {
        const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (m) return { id: m[1], short: url.replace(/https?:\/\/(www\.)?/, '').substring(0, 45) + '…' };
    } catch(e) {}
    return { id: null, short: (url || '').substring(0, 45) + '…' };
}

async function refreshMusicQueue() {
    const container = document.getElementById('musicQueueList');
    if (!container) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/music/queue`);
        const data = await resp.json();
        const queue = data.queue || [];
        
        if (queue.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#4A5568;font-size:.72rem">🎵 Очередь пуста</div>';
            return;
        }
        
        container.innerHTML = queue.map((t, i) => {
            const yt = _ytTitle(t.url);
            const title = t.title || yt.short;
            const thumb = yt.id ? `https://img.youtube.com/vi/${yt.id}/default.jpg` : '';
            const statusColor = t.played ? '#22c55e' : '#60A5FA';
            const statusText = t.played ? 'Сыгран' : 'В очереди';
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,0,0,.25);border-radius:12px;border:1px solid rgba(96,165,250,.08);margin-bottom:6px">
                <div style="width:24px;height:24px;border-radius:8px;background:rgba(96,165,250,.1);display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;color:#60A5FA;flex-shrink:0">${i + 1}</div>
                ${thumb ? `<img src="${thumb}" style="width:40px;height:30px;border-radius:6px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">` : ''}
                <div style="flex:1;min-width:0">
                    <div style="font-size:.72rem;font-weight:600;color:#E8E6E3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                        <span style="font-size:.58rem;color:#8B95A5">👤 ${t.username}</span>
                        <span style="font-size:.5rem;padding:2px 6px;border-radius:6px;background:${statusColor}18;color:${statusColor};font-weight:700">${statusText}</span>
                    </div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                    <button onclick="skipTrack('${t.id}')" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(96,165,250,.15);background:rgba(96,165,250,.06);color:#60A5FA;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Пропустить">⏭</button>
                    <button onclick="removeTrack('${t.id}')" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(239,68,68,.15);background:rgba(239,68,68,.06);color:#ef4444;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Удалить">🗑</button>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:.72rem">❌ Ошибка загрузки</div>';
    }
}

async function refreshDonateHistory() {
    const container = document.getElementById('donateHistoryList');
    if (!container) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/donate/history`);
        const data = await resp.json();
        const events = data.events || [];
        
        if (events.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#4A5568;font-size:.72rem">🧀 Донатов пока нет</div>';
            return;
        }
        
        container.innerHTML = events.slice(0, 15).map(e => {
            const ts = e.timestamp ? new Date(e.timestamp * 1000).toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'}) : '';
            const amtColor = e.amount >= 1000 ? '#FFC107' : e.amount >= 500 ? '#E040FB' : '#60A5FA';
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,0,0,.25);border-radius:12px;border:1px solid rgba(255,193,7,.06);margin-bottom:6px">
                <div style="min-width:52px;padding:4px 8px;border-radius:8px;background:${amtColor}15;border:1px solid ${amtColor}25;text-align:center">
                    <div style="font-size:.75rem;font-weight:800;color:${amtColor}">${e.amount}</div>
                    <div style="font-size:.45rem;color:${amtColor};opacity:.7">🧀</div>
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:.72rem;font-weight:600;color:#E8E6E3">👤 ${e.username || 'Аноним'}</div>
                    <div style="font-size:.65rem;color:#8B95A5;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.message || '—'}</div>
                </div>
                ${ts ? `<div style="font-size:.55rem;color:#4A5568;flex-shrink:0">${ts}</div>` : ''}
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:.72rem">❌ Ошибка загрузки</div>';
    }
}

async function skipTrack(trackId) {
    try {
        await fetch(`${BOT_API_URL}/api/stream/music/skip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, track_id: trackId }),
        });
        showToast('⏭', 'Трек пропущен');
        refreshMusicQueue();
    } catch(e) { showToast('❌', 'Ошибка'); }
}

async function removeTrack(trackId) {
    try {
        await fetch(`${BOT_API_URL}/api/stream/music/skip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTelegramId, track_id: trackId, remove: true }),
        });
        showToast('🗑', 'Трек удалён');
        refreshMusicQueue();
    } catch(e) { showToast('❌', 'Ошибка'); }
}

async function sendTestDonate() {
    try {
        await fetch(`${BOT_API_URL}/api/stream/donate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                username: myUsername || 'Тест',
                amount: 100,
                message: '🧪 Тестовый алерт доната!',
            }),
        });
        showToast('🧀', 'Тестовый донат отправлен!');
    } catch(e) { showToast('❌', 'Ошибка сети'); }
}

// ==========================================
// AI ДОНАТ (Grok генерация)
// ==========================================
async function openAiDonateModal() {
    let modal = document.getElementById('aiDonateModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'aiDonateModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.75);backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;';
        modal.onclick = (e) => { if (e.target === modal) closeAiDonateModal(); };
        modal.innerHTML = `
            <div style="width:100%;max-width:480px;background:linear-gradient(180deg,#1a2332,#131b28);border-radius:24px 24px 0 0;border-top:1px solid rgba(200,170,110,0.22);padding:20px 20px 34px;animation:slideUp .35s cubic-bezier(.34,1.56,.64,1) forwards;">
                <style>@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>
                <div style="width:40px;height:4px;background:rgba(255,255,255,.1);border-radius:2px;margin:0 auto 18px;"></div>
                
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <div style="font-family:'Russo One',sans-serif;font-size:1.05rem;color:#A78BFA;">🤖 AI Донат</div>
                    <button onclick="closeAiDonateModal()" style="background:rgba(255,255,255,.05);border:1px solid rgba(200,170,110,.1);border-radius:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#8B95A5;font-size:.85rem;transition:all .2s;">✕</button>
                </div>
                <div id="aiDonateBalance" style="font-size:.72rem;color:#8B95A5;margin-bottom:16px;">Баланс: ... 🧀</div>
                
                <input type="text" id="aiDonateSenderName" placeholder="Ваше имя (отображается на стриме)" maxlength="30"
                    style="width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(167,139,250,.15);border-radius:12px;padding:12px 14px;color:#E8E6E3;font-size:.85rem;font-family:'Inter',sans-serif;outline:none;margin-bottom:14px;transition:border-color .2s,box-shadow .2s;"
                    onfocus="this.style.borderColor='rgba(167,139,250,.4)';this.style.boxShadow='0 0 0 3px rgba(167,139,250,.06)'"
                    onblur="this.style.borderColor='rgba(167,139,250,.15)';this.style.boxShadow='none'">

                <div style="margin-bottom:14px;">
                    <div style="font-size:.72rem;color:#A78BFA;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:5px;">✨ Промт для генерации</div>
                    <textarea id="aiDonatePrompt" 
                        placeholder="Опиши что нарисовать...&#10;Например: Танк Т-34 летит в космосе" 
                        rows="3" maxlength="300"
                        style="width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(167,139,250,.15);border-radius:12px;padding:12px 14px;color:#E8E6E3;font-size:.85rem;font-family:'Inter',sans-serif;outline:none;resize:vertical;min-height:75px;transition:border-color .2s,box-shadow .2s;"
                        onfocus="this.style.borderColor='rgba(167,139,250,.4)';this.style.boxShadow='0 0 0 3px rgba(167,139,250,.06)'"
                        onblur="this.style.borderColor='rgba(167,139,250,.15)';this.style.boxShadow='none'"
                    ></textarea>
                    <div style="font-size:.55rem;color:#4A5568;text-align:right;margin-top:3px;"><span id="aiPromptCounter">0</span>/300</div>
                </div>
                
                <div style="margin-bottom:16px;">
                    <div style="font-size:.72rem;color:#FFC107;font-weight:600;margin-bottom:8px;">🧀 Стоимость</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
                        <button onclick="setAiDonateAmount(50)" style="padding:8px 16px;border-radius:10px;border:1px solid rgba(167,139,250,.2);background:rgba(167,139,250,.06);color:#A78BFA;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s;" onmouseover="this.style.background='rgba(167,139,250,.15)';this.style.borderColor='#A78BFA'" onmouseout="this.style.background='rgba(167,139,250,.06)';this.style.borderColor='rgba(167,139,250,.2)'">50 🧀</button>
                        <button onclick="setAiDonateAmount(100)" style="padding:8px 16px;border-radius:10px;border:1px solid rgba(167,139,250,.2);background:rgba(167,139,250,.06);color:#A78BFA;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s;" onmouseover="this.style.background='rgba(167,139,250,.15)';this.style.borderColor='#A78BFA'" onmouseout="this.style.background='rgba(167,139,250,.06)';this.style.borderColor='rgba(167,139,250,.2)'">100 🧀</button>
                        <button onclick="setAiDonateAmount(200)" style="padding:8px 16px;border-radius:10px;border:1px solid rgba(167,139,250,.2);background:rgba(167,139,250,.06);color:#A78BFA;font-size:.75rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s;" onmouseover="this.style.background='rgba(167,139,250,.15)';this.style.borderColor='#A78BFA'" onmouseout="this.style.background='rgba(167,139,250,.06)';this.style.borderColor='rgba(167,139,250,.2)'">200 🧀</button>
                    </div>
                    <input type="number" id="aiDonateAmount" value="50" min="50"
                        style="width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(167,139,250,.15);border-radius:12px;padding:12px 14px;color:#E8E6E3;font-size:.88rem;font-weight:600;font-family:'Inter',sans-serif;outline:none;text-align:center;transition:border-color .2s,box-shadow .2s;"
                        onfocus="this.style.borderColor='rgba(167,139,250,.4)';this.style.boxShadow='0 0 0 3px rgba(167,139,250,.06)'"
                        onblur="this.style.borderColor='rgba(167,139,250,.15)';this.style.boxShadow='none'">
                </div>

                <button id="aiDonateSendBtn" onclick="sendAiDonate()"
                    style="width:100%;padding:14px;border-radius:14px;border:none;cursor:pointer;background:linear-gradient(135deg,#9C27B0,#7B1FA2);color:#fff;font-family:'Russo One',sans-serif;font-size:.88rem;letter-spacing:.5px;transition:all .2s;box-shadow:0 4px 20px rgba(156,39,176,.25);margin-bottom:8px;"
                    onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 6px 28px rgba(156,39,176,.35)'"
                    onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 20px rgba(156,39,176,.25)'"
                >🤖 Сгенерировать и отправить</button>
                
                <button onclick="closeAiDonateModal()" style="width:100%;padding:11px;border-radius:12px;border:1px solid rgba(200,170,110,.1);background:transparent;color:#8B95A5;font-size:.78rem;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s;" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background='transparent'">Отмена</button>

                <div id="aiDonatePreview" style="display:none;margin-top:14px;text-align:center;padding:14px;border-radius:14px;background:rgba(167,139,250,.05);border:1px solid rgba(167,139,250,.15);">
                    <div style="color:#A78BFA;font-size:.72rem;margin-bottom:8px;font-weight:600;">✨ Результат:</div>
                    <img id="aiDonatePreviewImg" style="max-width:100%;max-height:250px;border-radius:12px;border:1px solid rgba(167,139,250,.2);">
                </div>

                <div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(0,0,0,.25);font-size:.58rem;color:#4A5568;line-height:1.6;text-align:center;">
                    ⚡ AI провайдеры: HuggingFace → Gemini → Pollinations → Local
                </div>
            </div>`;
        document.body.appendChild(modal);

        document.getElementById('aiDonatePrompt').addEventListener('input', (e) => {
            document.getElementById('aiPromptCounter').textContent = e.target.value.length;
        });
    }

    modal.style.display = 'flex';
    document.getElementById('aiDonatePreview').style.display = 'none';
    
    const balance = await getMyCheeseBalance();
    if (isAdmin) {
        document.getElementById('aiDonateBalance').textContent = 'Баланс: ∞ 🧀 (ADMIN)';
    } else {
        document.getElementById('aiDonateBalance').textContent = `Баланс: ${balance} 🧀`;
    }
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch(e) {}
}

function closeAiDonateModal() {
    const modal = document.getElementById('aiDonateModal');
    if (modal) modal.style.display = 'none';
}

function setAiDonateAmount(val) {
    document.getElementById('aiDonateAmount').value = val;
    try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch(e) {}
}

async function sendAiDonate() {
    const prompt = document.getElementById('aiDonatePrompt').value.trim();
    const amount = parseInt(document.getElementById('aiDonateAmount').value) || 0;
    const senderName = (document.getElementById('aiDonateSenderName')?.value || '').trim();

    if (!prompt) { showToast('❌', 'Напишите промт для генерации'); return; }
    if (amount < 50) { showToast('❌', 'Минимум 50 🧀 для AI доната'); return; }
    if (!myTelegramId) { showToast('❌', 'Нужна авторизация через Telegram'); return; }

    const btn = document.getElementById('aiDonateSendBtn');
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '🎨 AI генерирует картинку... (10-30 сек)';
    document.getElementById('aiDonatePreview').style.display = 'none';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/stream/donate/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                username: senderName || myUsername || 'Танкист',
                sender_name: senderName,
                amount: amount,
                prompt: prompt,
            }),
        });
        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[AI Donate] Server:', resp.status, errText);
            showToast('❌', `Ошибка ${resp.status}`);
            btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '🤖 Сгенерировать и отправить';
            return;
        }
        const data = await resp.json();

        if (data.success) {
            const prov = data.event?.provider || 'AI';
            showToast('🤖', `AI донат ${amount} 🧀 (${prov})!`);
            document.getElementById('aiDonatePrompt').value = '';
            try {
                const local = JSON.parse(localStorage.getItem(`mt_data_${myTelegramId}`) || '{}');
                local.coins = data.new_balance;
                localStorage.setItem(`mt_data_${myTelegramId}`, JSON.stringify(local));
            } catch(e) {}
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch(e) {}
            setTimeout(() => closeAiDonateModal(), 2000);
        } else {
            showToast('❌', data.error || 'Ошибка');
            try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error'); } catch(e) {}
        }
    } catch (e) {
        console.error('[AI Donate]', e);
        showToast('❌', 'Ошибка сети');
    }

    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = '🤖 Сгенерировать и отправить';
}

async function sendTestMusic() {
    try {
        await fetch(`${BOT_API_URL}/api/stream/music/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                username: myUsername || 'Тест',
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                amount: 50,
            }),
        });
        showToast('🎵', 'Тестовый трек добавлен!');
        refreshMusicQueue();
    } catch(e) { showToast('❌', 'Ошибка сети'); }
}

// Загрузка при открытии админки
setTimeout(() => {
    if (isAdmin) {
        loadAdminSettings();
        // Показать кнопку шестерёнки
        const gearBtn = document.getElementById('adminGearBtn');
        if (gearBtn) gearBtn.style.display = 'block';
    }
}, 2000);

function openSettingsModal() {
    const m = document.getElementById('settingsModal');
    if (m) m.style.display = 'flex';
    loadAdminSettings();
    refreshMusicQueue();
    refreshDonateHistory();
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch(e) {}
}

function closeSettingsModal() {
    const m = document.getElementById('settingsModal');
    if (m) m.style.display = 'none';
}

function switchSettingsTab(tabName, btn) {
    // Hide all panels (support both old .settings-panel and new .sp classes)
    document.querySelectorAll('.settings-panel, .sp').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
    // Deactivate all tabs (support both old and new)
    document.querySelectorAll('.settings-tab, .ss-tab').forEach(t => { t.classList.remove('settings-tab--active'); t.classList.remove('active'); });
    // Show selected
    const panel = document.getElementById('settingsTab_' + tabName);
    if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
    if (btn) { btn.classList.add('settings-tab--active'); btn.classList.add('active'); }
    try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch(e) {}
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
window.saveMusicSettings = saveMusicSettings;
window.saveDonateSettings = saveDonateSettings;
window.refreshMusicQueue = refreshMusicQueue;
window.refreshDonateHistory = refreshDonateHistory;
window.skipTrack = skipTrack;
window.removeTrack = removeTrack;
window.sendTestDonate = sendTestDonate;
window.sendTestMusic = sendTestMusic;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.switchSettingsTab = switchSettingsTab;
window.openAiDonateModal = openAiDonateModal;
window.closeAiDonateModal = closeAiDonateModal;
window.setAiDonateAmount = setAiDonateAmount;
window.sendAiDonate = sendAiDonate;
