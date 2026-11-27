/**
 * SHOOTOUT 4 — Supabase Realtime の最小クライアント（Phoenix channels over WebSocket）
 *
 * broadcast（小さなJSONを全員へ）と presence（いま誰がいるか）だけを使う。
 * データベース・Edge Function・認証アカウントは使わない。SDK も積まない。
 * 切断時は指数バックオフで再接続し、無音で固まったソケットも作り直す
 * （JANKeN PoN / CODE DUEL / ICE WOLF と同じ games-realtime 実装）。
 */

const HEARTBEAT_MS = 25000;
const MAX_RETRY_MS = 15000;
const CONNECT_TIMEOUT_MS = 5000;
const JOIN_TIMEOUT_MS = 7000;
const WEDGE_DIALS = 3;
/** サーバーから phx_close で切られたチャンネルを join し直す間隔（Build 11） */
const REJOIN_MIN_MS = 400;
const REJOIN_MAX_MS = 8000;
const REJOIN_ATTEMPTS = 8;

export function realtimeUrl(baseUrl, anonKey) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/realtime/v1/websocket';
  url.search = `?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
  return url.toString();
}

/** Presence は {key: {metas: [...]}} で来る。読める形の配列にする。 */
export function presenceMembers(state = {}) {
  const members = [];
  for (const [key, value] of Object.entries(state || {})) {
    const metas = Array.isArray(value && value.metas) ? value.metas : [];
    for (const meta of metas) members.push({ key, ...meta });
  }
  return members;
}

export class RealtimeClient {
  constructor({
    url,
    key,
    WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
    schedule = setTimeout,
    clear = clearTimeout,
    random = Math.random,
    now = () => Date.now(),
    clientId = null,
  } = {}) {
    this.url = url;
    this.key = key;
    this.WebSocketImpl = WebSocketImpl;
    /* setTimeout をそのまま持つと、メソッド呼び出しの this が変わって
       「Illegal invocation」になる。必ず包んで呼ぶ。 */
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.random = random;
    this.now = now;
    this.socket = null;
    this.topics = new Map();
    this.status = 'idle';
    this.closed = false;
    this.ref = 0;
    this.retry = 0;
    this.heartbeatId = null;
    this.retryId = null;
    this.clientId = clientId || `s4${Math.floor(random() * 1e9).toString(36)}`;
    this.onStatus = null;
    this.lastFrameAt = 0;
    this.lastError = '';
    this.connectingSince = 0;
    this.openedAt = 0;
    this.dials = 0;
    this.stuckDials = 0;
    this.wedged = false;
    this.sent = 0;
    this.received = 0;
    /* Build 11: phx_close されたチャンネルの join し直し（名前 → タイマーID） */
    this.rejoinIds = new Map();
  }

  /** 画面に出す1行（すべて実際に起きたこと） */
  step() {
    const socket = this.socket;
    const readyState = socket ? socket.readyState : -1;
    const state = readyState === 0
      ? 'connecting'
      : readyState === 1
        ? 'open'
        : readyState > 1
          ? 'closed'
          : this.retryId
            ? 'redial'
            : 'none';
    const joined = [...this.topics.values()].some((entry) => entry.joined);
    return {
      state, readyState, joined, dials: this.dials, stuck: this.stuckDials,
      wedged: this.wedged, sent: this.sent, received: this.received, lastError: this.lastError,
    };
  }

  connect() {
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    if (!this.WebSocketImpl) {
      this.setStatus('unavailable');
      return;
    }
    this.closed = false;
    this.setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    let socket;
    try {
      socket = new this.WebSocketImpl(realtimeUrl(this.url, this.key));
    } catch (error) {
      this.lastError = `ws-new: ${(error && error.message) || 'refused'}`;
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.dials += 1;
    this.connectingSince = this.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retry = 0;
      this.stuckDials = 0;
      this.wedged = false;
      this.connectingSince = 0;
      this.openedAt = this.now();
      this.lastFrameAt = this.now();
      this.lastError = '';
      this.setStatus('open');
      this.startHeartbeat();
      /* 開いた時点のトピックへ入り直す。onopen の途中で subscribe された
         トピックを二重に join しないよう、一覧を先に写す（Build 11） */
      for (const name of [...this.topics.keys()]) {
        const entry = this.topics.get(name);
        if (entry) entry.joinRetried = false;
        this.sendJoin(name);
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event && event.data);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) return;
      const detail = event && (event.message || event.type);
      this.lastError = detail ? `ws-error: ${detail}` : 'ws-error';
      this.setStatus('error');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      const code = event && typeof event.code === 'number' ? event.code : '?';
      const reason = event && event.reason ? ` ${event.reason}` : '';
      this.lastError = `ws-close ${code}${reason}`.trim();
      this.socket = null;
      this.connectingSince = 0;
      this.stopHeartbeat();
      if (this.closed) return;
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    const step = Math.min(MAX_RETRY_MS, 500 * 2 ** this.retry);
    const wait = Math.round(step * (0.75 + this.random() * 0.5));
    this.retry += 1;
    if (this.retryId) this.clear(this.retryId);
    this.retryId = this.schedule(() => {
      this.retryId = null;
      this.connect();
    }, wait);
    this.setStatus('reconnecting');
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (this.onStatus) this.onStatus(status);
    for (const entry of this.topics.values()) {
      if (entry.handlers && entry.handlers.onStatus) entry.handlers.onStatus(status);
    }
  }

  cycle(reason) {
    const socket = this.socket;
    this.socket = null;
    this.connectingSince = 0;
    this.stopHeartbeat();
    this.lastError = reason;
    if (reason === 'stalled' || String(reason).startsWith('ws-connecting')) {
      this.stuckDials += 1;
      this.wedged = this.stuckDials >= WEDGE_DIALS;
    }
    if (socket && socket.readyState <= 1) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    this.setStatus('reconnecting');
    this.scheduleReconnect();
  }

  /** ソケットがまだ何か運んでいるか（1秒に1回、画面側が呼ぶ） */
  checkAlive(now = this.now()) {
    if (this.closed) return false;
    const socket = this.socket;
    if (!socket) {
      if (!this.retryId) this.connect();
      return false;
    }
    if (socket.readyState === 0) {
      const waited = this.connectingSince ? now - this.connectingSince : 0;
      if (waited > CONNECT_TIMEOUT_MS) {
        this.lastError = `ws-connecting ${Math.round(waited / 1000)}s`;
        this.cycle(this.lastError);
        return false;
      }
      return true;
    }
    if (socket.readyState === 1) this.checkJoin(now);
    if (socket.readyState > 1) {
      this.socket = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
      return false;
    }
    if (now - (this.lastFrameAt || now) > HEARTBEAT_MS * 2 + 5000) {
      this.cycle('stalled');
      return false;
    }
    return true;
  }

  wake(now = this.now()) {
    if (this.closed) return false;
    if (!this.socket) {
      if (!this.retryId) this.connect();
      return false;
    }
    if (now - (this.lastFrameAt || 0) < HEARTBEAT_MS) return true;
    this.cycle('wake');
    return false;
  }

  checkJoin(now = this.now()) {
    if (!this.openedAt) return;
    for (const [name, entry] of this.topics) {
      if (entry.joined) continue;
      const since = entry.joinSentAt || this.openedAt;
      const waited = now - since;
      if (entry.joinRetried !== true && waited > JOIN_TIMEOUT_MS) {
        entry.joinRetried = true;
        this.sendJoin(name);
        continue;
      }
      if (waited > JOIN_TIMEOUT_MS * 2) {
        entry.lastError = entry.lastError || 'join-silent';
        this.lastError = entry.lastError;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    const beat = () => {
      this.sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: `hb${(this.ref += 1)}` });
      this.heartbeatId = this.schedule(beat, HEARTBEAT_MS);
    };
    this.heartbeatId = this.schedule(beat, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatId) this.clear(this.heartbeatId);
    this.heartbeatId = null;
  }

  subscribe(name, handlers = {}) {
    if (this.topics.has(name)) {
      const existing = this.topics.get(name);
      existing.handlers = handlers;
      existing.rejoinTries = 0;
      return name;
    }
    this.topics.set(name, { handlers, joined: false, joinRef: String((this.ref += 1)), presence: {}, rejoinTries: 0 });
    if (this.socket && this.socket.readyState === 1) this.sendJoin(name);
    else this.connect();
    return name;
  }

  sendJoin(name) {
    const entry = this.topics.get(name);
    if (!entry) return;
    entry.joined = false;
    entry.tracked = null;
    entry.joinSentAt = this.now();
    this.sendRaw({
      topic: `realtime:${name}`,
      event: 'phx_join',
      payload: {
        access_token: this.key,
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: this.clientId, enabled: true },
          postgres_changes: [],
        },
      },
      ref: entry.joinRef,
      join_ref: entry.joinRef,
    });
  }

  broadcast(name, event, payload) {
    const entry = this.topics.get(name);
    if (!entry) return false;
    this.sendRaw({
      topic: `realtime:${name}`,
      event: 'broadcast',
      payload: { type: 'broadcast', event, payload },
      ref: null,
      join_ref: entry.joinRef,
    });
    return true;
  }

  track(name, meta) {
    const entry = this.topics.get(name);
    if (!entry) return false;
    const body = JSON.stringify(meta || {});
    if (entry.tracked === body) return true;
    const sent = this.sendRaw({
      topic: `realtime:${name}`,
      event: 'presence',
      payload: { type: 'presence', event: 'track', payload: meta || {} },
      ref: null,
      join_ref: entry.joinRef,
    });
    if (sent) entry.tracked = body;
    return sent;
  }

  unsubscribe(name) {
    const entry = this.topics.get(name);
    if (!entry) return;
    this.cancelRejoin(name);
    this.sendRaw({ topic: `realtime:${name}`, event: 'phx_leave', payload: {}, ref: String((this.ref += 1)) });
    this.topics.delete(name);
  }

  /**
   * 予期しない phx_close（サーバーからの切断）を受けたチャンネルを join し直す（Build
   * 11）。Build 10 までは status を閉じたまま黙って捨てていたため、試合中に通信が
   * サイレント死してフリーズした。少し待ってから同じトピックへ入り直し、
   * それでも閉じられ続けるときだけ error を出して諦める。
   */
  onTopicClosed(name, entry) {
    if (this.closed || !this.topics.has(name)) return;
    entry.rejoinTries = (entry.rejoinTries || 0) + 1;
    if (entry.rejoinTries > REJOIN_ATTEMPTS) {
      this.cancelRejoin(name);
      entry.lastError = entry.lastError || 'rejoin-gave-up';
      this.lastError = entry.lastError;
      if (entry.handlers && entry.handlers.onStatus) entry.handlers.onStatus('error');
      return;
    }
    this.scheduleRejoin(name, entry.rejoinTries);
  }

  scheduleRejoin(name, tries = 1) {
    if (this.closed || !this.topics.has(name)) return;
    if (this.rejoinIds.has(name)) return;
    const step = Math.min(REJOIN_MAX_MS, REJOIN_MIN_MS * 2 ** (Math.max(1, tries) - 1));
    const wait = Math.round(step * (0.8 + this.random() * 0.4));
    const id = this.schedule(() => {
      this.rejoinIds.delete(name);
      if (this.closed || !this.topics.has(name)) return;
      if (this.socket && this.socket.readyState === 1) this.sendJoin(name);
      else this.connect();
    }, wait);
    this.rejoinIds.set(name, id);
  }

  cancelRejoin(name) {
    const id = this.rejoinIds.get(name);
    if (id) this.clear(id);
    this.rejoinIds.delete(name);
  }

  joined(name) {
    return Boolean(this.topics.get(name)?.joined);
  }

  sendRaw(message) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(message));
      this.sent += 1;
      return true;
    } catch {
      return false;
    }
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!message || !message.topic) return;
    this.received += 1;
    this.lastFrameAt = this.now();
    const name = message.topic.startsWith('realtime:') ? message.topic.slice('realtime:'.length) : message.topic;
    const entry = this.topics.get(name);
    if (!entry) return;

    if (message.event === 'phx_reply') {
      if (message.ref == null || String(message.ref) !== entry.joinRef) return;
      const ok = message.payload && message.payload.status === 'ok';
      const wasJoined = entry.joined;
      if (ok) entry.rejoinTries = 0;
      entry.joined = ok;
      if (ok && !wasJoined && entry.handlers.onStatus) entry.handlers.onStatus('joined');
      if (!ok) {
        const response = (message.payload && message.payload.response) || {};
        entry.lastError = response.reason || response.message || 'join rejected';
        this.lastError = entry.lastError;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
      return;
    }
    if (message.event === 'system') {
      const payload = message.payload || {};
      if (payload.status === 'error') {
        entry.lastError = payload.message || 'system error';
        this.lastError = entry.lastError;
        entry.joined = false;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
      return;
    }
    if (message.event === 'presence_state') {
      entry.presence = message.payload || {};
      if (entry.handlers.onPresence) {
        entry.handlers.onPresence({ state: entry.presence, joins: null, leaves: null, members: presenceMembers(entry.presence) });
      }
      return;
    }
    if (message.event === 'presence_diff') {
      const diff = message.payload || {};
      for (const key of Object.keys(diff.leaves || {})) delete entry.presence[key];
      for (const [key, value] of Object.entries(diff.joins || {})) entry.presence[key] = value;
      if (entry.handlers.onPresence) {
        entry.handlers.onPresence({ state: entry.presence, joins: diff.joins || null, leaves: diff.leaves || null, members: presenceMembers(entry.presence) });
      }
      return;
    }
    if (message.event === 'broadcast') {
      const payload = message.payload || {};
      if (entry.handlers.onBroadcast) entry.handlers.onBroadcast(payload.event, payload.payload);
      return;
    }
    if (message.event === 'phx_error' || message.event === 'phx_close') {
      /*
       * Build 11: 現役のトピック（unsubscribe 済みなら topics から消えている）が
       * サーバー側で閉じられた。在室を信じずに捨て、少し待って入り直す。
       * 入り直せば subscribed の通知で在室（presence）を1回だけ送り直す。
       */
      entry.joined = false;
      entry.presence = {};
      if (entry.handlers.onStatus) entry.handlers.onStatus('closed');
      this.onTopicClosed(name, entry);
    }
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retryId) this.clear(this.retryId);
    this.retryId = null;
    for (const id of this.rejoinIds.values()) this.clear(id);
    this.rejoinIds.clear();
    this.topics.clear();
    if (this.socket && this.socket.readyState <= 1) this.socket.close();
    this.socket = null;
    this.setStatus('closed');
  }
}

