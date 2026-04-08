/**
 * ISERVERI Website — Auth Module
 * No Telegram dependency. Pure WoT-based identity.
 */

const API_BASE = 'https://mir-tankov-production.up.railway.app';

class Auth {
  constructor() {
    this.userId     = localStorage.getItem('ws_user_id') || null;
    this.username   = localStorage.getItem('ws_username') || null;
    this.wotId      = localStorage.getItem('ws_wot_id') || null;
    this.isLoggedIn = !!this.userId;
    this.isPremium  = localStorage.getItem('ws_premium') === '1';
    this.isAdmin    = parseInt(this.userId) === 6507474079;
    this.balance    = parseInt(localStorage.getItem('ws_balance') || '0');
  }

  /** Save user to localStorage after login */
  _save({ userId, username, wotId, isPremium, balance }) {
    this.userId     = String(userId);
    this.username   = username || 'Танкист';
    this.wotId      = wotId || null;
    this.isLoggedIn = true;
    this.isPremium  = !!isPremium;
    this.isAdmin    = parseInt(this.userId) === 6507474079;
    this.balance    = balance || 0;

    localStorage.setItem('ws_user_id',  this.userId);
    localStorage.setItem('ws_username', this.username);
    localStorage.setItem('ws_premium',  this.isPremium ? '1' : '0');
    localStorage.setItem('ws_balance',  String(this.balance));
    localStorage.setItem('my_telegram_id', this.userId); // compat with existing pages
    if (this.wotId) localStorage.setItem('ws_wot_id', this.wotId);
  }

  /** Login by WoT nickname (searches existing users) */
  async loginByNickname(nickname) {
    const resp = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(nickname)}`);
    if (!resp.ok) throw new Error('Сервер недоступен');
    const data = await resp.json();

    if (!data.users || data.users.length === 0) {
      throw new Error('Игрок с таким никнеймом не найден в клубе. Сначала зарегистрируйтесь через Telegram-бота или введите ваш точный WoT никнейм.');
    }

    const user = data.users[0];
    await this._fetchAndSave(user.telegram_id);
    return this.username;
  }

  /** Login by numeric ID (Telegram ID) */
  async loginById(id) {
    await this._fetchAndSave(id);
    return this.username;
  }

  /** Fetch full user profile and save session */
  async _fetchAndSave(telegramId) {
    const resp = await fetch(`${API_BASE}/api/me?telegram_id=${telegramId}`);
    if (!resp.ok) throw new Error('Ошибка сервера');
    const data = await resp.json();

    if (!data || !data.telegram_id) {
      throw new Error('Пользователь не найден');
    }

    this._save({
      userId:    data.telegram_id,
      username:  data.wot_nickname || data.first_name || data.username || 'Танкист',
      wotId:     data.wot_account_id || null,
      isPremium: !!data.is_subscribed,
      balance:   data.cheese || 0,
    });
  }

  /** Refresh balance from API */
  async refreshBalance() {
    if (!this.userId) return 0;
    try {
      const resp = await fetch(`${API_BASE}/api/me?telegram_id=${this.userId}`);
      const data = await resp.json();
      if (data && data.cheese !== undefined) {
        this.balance = data.cheese;
        localStorage.setItem('ws_balance', String(this.balance));
        this.isPremium = !!data.is_subscribed;
        localStorage.setItem('ws_premium', this.isPremium ? '1' : '0');
      }
      return this.balance;
    } catch {
      return this.balance;
    }
  }

  /** Full logout */
  logout() {
    const keys = ['ws_user_id','ws_username','ws_wot_id','ws_premium','ws_balance','my_telegram_id'];
    keys.forEach(k => localStorage.removeItem(k));
    this.userId     = null;
    this.username   = null;
    this.wotId      = null;
    this.isLoggedIn = false;
    this.isPremium  = false;
    this.balance    = 0;
    window.location.href = 'index.html';
  }

  /** Redirect to login if not authenticated */
  requireAuth() {
    if (!this.isLoggedIn) {
      const current = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `index.html?redirect=${current}`;
      return false;
    }
    return true;
  }

  /** URL-safe user ID getter */
  getId() {
    return this.userId || '';
  }
}

// ─── Global singleton ─────────────────────────────────
const auth = new Auth();
window.auth = auth;
window.API_BASE = API_BASE;

// ─── Navigate to page with user context ───────────────
function goTo(page) {
  const sep = page.includes('?') ? '&' : '?';
  window.location.href = `${page}${sep}_t=${Date.now()}&telegram_id=${auth.getId()}`;
}
window.goTo = goTo;

// ─── Update all balance elements on page ──────────────
function updateBalanceUI(balance) {
  document.querySelectorAll('[data-balance]').forEach(el => {
    el.textContent = Number(balance).toLocaleString();
  });
  document.querySelectorAll('[data-balance-short]').forEach(el => {
    const n = Number(balance);
    el.textContent = n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
  });
}
window.updateBalanceUI = updateBalanceUI;

// ─── Auto-refresh balance every 60s when logged in ────
if (auth.isLoggedIn) {
  auth.refreshBalance().then(b => updateBalanceUI(b));
  setInterval(() => auth.refreshBalance().then(b => updateBalanceUI(b)), 60000);
}
