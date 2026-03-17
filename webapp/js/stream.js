/**
 * МИР ТАНКОВ — Стрим-хаб (stream.js)
 * Twitch стрим + мультиплатформенный чат
 * 
 * Чат Twitch: анонимное чтение через WebSocket IRC
 * Чат Telegram: через бота (отправка/получение)
 */

// ==========================================
// КОНФИГУРАЦИЯ
// ==========================================
const DEFAULT_CHANNEL = 'iserveri';
const TWITCH_WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_CHAT_MESSAGES = 200;

// Популярные каналы для быстрого переключения
const POPULAR_CHANNELS = [
    { name: 'ISERVERI', channel: 'iserveri', desc: 'Мир Танков' },
    { name: 'Silvername', channel: 'silvername', desc: 'WoT стримы' },
    { name: 'EviL_GrannY', channel: 'evil_granny', desc: 'WoT' },
    { name: 'Amway921', channel: 'amway921', desc: 'WoT обзоры' },
    { name: 'LeBwa', channel: 'lebwa', desc: 'WoT' },
];

let currentChannel = DEFAULT_CHANNEL;
let twitchWs = null;
let chatMessages = [];
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;

const DEFAULT_COLORS = [
    '#FF4500', '#00FF7F', '#1E90FF', '#9ACD32', '#FF69B4',
    '#FFD700', '#00CED1', '#FF6347', '#8A2BE2', '#2E8B57',
    '#DAA520', '#D2691E', '#5F9EA0', '#FF7F50', '#6495ED',
];

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    initUser();
    createParticles();
    initTwitchPlayer();
    connectTwitchChat();
    initChatInput();
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
// TWITCH PLAYER
// ==========================================
function initTwitchPlayer() {
    const iframe = document.getElementById('twitchPlayer');
    if (!iframe) return;
    const parent = window.location.hostname || 'localhost';
    iframe.src = `https://player.twitch.tv/?channel=${currentChannel}&parent=${parent}&muted=false`;
}

/**
 * Извлечь имя канала из ссылки или текста
 * Поддерживает: twitch.tv/username, просто username
 */
function extractTwitchChannel(input) {
    input = input.trim();
    // twitch.tv/username или www.twitch.tv/username
    const match = input.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    if (match) return match[1].toLowerCase();
    // Просто имя канала
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
    
    initTwitchPlayer();
    disconnectTwitchChat();
    connectTwitchChat();
    
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
    container.innerHTML = POPULAR_CHANNELS.map(ch => `
        <button class="popular-ch ${ch.channel === currentChannel ? 'popular-ch--active' : ''}" 
                onclick="changeChannel('${ch.channel}')">
            <span class="popular-ch__name">${ch.name}</span>
            <span class="popular-ch__desc">${ch.desc}</span>
        </button>
    `).join('');
}

// ==========================================
// TWITCH CHAT (WebSocket IRC)
// ==========================================
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
        // Подключаемся анонимно (justinfan)
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
            
            // PING/PONG для поддержания соединения
            if (line.startsWith('PING')) {
                twitchWs.send('PONG :tmi.twitch.tv');
                continue;
            }

            // Парсим сообщения чата
            if (line.includes('PRIVMSG')) {
                parseTwitchMessage(line);
            }

            // Уведомление о подписке, рейде и т.д.
            if (line.includes('USERNOTICE')) {
                parseTwitchNotice(line);
            }
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
    if (twitchWs) {
        twitchWs.close();
        twitchWs = null;
    }
    isConnected = false;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
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
        // Парсим теги @key=value;key=value
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

        // Извлекаем сообщение
        const msgMatch = rest.match(/PRIVMSG\s+#\S+\s+:(.+)/);
        if (!msgMatch) return;

        const text = msgMatch[1].trim();
        const displayName = tags['display-name'] || 'Unknown';
        const color = tags['color'] || getRandomColor(displayName);
        const isMod = tags['mod'] === '1';
        const isSub = tags['subscriber'] === '1';
        const isVip = (tags['badges'] || '').includes('vip');
        const isBroadcaster = (tags['badges'] || '').includes('broadcaster');

        // Определяем бейджи
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
        const systemMsg = (tags['system-msg'] || '').replace(/\\s/g, ' ');

        if (msgType === 'sub' || msgType === 'resub') {
            addSystemMessage(`⭐ ${displayName} подписался!`);
        } else if (msgType === 'raid') {
            addSystemMessage(`🚀 Рейд от ${displayName}!`);
        } else if (msgType === 'subgift') {
            addSystemMessage(`🎁 ${displayName} подарил подписку!`);
        }
    } catch (e) { }
}

function getRandomColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

// ==========================================
// ЧАТ UI
// ==========================================
function addChatMessage(msg) {
    chatMessages.push(msg);
    if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
    }
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
    
    // Автоскролл (если пользователь не прокручивал вверх)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
        container.scrollTop = container.scrollHeight;
    }

    // Удаляем старые DOM элементы
    while (container.children.length > MAX_CHAT_MESSAGES + 10) {
        container.removeChild(container.firstChild);
    }
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
// ОТПРАВКА СООБЩЕНИЙ (Telegram)
// ==========================================
function initChatInput() {
    const input = document.getElementById('chatInput');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    // Получаем имя пользователя Telegram
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    const username = user?.first_name || 'Танкист';

    // Показываем сообщение в чате
    addChatMessage({
        platform: 'telegram',
        username: username,
        text: text,
        color: '#29B6F6',
        badges: '📱',
        time: new Date(),
    });

    // Очищаем инпут
    input.value = '';

    // Хаптик
    try { tg?.HapticFeedback?.impactOccurred('light'); } catch (e) { }

    // TODO: Отправить через бота в общий Telegram чат
    // Потребуется эндпоинт на бэкенде
}

function toggleChatPlatform() {
    // Пока доступна только Telegram для отправки
    showToast('📱', 'Отправка через Telegram');
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

// Expose globals
window.changeChannel = changeChannel;
window.toggleChannelSettings = toggleChannelSettings;
window.sendChatMessage = sendChatMessage;
window.toggleChatPlatform = toggleChatPlatform;
window.goBack = goBack;
window.openGame = openGame;
