/**
 * Friends JS — Друзья, чат, аватарки, вызов на дуэль
 * Без тестовых данных — реальный поиск через Lesta API
 */

// ============================================================
// STATE  
// ============================================================
let myTelegramId = 0;
let currentChatFriend = null;
const AVATAR_KEY = 'wot_user_avatar';
const FRIENDS_KEY = 'wot_friends';
const MESSAGES_KEY = 'wot_messages';
const LESTA_API = 'https://api.tanki.su/wot';
const LESTA_APP = 'c984faa7dc529f4cb0139505d5e8043c';

// Эмодзи для выбора аватарки
const AVATAR_EMOJIS = [
    '🪖', '🎖️', '⭐', '🔥', '💀', '🐉',
    '🦅', '🐺', '🦁', '🐻', '🦊', '🐯',
    '👑', '💎', '🎯', '🛡️', '⚔️', '🏆',
    '🚀', '💣', '🔫', '🪓', '⚡', '🌟',
    '😎', '🤖', '👾', '🎃', '💜', '❤️',
];

// Друзья из localStorage (без демо-данных!)
// status: 'accepted' | 'pending' (ожидает подтверждения)
let friends = JSON.parse(localStorage.getItem(FRIENDS_KEY) || '[]');
let friendRequests = JSON.parse(localStorage.getItem('wot_friend_requests') || '[]');
let messages = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '{}');

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Получаем Telegram ID
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        const nameEl = document.getElementById('myName');
        if (nameEl) nameEl.textContent = tg.initDataUnsafe.user.first_name || 'Танкист';
    }

    loadAvatar();
    renderFriends();
    renderRequests();
    createParticles();

    // Enter в поле поиска
    const searchInput = document.getElementById('friendSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchForFriend();
        });
    }
});

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
    avatarEl.textContent = emoji;
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
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            localStorage.setItem(AVATAR_KEY, dataUrl);
            const avatarEl = document.getElementById('myAvatar');
            avatarEl.innerHTML = `<img src="${dataUrl}" alt="avatar">`;
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
// RENDER FRIENDS (с разными цветами по статусу)
// ============================================================
function renderFriends() {
    const list = document.getElementById('friendsList');
    if (!friends.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">👥</div>
            <div class="empty-state__text">У тебя пока нет друзей.<br>Найди игрока и добавь!</div></div>`;
        return;
    }

    // Сортируем: принятые сверху, потом ожидающие
    const sorted = [...friends].sort((a, b) => {
        if (a.status === 'accepted' && b.status !== 'accepted') return -1;
        if (a.status !== 'accepted' && b.status === 'accepted') return 1;
        return 0;
    });

    list.innerHTML = sorted.map((f, i) => {
        const avatarContent = f.avatar && f.avatar.startsWith('data:')
            ? `<img src="${f.avatar}" alt="">` : (f.avatar || '🪖');
        const isPending = f.status === 'pending';
        const statusClass = isPending ? 'friend-card--pending' : 'friend-card--accepted';
        const statusLabel = isPending ? '⏳ Ожидает подтверждения' : (f.online ? '🟢 В сети' : '⚫ Был недавно');
        const onlineClass = (!isPending && f.online) ? 'friend-card__avatar--online' : '';

        return `
        <div class="friend-card ${statusClass}" style="animation-delay: ${i * 0.05}s">
            <div class="friend-card__avatar ${onlineClass}">${avatarContent}</div>
            <div class="friend-card__info" onclick="${isPending ? '' : `openChat('${f.account_id || f.telegram_id}')`}">
                <div class="friend-card__name">${f.name}</div>
                <div class="friend-card__wot">${f.wot_nick || 'Ник не привязан'}</div>
                <div class="friend-card__status-label" style="font-size:0.6rem;color:${isPending ? '#5A6577' : '#4ade80'};margin-top:2px;">${statusLabel}</div>
            </div>
            <div class="friend-card__actions">
                ${isPending ? `
                    <button class="friend-card__action" style="opacity:0.4;cursor:default" title="Ожидает">⏳</button>
                ` : `
                    <button class="friend-card__action friend-card__action--chat" onclick="openChat('${f.account_id || f.telegram_id}')" title="Чат">💬</button>
                    <button class="friend-card__action friend-card__action--duel" onclick="challengeFriendById('${f.account_id || f.telegram_id}')" title="Дуэль">⚔️</button>
                `}
                <button class="friend-card__action friend-card__action--remove" onclick="removeFriend('${f.account_id || f.telegram_id}')" title="Удалить">✕</button>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// FRIEND REQUESTS (входящие)
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

    list.innerHTML = friendRequests.map(r => `
        <div class="request-card">
            <div class="request-card__avatar">${r.avatar || '🪖'}</div>
            <div class="request-card__info">
                <div class="request-card__name">${r.name}</div>
                <div class="request-card__sub">${r.wot_nick || ''}</div>
            </div>
            <div class="request-btns">
                <button class="request-btn-accept" onclick="acceptRequest('${r.account_id}')">✅ Принять</button>
                <button class="request-btn-decline" onclick="declineRequest('${r.account_id}')">✕</button>
            </div>
        </div>
    `).join('');
}

function acceptRequest(accountId) {
    const req = friendRequests.find(r => r.account_id === accountId);
    if (req) {
        // Удаляем из запросов, добавляем как друга (accepted)
        friends.push({ ...req, status: 'accepted', online: false });
        friendRequests = friendRequests.filter(r => r.account_id !== accountId);
        saveFriends();
        saveFriendRequests();
        renderFriends();
        renderRequests();
        showToast(`✅ ${req.name} теперь ваш друг!`);
    }
}

function declineRequest(accountId) {
    friendRequests = friendRequests.filter(r => r.account_id !== accountId);
    saveFriendRequests();
    renderRequests();
    showToast('Запрос отклонён');
}

// ============================================================
// REMOVE FRIEND
// ============================================================
function removeFriend(id) {
    if (!confirm('Удалить из друзей?')) return;
    const friend = friends.find(f => (f.account_id || f.telegram_id) == id);
    friends = friends.filter(f => (f.account_id || f.telegram_id) != id);
    saveFriends();
    renderFriends();
    showToast(`${friend?.name || 'Друг'} удалён`);
}

// ============================================================
// SEARCH FOR FRIEND — РЕАЛЬНЫЙ ПОИСК ЧЕРЕЗ LESTA API
// ============================================================
async function searchForFriend() {
    const query = document.getElementById('friendSearchInput').value.trim();
    if (query.length < 2) {
        showToast('Введите минимум 2 символа');
        return;
    }

    const results = document.getElementById('friendSearchResults');
    results.innerHTML = `<div style="text-align:center;padding:20px;color:#5A6577">
        <div style="font-size:1.5rem;margin-bottom:8px">🔍</div>
        Ищем «${query}»...
    </div>`;

    try {
        const url = `${LESTA_API}/account/list/?application_id=${LESTA_APP}&search=${encodeURIComponent(query)}&type=startswith&limit=10`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data || data.data.length === 0) {
            results.innerHTML = `<div class="empty-state" style="padding:30px">
                <div class="empty-state__icon">😕</div>
                <div class="empty-state__text">Игрок «${query}» не найден в Мир Танков</div>
            </div>`;
            return;
        }

        results.innerHTML = data.data.map(player => {
            const alreadyFriend = friends.some(f => f.account_id === String(player.account_id));
            const isPending = friends.some(f => f.account_id === String(player.account_id) && f.status === 'pending');

            let actionBtn = '';
            if (alreadyFriend && !isPending) {
                actionBtn = `<span style="font-size:0.7rem;color:#4ade80;font-weight:700;padding:8px 12px;">✅ Друг</span>`;
            } else if (isPending) {
                actionBtn = `<span style="font-size:0.7rem;color:#5A6577;font-weight:700;padding:8px 12px;">⏳ Запрос</span>`;
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
        console.error('Search error:', err);
        results.innerHTML = `<div class="empty-state" style="padding:30px">
            <div class="empty-state__icon">⚠️</div>
            <div class="empty-state__text">Ошибка поиска. Проверьте интернет.</div>
        </div>`;
    }
}

function addFriend(name, accountId) {
    // Проверяем что уже нет
    if (friends.some(f => f.account_id === String(accountId))) {
        showToast('Уже в друзьях!');
        return;
    }

    const newFriend = {
        account_id: String(accountId),
        telegram_id: null,
        name: name,
        wot_nick: name,
        avatar: '🪖',
        online: false,
        status: 'pending',  // ← Ожидает подтверждения!
        addedAt: Date.now(),
    };

    friends.push(newFriend);
    saveFriends();
    renderFriends();
    showToast(`📩 Запрос отправлен ${name}!`);

    // Обновляем кнопку в поиске
    searchForFriend();
}

// ============================================================
// CHAT
// ============================================================
function openChat(id) {
    currentChatFriend = friends.find(f => (f.account_id || f.telegram_id) == id);
    if (!currentChatFriend) return;

    // Если pending — не открываем чат
    if (currentChatFriend.status === 'pending') {
        showToast('⏳ Дождитесь подтверждения дружбы');
        return;
    }

    const avatarContent = currentChatFriend.avatar && currentChatFriend.avatar.startsWith('data:')
        ? `<img src="${currentChatFriend.avatar}" alt="">` : (currentChatFriend.avatar || '🪖');

    document.getElementById('chatAvatar').innerHTML = avatarContent;
    document.getElementById('chatName').textContent = currentChatFriend.name;
    document.getElementById('chatStatus').textContent = currentChatFriend.online ? '🟢 В сети' : '⚫ Был недавно';

    const chatId = currentChatFriend.account_id || currentChatFriend.telegram_id;
    renderMessages(chatId);
    document.getElementById('chatOverlay').classList.add('chat-overlay--open');
    document.getElementById('chatInput').focus();
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('chat-overlay--open');
    currentChatFriend = null;
}

function renderMessages(friendId) {
    const container = document.getElementById('chatMessages');
    const chatMsgs = messages[friendId] || [];

    if (!chatMsgs.length) {
        container.innerHTML = `<div class="empty-state" style="padding:60px 20px">
            <div class="empty-state__icon">💬</div>
            <div class="empty-state__text">Напиши первое сообщение!</div>
        </div>`;
        return;
    }

    container.innerHTML = chatMsgs.map(m => {
        const time = new Date(m.time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg ${m.mine ? 'msg--mine' : 'msg--theirs'}">
            ${m.text}
            <div class="msg__time">${time}</div>
        </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function sendMsg() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !currentChatFriend) return;

    const friendId = currentChatFriend.account_id || currentChatFriend.telegram_id;
    if (!messages[friendId]) messages[friendId] = [];

    messages[friendId].push({
        text: text,
        mine: true,
        time: Date.now(),
    });

    input.value = '';
    saveMessages();
    renderMessages(friendId);

    // Отправляем через Telegram WebApp (бот обработает и доставит)
    try {
        if (window.Telegram?.WebApp) {
            Telegram.WebApp.sendData(JSON.stringify({
                type: 'friend_message',
                to_account_id: friendId,
                message: text,
            }));
        }
    } catch (e) {
        console.warn('Message send error:', e);
    }
}

// ============================================================
// CHALLENGE FRIEND
// ============================================================
function challengeFriend() {
    if (!currentChatFriend) return;
    challengeFriendById(currentChatFriend.account_id || currentChatFriend.telegram_id);
}

function challengeFriendById(id) {
    const friend = friends.find(f => (f.account_id || f.telegram_id) == id);
    if (!friend) return;

    const params = new URLSearchParams({
        opponent: friend.wot_nick || friend.name,
        opponent_id: id,
    });
    window.location.href = `challenges.html?${params.toString()}`;
}

// ============================================================
// PERSISTENCE
// ============================================================
function saveFriends() {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
}

function saveFriendRequests() {
    localStorage.setItem('wot_friend_requests', JSON.stringify(friendRequests));
}

function saveMessages() {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
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

// Close modals on overlay click
document.getElementById('avatarModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeAvatarPicker();
});

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
