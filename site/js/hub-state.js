/**
 * HUB STATE MANAGER — TankHub Platform
 * 
 * Управляет контекстом: какой стример сейчас просматривается,
 * роль пользователя (стример / фанат), и проброс streamer_id в API.
 * 
 * Не трогает логику Арены! Только оборачивает в контекст стримера.
 */

window.TankHub = (function() {
    'use strict';

    const API_BASE = 'https://mir-tankov-production.up.railway.app';
    
    // ── State ──
    const state = {
        currentStreamerId: null,   // telegram_id стримера, чью страницу смотрим
        currentStreamerSlug: null,  // slug стримера (url-friendly ник)
        currentStreamerName: null,  // display name стримера
        myTelegramId: null,        // мой telegram_id
        myRole: null,              // 'streamer' | 'fan' | null
        isStreamerOwner: false,     // я == текущий стример?
    };

    // ── Init: определяем пользователя ──
    function init() {
        // 1. Telegram SDK
        const tg = window.Telegram?.WebApp;
        if (tg?.initDataUnsafe?.user?.id) {
            state.myTelegramId = tg.initDataUnsafe.user.id;
            localStorage.setItem('my_telegram_id', String(state.myTelegramId));
        }
        // 2. URL params
        const params = new URLSearchParams(window.location.search);
        const urlId = params.get('telegram_id');
        if (urlId) {
            state.myTelegramId = parseInt(urlId);
            localStorage.setItem('my_telegram_id', String(state.myTelegramId));
        }
        // 3. localStorage fallback
        if (!state.myTelegramId) {
            state.myTelegramId = parseInt(localStorage.getItem('my_telegram_id')) || null;
        }

        // Загрузить streamer_id из URL или sessionStorage
        const streamerId = params.get('streamer_id');
        if (streamerId) {
            setCurrentStreamer(parseInt(streamerId));
        } else {
            const saved = sessionStorage.getItem('hub_streamer_id');
            if (saved) {
                state.currentStreamerId = parseInt(saved);
                state.currentStreamerName = sessionStorage.getItem('hub_streamer_name') || null;
                state.currentStreamerSlug = sessionStorage.getItem('hub_streamer_slug') || null;
                _updateOwnerFlag();
            }
        }

        // Определяем роль
        const savedRole = localStorage.getItem('hub_role');
        if (savedRole) state.myRole = savedRole;
    }

    // ── Установить текущего стримера ──
    function setCurrentStreamer(telegramId, name, slug) {
        state.currentStreamerId = telegramId;
        state.currentStreamerName = name || state.currentStreamerName;
        state.currentStreamerSlug = slug || state.currentStreamerSlug;
        sessionStorage.setItem('hub_streamer_id', String(telegramId));
        if (name) sessionStorage.setItem('hub_streamer_name', name);
        if (slug) sessionStorage.setItem('hub_streamer_slug', slug);
        _updateOwnerFlag();
    }

    function _updateOwnerFlag() {
        state.isStreamerOwner = !!(state.myTelegramId && state.currentStreamerId && 
            state.myTelegramId === state.currentStreamerId);
    }

    // ── Роль ──
    function setRole(role) {
        state.myRole = role;
        localStorage.setItem('hub_role', role);
    }

    // ── Навигация с контекстом стримера ──
    function navigateTo(url) {
        const sep = url.includes('?') ? '&' : '?';
        let fullUrl = url + `${sep}_t=${Date.now()}`;
        if (state.myTelegramId) {
            fullUrl += `&telegram_id=${state.myTelegramId}`;
        }
        if (state.currentStreamerId) {
            fullUrl += `&streamer_id=${state.currentStreamerId}`;
        }
        window.location.href = fullUrl;
    }

    // ── API helper: добавить streamer_id к URL ──
    function apiUrl(endpoint) {
        const url = new URL(endpoint, API_BASE);
        if (state.currentStreamerId) {
            url.searchParams.set('streamer_id', state.currentStreamerId);
        }
        return url.toString();
    }

    // ── Загрузка списка стримеров ──
    async function loadStreamers() {
        try {
            const resp = await fetch(`${API_BASE}/api/bloggers/`);
            if (!resp.ok) throw new Error('API error');
            return await resp.json();
        } catch (e) {
            console.warn('[TankHub] loadStreamers error:', e);
            // Fallback: загрузить из tankhub API
            try {
                const resp2 = await fetch(`${API_BASE}/api/tankhub/streamers`);
                if (resp2.ok) return await resp2.json();
            } catch (e2) {}
            return [];
        }
    }

    // ── Загрузить профиль стримера ──
    async function loadStreamerProfile(streamerId) {
        try {
            const resp = await fetch(`${API_BASE}/api/me?telegram_id=${streamerId}`);
            if (resp.ok) return await resp.json();
        } catch (e) {}
        return null;
    }

    // ── Public API ──
    return {
        get state() { return { ...state }; },
        get streamerId() { return state.currentStreamerId; },
        get myId() { return state.myTelegramId; },
        get isOwner() { return state.isStreamerOwner; },
        get role() { return state.myRole; },
        get apiBase() { return API_BASE; },
        init,
        setCurrentStreamer,
        setRole,
        navigateTo,
        apiUrl,
        loadStreamers,
        loadStreamerProfile,
    };
})();

// Автоинициализация
document.addEventListener('DOMContentLoaded', () => TankHub.init());
