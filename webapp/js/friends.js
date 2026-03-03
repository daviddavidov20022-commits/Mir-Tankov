/**
 * Friends JS — Друзья, чат, аватарки
 * Работает через серверный API (bot.py → aiohttp)
 */

// ============================================================
// STATE  
// ============================================================
let myTelegramId = 0;
let currentChatFriend = null;
const AVATAR_KEY = 'wot_user_avatar';
const LESTA_API = 'https://api.tanki.su/wot';
const LESTA_APP = 'c984faa7dc529f4cb0139505d5e8043c';

// URL API бота — измените если бот на VPS
const BOT_API_URL = localStorage.getItem('bot_api_url') || 'http://localhost:8081';

// Данные из сервера
let friends = [];
let friendRequests = [];
let messages = {};

// Эмодзи для выбора аватарки
const AVATAR_EMOJIS = [
    '🪖', '🎖️', '⭐', '🔥', '💀', '🐉',
    '🦅', '🐺', '🦁', '🐻', '🦊', '🐯',
    '👑', '💎', '🎯', '🛡️', '⚔️', '🏆',
    '🚀', '💣', '🔫', '🪓', '⚡', '🌟',
    '😎', '🤖', '👾', '🎃', '💜', '❤️',
];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Получаем Telegram ID (несколько способов)
    const tg = window.Telegram?.WebApp;

    // Способ 1: из initDataUnsafe
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        const nameEl = document.getElementById('myName');
        if (nameEl) nameEl.textContent = tg.initDataUnsafe.user.first_name || 'Танкист';
    }

    // Способ 2: парсим initData (query string)
    if (!myTelegramId && tg?.initData) {
        try {
            const params = new URLSearchParams(tg.initData);
            const userJson = params.get('user');
            if (userJson) {
                const user = JSON.parse(userJson);
                myTelegramId = user.id;
                const nameEl = document.getElementById('myName');
                if (nameEl) nameEl.textContent = user.first_name || 'Танкист';
            }
        } catch (e) { }
    }

    // Способ 3: из URL параметров (?telegram_id=xxx)
    if (!myTelegramId) {
        const urlParams = new URLSearchParams(window.location.search);
        const idFromUrl = urlParams.get('telegram_id');
        if (idFromUrl) myTelegramId = parseInt(idFromUrl);
    }

    // Способ 4: из localStorage (сохранённый ранее)
    if (!myTelegramId) {
        const saved = localStorage.getItem('my_telegram_id');
        if (saved) myTelegramId = parseInt(saved);
    }

    // Способ 5: спрашиваем у пользователя
    if (!myTelegramId) {
        promptForTelegramId();
    }

    // Сохраняем для будущего использования
    if (myTelegramId) {
        localStorage.setItem('my_telegram_id', String(myTelegramId));
    }

    loadAvatar();
    loadFriendsFromServer();
    createParticles();

    // Enter в поле поиска
    const searchInput = document.getElementById('friendSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchForFriend();
        });
    }

    // Автообновление каждые 30 сек
    setInterval(loadFriendsFromServer, 30000);
});

// ============================================================
// API HELPERS
// ============================================================
async function apiGet(path) {
    try {
        const resp = await fetch(`${BOT_API_URL}${path}`);
        return await resp.json();
    } catch (e) {
        console.warn('API GET error:', e);
        return null;
    }
}

async function apiPost(path, body) {
    try {
        const resp = await fetch(`${BOT_API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return await resp.json();
    } catch (e) {
        console.warn('API POST error:', e);
        return null;
    }
}

// ============================================================
// ЗАГРУЗКА ДРУЗЕЙ С СЕРВЕРА
// ============================================================
async function loadFriendsFromServer() {
    if (!myTelegramId) return;

    const data = await apiGet(`/api/friends?telegram_id=${myTelegramId}`);
    if (!data) {
        // Нет сервера — показываем оффлайн
        showToast('⚠️ Нет подключения к серверу');
        return;
    }

    if (data.error) {
        console.warn('API error:', data.error);
        return;
    }

    friends = data.friends || [];
    friendRequests = data.requests || [];

    renderFriends();
    renderRequests();

    // Обновляем бейдж непрочитанных
    if (data.unread_messages > 0) {
        showToast(`💬 ${data.unread_messages} непрочитанных сообщений`);
    }
}

// ============================================================
// AVATAR SYSTEM
// ============================================================
function loadAvatar() {
    const saved = localStorage.getItem(AVATAR_KEY);
    const avatarEl = document.getElementById('myAvatar');
    if (!avatarEl) return;
    if (saved && saved.startsWith('data:image')) {
        avatarEl.innerHTML = `<img src="${saved}" alt="avatar">`;
    } else {
        avatarEl.textContent = saved || '🪖';
    }
}

function openAvatarPicker() {
    const grid = document.getElementById('avatarGrid');
    const current = localStorage.getItem(AVATAR_KEY) || '🪖';
    grid.innerHTML = AVATAR_EMOJIS.map(emoji => `
        <button class="avatar-emoji ${emoji === current ? 'avatar-emoji--selected' : ''}" 
                onclick="selectAvatar('${emoji}')">${emoji}</button>
    `).join('');
    document.getElementById('avatarModal').classList.add('modal-overlay--open');
}

function closeAvatarPicker() {
    document.getElementById('avatarModal').classList.remove('modal-overlay--open');
}

function selectAvatar(emoji) {
    localStorage.setItem(AVATAR_KEY, emoji);
    const avatarEl = document.getElementById('myAvatar');
    avatarEl.innerHTML = emoji;
    document.querySelectorAll('.avatar-emoji').forEach(el => {
        el.classList.toggle('avatar-emoji--selected', el.textContent === emoji);
    });
    showToast('✅ Аватарка сохранена!');
    setTimeout(closeAvatarPicker, 500);
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 512000) {
        showToast('❌ Файл слишком большой (макс. 500 КБ)');
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            localStorage.setItem(AVATAR_KEY, dataUrl);
            document.getElementById('myAvatar').innerHTML = `<img src="${dataUrl}" alt="avatar">`;
            showToast('✅ Фото загружено!');
            setTimeout(closeAvatarPicker, 500);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================================
// FRIENDS TAB SWITCHING
// ============================================================
function switchFriendsTab(tabId, btn) {
    document.querySelectorAll('.ftab-content').forEach(t => t.classList.remove('ftab-content--active'));
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('friends-tab--active'));
    document.getElementById('ftab-' + tabId).classList.add('ftab-content--active');
    btn.classList.add('friends-tab--active');
}

// ============================================================
// RENDER FRIENDS
// ============================================================
function renderFriends() {
    const list = document.getElementById('friendsList');
    if (!friends.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">👥</div>
            <div class="empty-state__text">У тебя пока нет друзей.<br>Найди игрока и добавь!</div></div>`;
        return;
    }

    // Сортируем: accepted сверху
    const sorted = [...friends].sort((a, b) => {
        if (a.status === 'accepted' && b.status !== 'accepted') return -1;
        if (a.status !== 'accepted' && b.status === 'accepted') return 1;
        return 0;
    });

    list.innerHTML = sorted.map((f, i) => {
        const avatar = f.avatar || '🪖';
        const avatarContent = avatar.startsWith('data:') ? `<img src="${avatar}" alt="">` : avatar;
        const isPending = f.status === 'pending';
        const statusClass = isPending ? 'friend-card--pending' : 'friend-card--accepted';
        const name = f.wot_nickname || f.first_name || f.username || 'Игрок';
        const statusLabel = isPending ? '⏳ Ожидает подтверждения' : '✅ Друг';

        return `
        <div class="friend-card ${statusClass}" style="animation-delay: ${i * 0.05}s">
            <div class="friend-card__avatar">${avatarContent}</div>
            <div class="friend-card__info" onclick="${isPending ? '' : `openChat(${f.telegram_id})`}">
                <div class="friend-card__name">${name}</div>
                <div class="friend-card__wot">${f.wot_nickname || 'Ник не привязан'}</div>
                <div class="friend-card__status-label" style="font-size:0.6rem;color:${isPending ? '#5A6577' : '#4ade80'};margin-top:2px;">${statusLabel}</div>
            </div>
            <div class="friend-card__actions">
                ${isPending ? `
                    <button class="friend-card__action" style="opacity:0.4;cursor:default" title="Ожидает">⏳</button>
                ` : `
                    <button class="friend-card__action friend-card__action--chat" onclick="openChat(${f.telegram_id})" title="Чат">💬</button>
                    <button class="friend-card__action friend-card__action--duel" onclick="challengeFriendById(${f.telegram_id})" title="Дуэль">⚔️</button>
                `}
                <button class="friend-card__action friend-card__action--remove" onclick="removeFriend(${f.telegram_id})" title="Удалить">✕</button>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// FRIEND REQUESTS (входящие — с сервера!)
// ============================================================
function renderRequests() {
    const list = document.getElementById('requestsList');
    const badge = document.getElementById('requestsBadge');

    if (friendRequests.length > 0) {
        badge.style.display = 'inline';
        badge.textContent = friendRequests.length;
    } else {
        badge.style.display = 'none';
    }

    if (!friendRequests.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📩</div>
            <div class="empty-state__text">Нет входящих запросов</div></div>`;
        return;
    }

    list.innerHTML = friendRequests.map(r => {
        const name = r.wot_nickname || r.first_name || r.username || 'Игрок';
        return `
        <div class="request-card">
            <div class="request-card__avatar">${r.avatar || '🪖'}</div>
            <div class="request-card__info">
                <div class="request-card__name">${name}</div>
                <div class="request-card__sub">${r.wot_nickname || ''}</div>
            </div>
            <div class="request-btns">
                <button class="request-btn-accept" onclick="acceptRequest(${r.telegram_id})">✅ Принять</button>
                <button class="request-btn-decline" onclick="declineRequest(${r.telegram_id})">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function acceptRequest(fromTelegramId) {
    const result = await apiPost('/api/friends/accept', {
        my_telegram_id: myTelegramId,
        from_telegram_id: fromTelegramId,
    });

    if (result?.success) {
        showToast('✅ Запрос принят!');
        loadFriendsFromServer();
    } else {
        showToast(`❌ ${result?.error || 'Ошибка'}`);
    }
}

async function declineRequest(fromTelegramId) {
    const result = await apiPost('/api/friends/decline', {
        my_telegram_id: myTelegramId,
        from_telegram_id: fromTelegramId,
    });

    if (result?.success) {
        showToast('Запрос отклонён');
        loadFriendsFromServer();
    }
}

// ============================================================
// REMOVE FRIEND (через API)
// ============================================================
async function removeFriend(friendTelegramId) {
    if (!confirm('Удалить из друзей?')) return;

    const result = await apiPost('/api/friends/remove', {
        my_telegram_id: myTelegramId,
        friend_telegram_id: friendTelegramId,
    });

    if (result?.success) {
        showToast('Друг удалён');
        loadFriendsFromServer();
    }
}

// ============================================================
// SEARCH — ЧЕРЕЗ LESTA API
// ============================================================
async function searchForFriend() {
    const query = document.getElementById('friendSearchInput').value.trim();
    if (query.length < 2) { showToast('Введите минимум 2 символа'); return; }

    const results = document.getElementById('friendSearchResults');
    results.innerHTML = `<div style="text-align:center;padding:20px;color:#5A6577">
        <div style="font-size:1.5rem;margin-bottom:8px">🔍</div>Ищем «${query}»...</div>`;

    try {
        const url = `${LESTA_API}/account/list/?application_id=${LESTA_APP}&search=${encodeURIComponent(query)}&type=startswith&limit=10`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data || data.data.length === 0) {
            results.innerHTML = `<div class="empty-state" style="padding:30px">
                <div class="empty-state__icon">😕</div>
                <div class="empty-state__text">Игрок «${query}» не найден</div></div>`;
            return;
        }

        results.innerHTML = data.data.map(player => {
            const alreadyFriend = friends.some(f => String(f.wot_account_id) === String(player.account_id));
            let actionBtn;
            if (alreadyFriend) {
                actionBtn = `<span style="font-size:0.7rem;color:#4ade80;font-weight:700;padding:8px 12px;">✅ Друг</span>`;
            } else {
                actionBtn = `<button class="request-btn-accept" onclick="addFriend('${player.nickname}', '${player.account_id}')">➕ Добавить</button>`;
            }
            return `
            <div class="friend-card" style="margin-bottom:6px">
                <div class="friend-card__avatar">🪖</div>
                <div class="friend-card__info">
                    <div class="friend-card__name">${player.nickname}</div>
                    <div class="friend-card__wot">ID: ${player.account_id}</div>
                </div>
                ${actionBtn}
            </div>`;
        }).join('');
    } catch (err) {
        results.innerHTML = `<div class="empty-state" style="padding:30px">
            <div class="empty-state__icon">⚠️</div>
            <div class="empty-state__text">Ошибка поиска</div></div>`;
    }
}

async function addFriend(name, accountId) {
    if (!myTelegramId) {
        promptForTelegramId();
        if (!myTelegramId) return;
    }

    showToast('📩 Отправляю запрос...');

    const result = await apiPost('/api/friends/add', {
        from_telegram_id: myTelegramId,
        to_wot_account_id: accountId,
    });

    if (!result) {
        showToast('❌ Нет подключения к серверу');
        return;
    }

    if (result.not_registered) {
        showToast('⚠️ Игрок не зарегистрирован в боте');
        return;
    }

    if (result.success) {
        if (result.auto_accepted) {
            showToast(`🤝 ${name} — теперь друзья!`);
        } else {
            showToast(`📩 Запрос отправлен ${name}!`);
        }
        loadFriendsFromServer();
        searchForFriend(); // обновить кнопки
    } else {
        showToast(`ℹ️ ${result.error || 'Ошибка'}`);
    }
}

// ============================================================
// CHAT (через сервер!)
// ============================================================
async function openChat(telegramId) {
    currentChatFriend = friends.find(f => f.telegram_id == telegramId);
    if (!currentChatFriend) return;

    if (currentChatFriend.status === 'pending') {
        showToast('⏳ Дождитесь подтверждения дружбы');
        return;
    }

    const name = currentChatFriend.wot_nickname || currentChatFriend.first_name || 'Друг';
    const avatar = currentChatFriend.avatar || '🪖';
    const avatarContent = avatar.startsWith('data:') ? `<img src="${avatar}" alt="">` : avatar;

    document.getElementById('chatAvatar').innerHTML = avatarContent;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = '💬 Чат';

    // Загружаем сообщения с сервера
    await loadChatMessages(telegramId);

    document.getElementById('chatOverlay').classList.add('chat-overlay--open');
    document.getElementById('chatInput').focus();

    // Автообновление чата каждые 5 сек
    if (window._chatInterval) clearInterval(window._chatInterval);
    window._chatInterval = setInterval(() => {
        if (currentChatFriend) loadChatMessages(currentChatFriend.telegram_id);
    }, 5000);
}

async function loadChatMessages(friendTelegramId) {
    const data = await apiGet(`/api/messages?my_id=${myTelegramId}&friend_id=${friendTelegramId}`);
    if (!data || !data.messages) return;

    const container = document.getElementById('chatMessages');
    const msgs = data.messages;

    if (!msgs.length) {
        container.innerHTML = `<div class="empty-state" style="padding:60px 20px">
            <div class="empty-state__icon">💬</div>
            <div class="empty-state__text">Напиши первое сообщение!</div></div>`;
        return;
    }

    container.innerHTML = msgs.map(m => {
        const mine = m.sender_telegram_id == myTelegramId;
        const time = new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg ${mine ? 'msg--mine' : 'msg--theirs'}">
            ${m.text}
            <div class="msg__time">${time}</div>
        </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('chat-overlay--open');
    currentChatFriend = null;
    if (window._chatInterval) {
        clearInterval(window._chatInterval);
        window._chatInterval = null;
    }
}

async function sendMsg() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !currentChatFriend) return;

    input.value = '';

    const result = await apiPost('/api/messages/send', {
        from_telegram_id: myTelegramId,
        to_telegram_id: currentChatFriend.telegram_id,
        text: text,
    });

    if (result?.success) {
        await loadChatMessages(currentChatFriend.telegram_id);
    } else {
        showToast('❌ Ошибка отправки');
    }
}

// ============================================================
// CHALLENGE FRIEND
// ============================================================
function challengeFriend() {
    if (!currentChatFriend) return;
    challengeFriendById(currentChatFriend.telegram_id);
}

function challengeFriendById(telegramId) {
    const friend = friends.find(f => f.telegram_id == telegramId);
    if (!friend) return;
    const params = new URLSearchParams({
        opponent: friend.wot_nickname || friend.first_name || 'Соперник',
        opponent_id: telegramId,
    });
    window.location.href = `challenges.html?${params.toString()}`;
}

// ============================================================
// TOAST
// ============================================================
function showToast(message) {
    const existing = document.querySelector('.friends-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'friends-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        padding: 14px 24px; border-radius: 14px; font-size: 0.8rem;
        font-weight: 600; color: white; z-index: 999;
        animation: fadeInUp 0.3s ease; max-width: 90%; text-align: center;
        backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        background: rgba(200,170,110,0.9);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// PARTICLES
// ============================================================
function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'bg-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (8 + Math.random() * 12) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
        container.appendChild(p);
    }
}

// Close modals
document.getElementById('avatarModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeAvatarPicker();
});

// ============================================================
// PROMPT TELEGRAM ID
// ============================================================
function promptForTelegramId() {
    const input = prompt(
        'Введите ваш Telegram ID.\n\n' +
        'Чтобы узнать ID:\n' +
        '1. Напишите боту команду /myid\n' +
        '2. Скопируйте число\n' +
        '3. Вставьте сюда\n\n' +
        'ID сохранится и больше спрашивать не будет.'
    );
    if (input && /^\d+$/.test(input.trim())) {
        myTelegramId = parseInt(input.trim());
        localStorage.setItem('my_telegram_id', String(myTelegramId));
        showToast('✅ Telegram ID сохранён!');
        loadFriendsFromServer();
    }
}

// Expose
window.switchFriendsTab = switchFriendsTab;
window.openAvatarPicker = openAvatarPicker;
window.closeAvatarPicker = closeAvatarPicker;
window.selectAvatar = selectAvatar;
window.handleAvatarUpload = handleAvatarUpload;
window.searchForFriend = searchForFriend;
window.addFriend = addFriend;
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
window.removeFriend = removeFriend;
window.openChat = openChat;
window.closeChat = closeChat;
window.sendMsg = sendMsg;
window.challengeFriend = challengeFriend;
window.challengeFriendById = challengeFriendById;
window.promptForTelegramId = promptForTelegramId;
