/**
 * ISERVERI Website — API Client
 * Centralized access to Railway backend
 */

const API = {
  BASE: 'https://mir-tankov-production.up.railway.app',

  // ── Generic fetch helper ──────────────────────────────
  async get(path, params = {}) {
    const url = new URL(API.BASE + path);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  },

  async post(path, body = {}) {
    const resp = await fetch(API.BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  },

  // ── User / Auth ───────────────────────────────────────
  getMe(telegramId) {
    return API.get('/api/me', { telegram_id: telegramId });
  },

  searchUsers(query) {
    return API.get('/api/users/search', { q: query });
  },

  getTotalUsers() {
    return API.get('/api/stats/total_users');
  },

  // ── Profile ───────────────────────────────────────────
  getBattleStats(telegramId) {
    return API.get('/api/profile/battle-stats', { telegram_id: telegramId });
  },

  // ── WoT Stats (Lesta API via backend) ─────────────────
  getWotStats(telegramId) {
    return API.get('/api/wot/stats', { telegram_id: telegramId });
  },

  // ── Streams ───────────────────────────────────────────
  getStreamStatus() {
    return API.get('/api/streams/status');
  },

  // ── Leaderboard ───────────────────────────────────────
  getLeaderboard(type = 'cheese', limit = 20) {
    return API.get('/api/leaderboard/' + type, { limit });
  },

  // ── Wheel of Fortune ──────────────────────────────────
  spinWheel(telegramId) {
    return API.post('/api/wheel/spin', { telegram_id: telegramId });
  },

  getWheelStatus(telegramId) {
    return API.get('/api/wheel/status', { telegram_id: telegramId });
  },

  // ── Arena ─────────────────────────────────────────────
  getArenaChallenges(telegramId) {
    return API.get('/api/arena/challenges', { telegram_id: telegramId });
  },

  createArenaChallenge(telegramId, targetId, bet) {
    return API.post('/api/arena/challenge', {
      telegram_id: telegramId,
      target_id: targetId,
      bet,
    });
  },

  acceptArenaChallenge(telegramId, challengeId) {
    return API.post('/api/arena/accept', {
      telegram_id: telegramId,
      challenge_id: challengeId,
    });
  },

  // ── Donate ────────────────────────────────────────────
  sendDonate(telegramId, message, amount) {
    return API.post('/api/donate/stream', {
      telegram_id: telegramId,
      message,
      amount,
    });
  },

  sendMusicRequest(telegramId, trackName, amount) {
    return API.post('/api/donate/music', {
      telegram_id: telegramId,
      track: trackName,
      amount,
    });
  },

  // ── Daily reward ──────────────────────────────────────
  claimDaily(telegramId) {
    return API.post('/api/daily/claim', { telegram_id: telegramId });
  },

  getDailyStatus(telegramId) {
    return API.get('/api/daily/status', { telegram_id: telegramId });
  },

  // ── Global Challenge ──────────────────────────────────
  getGlobalChallenge() {
    return API.get('/api/global-challenge/current');
  },

  getGlobalParticipants() {
    return API.get('/api/global-challenge/participants');
  },

  // ── Quiz ──────────────────────────────────────────────
  getQuizQuestion() {
    return API.get('/api/quiz/question');
  },

  submitQuizAnswer(telegramId, questionId, answer, bet) {
    return API.post('/api/quiz/answer', {
      telegram_id: telegramId,
      question_id: questionId,
      answer,
      bet,
    });
  },

  // ── Subscribe ─────────────────────────────────────────
  getSubscribePlans() {
    return API.get('/api/subscribe/plans');
  },

  // ── Friends ───────────────────────────────────────────
  getFriends(telegramId) {
    return API.get('/api/friends', { telegram_id: telegramId });
  },
};

window.API = API;
