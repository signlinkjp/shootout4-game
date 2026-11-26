/**
 * SHOOTOUT 4 — 通信対戦（Supabase Realtime の broadcast / presence だけ）
 *
 * 部屋はチャンネル名そのもの。データベースも認証も使わない。
 *
 *   クイックマッチ  shootout-quick:{world|国コード}:{domestic|world}
 *   フレンド対戦    shootout-room:{コード}
 *   対戦            shootout-match:{id1-id2}（2人のIDから決まる名前）
 *   ランキング      shootout-rank:{scope}
 *
 * 1本ごとに、蹴る側は「狙い」、止める側は「飛ぶ方向」を1つ送る。
 * 両方そろった瞬間に、どちらの端末でも同じ判定（core/rules.js）で結果が出る。
 * 7秒＋猶予で片方が来ないときはホストが欠けた分を決めて配る（全員が同じ結果）。
 *
 * 安全: 自由入力のチャットは無い（定型スタンプのみ・4秒あき）。受信は
 * validateOnlineKick / validateStamp で検証し、大きすぎる電文は捨てる。
 */

import { CONFIG } from '../config.js';
import { DIRECTIONS, MISS, isPick, payloadTooLarge, validateOnlineKick, validateStamp, MAX_TOTAL_KICKS } from '../core/rules.js';
import { RealtimeClient, realtimeUrl, presenceMembers } from './realtime.js';

export { RealtimeClient, realtimeUrl, presenceMembers };

const injected = () => {
  if (typeof window === 'undefined') return null;
  const value = window.SHOOTOUT_ONLINE;
  return value && typeof value === 'object' ? value : null;
};

export function onlineConfig() {
  const extra = injected();
  const url = (extra && extra.url) || CONFIG.supabase.url;
  const key = (extra && extra.key) || CONFIG.supabase.anonKey;
  const off = Boolean(extra && extra.off);
  const configured = !off && Boolean(url && key && /^https:\/\//.test(url) && String(key).length > 20);
  return { url, key, configured };
}

export function onlineConfigured() {
  return onlineConfig().configured;
}

export const CHANNEL_PREFIX = 'shootout';

export function quickChannel({ scope = 'domestic', country = 'JP' } = {}) {
  const where = scope === 'world' ? 'world' : String(country || 'JP').toUpperCase();
  return `shootout-quick:${where}:${scope === 'world' ? 'world' : 'domestic'}`;
}

export function roomChannel(code) {
  return `shootout-room:${normalizeCode(code)}`;
}

export function matchChannel(keyA, keyB) {
  return `shootout-match:${[String(keyA), String(keyB)].sort().join('-')}`;
}

export function rankChannel({ scope = 'domestic' } = {}) {
  return `shootout-rank:${scope === 'world' ? 'world' : 'domestic'}`;
}

export function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidCode(code) {
  return normalizeCode(code).length >= 4;
}

export function randomCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export function fallbackDirection(round, seed = 0) {
  const index = Math.abs(Math.floor(Number(round) * 7 + Number(seed) * 13)) % DIRECTIONS.length;
  return DIRECTIONS[index];
}

const JOIN_WAIT_MS = 8000;
const MATCH_JOIN_WAIT_MS = 15000;
const WAIT_LINGER_MS = 2500;
const REVEAL_GRACE_MS = 1400;
export const ONLINE_TURN_MS = 7000;
export const MATCH_TIMEOUT_MS = 30000;
/** キーパーの左右位置を相手へ送る間隔（80〜120ms。毎フレーム送らない） */
export const KEEPER_SYNC_MS = 100;

export class ShootoutSession {
  constructor({
    client,
    onEvent = () => {},
    now = () => Date.now(),
    schedule = setTimeout,
    clear = clearTimeout,
    random = Math.random,
    matchWaitMs = MATCH_JOIN_WAIT_MS,
  } = {}) {
    this.client = client;
    this.onEvent = onEvent;
    this.now = now;
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.random = random;
    this.matchWaitMs = matchWaitMs;
    this.mode = null;
    this.scope = 'domestic';
    this.profile = { nickname: 'PLAYER', countryCode: 'JP', pro: false, level: 'normal' };
    this.channel = null;
    this.matchName = null;
    this.host = false;
    this.mySide = 'home';
    this.opponent = null;
    this.first = 'home';
    this.myPicks = new Map();
    this.oppPicks = new Map();
    this.seen = new Set();
    this.resolved = new Set();
    this.presence = [];
    this.waitTimer = null;
    this.tickTimer = null;
    this.revealTimer = null;
    this.remainingMs = 0;
    this.deadline = 0;
    this.opponentSeen = false;
    this.lastStampAt = 0;
    this.knownNames = new Map();
    this.started = false;
  }

  emit(event) {
    try {
      this.onEvent(event);
    } catch {
      /* 画面の不具合で通信を止めない */
    }
  }

  openChannel(name, meta) {
    this.trackMeta = this.trackMeta || new Map();
    this.trackMeta.set(name, meta);
    this.client.subscribe(name, {
      onStatus: (status) => {
        if (status === 'joined') {
          const current = this.trackMeta.get(name);
          if (current) this.client.track(name, current);
        }
        if (status === 'error') this.emit({ type: 'error', reason: 'join' });
      },
      onPresence: ({ members }) => this.handlePresence(name, members),
      onBroadcast: (event, payload) => this.handleBroadcast(name, event, payload),
    });
  }

  meta(extra = {}) {
    return {
      nickname: String(this.profile.nickname || 'PLAYER').slice(0, 12),
      countryCode: String(this.profile.countryCode || 'JP').toUpperCase(),
      pro: Boolean(this.profile.pro),
      level: String(this.profile.level || 'normal').slice(0, 8),
      ...extra,
    };
  }

  quickMatch({ scope = 'domestic', country = 'JP', profile = {}, timeoutMs = MATCH_TIMEOUT_MS } = {}) {
    this.reset();
    this.mode = 'quick';
    this.scope = scope === 'world' ? 'world' : 'domestic';
    if (this.scope === 'world' && !profile.pro) {
      this.mode = null;
      this.emit({ type: 'error', reason: 'pro-world' });
      return null;
    }
    this.profile = { ...this.profile, ...profile, countryCode: country || profile.countryCode || 'JP' };
    const name = quickChannel({ scope: this.scope, country: this.profile.countryCode });
    this.openWaiting(name, { timeoutMs });
    return name;
  }

  joinRoom({ code, profile = {} } = {}) {
    this.reset();
    this.mode = 'room';
    this.profile = { ...this.profile, ...profile };
    const name = roomChannel(code);
    this.channel = name;
    this.openWaiting(name, { timeoutMs: 0 });
    return name;
  }

  openWaiting(name, { timeoutMs = MATCH_TIMEOUT_MS } = {}) {
    this.channel = name;
    this.deadline = timeoutMs > 0 ? this.now() + timeoutMs : 0;
    this.remainingMs = timeoutMs;
    this.openChannel(name, this.meta({ mode: this.mode }));
    if (timeoutMs > 0) {
      this.waitTimer = this.schedule(() => {
        this.waitTimer = null;
        if (!this.matchName) {
          this.remainingMs = 0;
          this.emit({ type: 'timeout', mode: this.mode });
        }
      }, timeoutMs);
      const step = () => {
        if (!this.deadline || this.matchName) {
          this.tickTimer = null;
          return;
        }
        this.remainingMs = Math.max(0, this.deadline - this.now());
        this.emit({ type: 'waiting', present: this.presence.length, remainingMs: this.remainingMs });
        if (this.remainingMs <= 0) {
          this.tickTimer = null;
          return;
        }
        this.tickTimer = this.schedule(step, 1000);
      };
      this.tickTimer = this.schedule(step, 1000);
    }
  }

  handlePresence(name, members) {
    if (name !== this.channel || this.matchName) return;
    const mine = this.client.clientId;
    const roster = members
      .filter((member) => member && member.key)
      .map((member) => {
        if (member.nickname) this.knownNames.set(member.key, String(member.nickname).slice(0, 12));
        return {
          key: member.key,
          nickname: member.nickname || this.knownNames.get(member.key) || 'PLAYER',
          countryCode: member.countryCode || 'JP',
          pro: Boolean(member.pro),
          level: member.level || 'normal',
        };
      })
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    this.presence = roster;
    const keys = roster.map((member) => member.key);
    const index = keys.indexOf(mine);
    if (index < 0) return;
    if (this.mode === 'room') {
      if (keys.length >= 2) {
        const partner = keys[0] === mine ? keys[1] : keys[0];
        this.pairWith(partner, { initiator: keys[0] === mine });
      }
      return;
    }
    const start = index % 2 === 0 ? index : index - 1;
    const partner = keys[start] === mine ? keys[start + 1] : keys[start];
    if (partner) {
      this.pairWith(partner, { initiator: keys[start] === mine });
      return;
    }
    this.emit({ type: 'waiting', present: keys.length, remainingMs: this.remainingMs });
  }

  pairWith(partnerKey, { initiator = false, room = null } = {}) {
    if (!partnerKey || this.matchName) return;
    const name = typeof room === 'string' && room.startsWith('shootout-match:')
      ? room
      : matchChannel(this.client.clientId, partnerKey);
    this.matchName = name;
    this.host = this.client.clientId < partnerKey;
    this.mySide = this.host ? 'home' : 'away';
    if (this.waitTimer) {
      this.clear(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.tickTimer) {
      this.clear(this.tickTimer);
      this.tickTimer = null;
    }
    if (initiator) {
      this.client.broadcast(this.channel, 'pair', { from: this.client.clientId, to: partnerKey, room: name });
    }
    const partnerMeta = this.presence.find((member) => member.key === partnerKey) || {};
    this.opponent = {
      key: partnerKey,
      nickname: partnerMeta.nickname || this.knownNames.get(partnerKey) || 'PLAYER',
      countryCode: partnerMeta.countryCode || 'JP',
      pro: Boolean(partnerMeta.pro),
      level: partnerMeta.level || 'normal',
    };
    const waiting = this.channel;
    this.channel = name;
    this.trackMeta = new Map();
    this.openChannel(name, this.meta({ mode: 'match' }));
    if (waiting && waiting !== name) {
      this.waitingChannel = waiting;
      this.waitLinger = this.schedule(() => this.releaseWaiting(), WAIT_LINGER_MS);
      if (initiator) {
        [400, 1200].forEach((delay) => {
          this.schedule(() => {
            if (this.matchName !== name) return;
            this.client.broadcast(waiting, 'pair', { from: this.client.clientId, to: partnerKey, room: name });
          }, delay);
        });
      }
    }
    this.started = true;
    this.opponentSeen = false;
    this.client.broadcast(name, 'hello', { from: this.client.clientId, ...this.meta({ host: this.host }) });
    this.emit({ type: 'paired', host: this.host, opponent: this.opponent, room: name });
    this.client.onStatus = null;
    if (this.matchWatchdog) this.clear(this.matchWatchdog);
    this.matchWatchdog = this.schedule(() => {
      this.matchWatchdog = null;
      if (!this.matchName || this.opponentSeen) return;
      this.emit({ type: 'opponent-left', reason: 'no-opponent' });
    }, this.matchWaitMs);
  }

  releaseWaiting() {
    if (this.waitLinger) {
      this.clear(this.waitLinger);
      this.waitLinger = null;
    }
    if (this.waitingChannel) {
      this.client.unsubscribe(this.waitingChannel);
      this.waitingChannel = null;
    }
  }

  handleBroadcast(name, event, payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payloadTooLarge(payload)) return;
    const mine = this.client.clientId;
    if (name !== this.channel) {
      if (event === 'pair' && payload.to === mine && !this.matchName) {
        const from = typeof payload.from === 'string' ? payload.from : '';
        if (from) this.pairWith(from, { initiator: false, room: payload.room });
      }
      return;
    }

    if (event === 'hello') {
      if (payload.from === mine) return;
      this.opponentSeen = true;
      if (this.matchWatchdog) {
        this.clear(this.matchWatchdog);
        this.matchWatchdog = null;
      }
      this.releaseWaiting();
      const nickname = String(payload.nickname || '').slice(0, 12);
      this.opponent = {
        key: payload.from,
        nickname: nickname || this.opponent?.nickname || 'PLAYER',
        countryCode: payload.countryCode || this.opponent?.countryCode || 'JP',
        pro: Boolean(payload.pro),
      };
      this.emit({ type: 'opponent-info', opponent: this.opponent });
      return;
    }

    if (event === 'pick') {
      const valid = validateOnlineKick(payload, { self: mine, seen: this.seen, maxRounds: MAX_TOTAL_KICKS });
      if (!valid.ok) return;
      this.seen.add(`${valid.from}:${valid.round}`);
      this.oppPicks.set(valid.round, valid.dir);
      this.emit({ type: 'opponent-pick', round: valid.round });
      this.tryResolve(valid.round);
      return;
    }

    if (event === 'reveal') {
      const round = Number(payload.round);
      if (!Number.isInteger(round) || round < 0 || round >= MAX_TOTAL_KICKS) return;
      const home = DIRECTIONS.includes(payload.home) ? payload.home : null;
      const away = DIRECTIONS.includes(payload.away) ? payload.away : null;
      if (!home || !away) return;
      if (this.resolved.has(round)) return;
      this.forceResolve(round, home, away);
      return;
    }

    if (event === 'stamp') {
      const valid = validateStamp(payload, {
        self: mine,
        allowed: ['hello', 'nice', 'oops', 'gg', 'thanks', 'wow'],
        lastAt: this.lastStampAt,
        now: this.now(),
      });
      if (!valid.ok) return;
      this.lastStampAt = this.now();
      this.emit({ type: 'stamp', id: valid.id, from: valid.from });
      return;
    }

    if (event === 'keeper') {
      const from = typeof payload.from === 'string' ? payload.from.slice(0, 40) : '';
      if (!from || from === mine) return;
      const x = Number(payload.x);
      if (!Number.isFinite(x) || x < -1.2 || x > 1.2) return;
      this.emit({ type: 'opponent-keeper', x: Math.max(-1, Math.min(1, x)) });
      return;
    }

    if (event === 'bye') {
      if (payload.from === mine) return;
      this.emit({ type: 'opponent-left' });
    }
  }

  /**
   * キーパーの左右位置を相手へ送る（駆け引き用・決定ではない）。
   * 80〜120ms に1回だけ。送れなかったときは false（次の指の動きで送る）。
   */
  sendKeeper(x, { now = this.now(), force = false } = {}) {
    if (!this.matchName) return false;
    const value = Number(x);
    if (!Number.isFinite(value)) return false;
    const clamped = Math.max(-1, Math.min(1, value));
    if (!force && now - (this.lastKeeperAt || 0) < KEEPER_SYNC_MS) return false;
    const sent = this.client.broadcast(this.matchName, 'keeper', {
      from: this.client.clientId,
      x: Number(clamped.toFixed(2)),
    });
    if (sent) this.lastKeeperAt = now;
    return sent;
  }

  /** 自分の方向を送る（送れたときだけ記録する） */
  pick(round, dir, { timeout = false } = {}) {
    if (!this.matchName) return false;
    const index = Number(round);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_TOTAL_KICKS) return false;
    if (!isPick(dir)) return false;
    if (this.myPicks.has(index) || this.resolved.has(index)) return false;
    const sent = this.client.broadcast(this.matchName, 'pick', {
      from: this.client.clientId,
      round: index,
      dir,
      timeout: Boolean(timeout),
    });
    if (!sent) return false;
    this.myPicks.set(index, dir);
    this.emit({ type: 'my-pick', round: index });
    this.tryResolve(index);
    /* ホストは、自分が送ったあとに相手が来ない場合に備えて締めのタイマーを張る */
    if (this.host) this.armReveal(index);
    return true;
  }

  armReveal(round) {
    if (this.revealRound === round) return;
    this.revealRound = round;
    if (this.revealTimer) this.clear(this.revealTimer);
    this.revealTimer = this.schedule(() => {
      this.revealTimer = null;
      if (this.resolved.has(round)) return;
      if (!this.myPicks.has(round) || !this.oppPicks.has(round)) {
        const seed = String(this.client.clientId).length + String(this.opponent?.key || '').length;
        const shooterSide = this.shooterOf(round);
        const mineSide = this.mySide;
        /* 蹴る側が時間切れなら枠外。止める側が間に合わなければ、蹴った方向はそのまま届いている */
        const mine = this.myPicks.get(round) || (shooterSide === mineSide ? MISS : fallbackDirection(round, seed));
        const theirs = this.oppPicks.get(round) || (shooterSide !== mineSide ? MISS : fallbackDirection(round, seed + 1));
        const home = mineSide === 'home' ? mine : theirs;
        const away = mineSide === 'home' ? theirs : mine;
        this.client.broadcast(this.matchName, 'reveal', { round, home, away });
        this.forceResolve(round, home, away);
      }
    }, ONLINE_TURN_MS + REVEAL_GRACE_MS);
  }

  /** ラウンドの担当（home が先攻） */
  shooterOf(round) {
    return Number(round) % 2 === 0 ? this.first : this.first === 'home' ? 'away' : 'home';
  }

  dirOf(picks, round, side) {
    /* picks: この端末が持つ「home の方向」「away の方向」 */
    if (side === 'home') return picks.home;
    return picks.away;
  }

  tryResolve(round) {
    const index = Number(round);
    if (!this.matchName || this.resolved.has(index)) return null;
    const mine = this.myPicks.get(index);
    const theirs = this.oppPicks.get(index);
    if (!mine || !theirs) return null;
    const home = this.mySide === 'home' ? mine : theirs;
    const away = this.mySide === 'home' ? theirs : mine;
    return this.forceResolve(index, home, away);
  }

  forceResolve(round, home, away) {
    const index = Number(round);
    if (this.resolved.has(index)) return null;
    if (!isPick(home) || !isPick(away)) return null;
    this.resolved.add(index);
    const shooter = this.shooterOf(index);
    const shot = shooter === 'home' ? home : away;
    const save = shooter === 'home' ? away : home;
    const miss = shot === MISS;
    const goal = !miss && shot !== save;
    const event = {
      type: 'kick',
      round: index,
      shooter, /* 'home' | 'away' */
      shooterSide: shooter === this.mySide ? 'me' : 'opp',
      shot,
      save: miss ? null : save,
      miss,
      goal,
    };
    this.emit(event);
    return event;
  }

  timeoutPick(round) {
    if (this.myPicks.has(Number(round))) return false;
    const seed = Number(round) + 3;
    return this.pick(round, fallbackDirection(round, seed), { timeout: true });
  }

  sendStamp(id) {
    if (!this.matchName) return false;
    return this.client.broadcast(this.matchName, 'stamp', { from: this.client.clientId, id });
  }

  startRanking({ scope = 'domestic', row = null } = {}) {
    this.rank = new RankingNet({ client: this.client, onRows: (rows) => this.emit({ type: 'rank', rows }) });
    return this.rank.open({ scope, row });
  }

  reset() {
    if (this.waitingChannel) this.client.unsubscribe(this.waitingChannel);
    this.waitingChannel = null;
    if (this.channel) this.client.unsubscribe(this.channel);
    if (this.waitTimer) this.clear(this.waitTimer);
    if (this.tickTimer) this.clear(this.tickTimer);
    if (this.revealTimer) this.clear(this.revealTimer);
    if (this.matchWatchdog) this.clear(this.matchWatchdog);
    if (this.waitLinger) this.clear(this.waitLinger);
    this.waitTimer = null;
    this.tickTimer = null;
    this.revealTimer = null;
    this.matchWatchdog = null;
    this.waitLinger = null;
    this.channel = null;
    this.matchName = null;
    this.mode = null;
    this.host = false;
    this.mySide = 'home';
    this.first = 'home';
    this.opponent = null;
    this.myPicks = new Map();
    this.oppPicks = new Map();
    this.seen = new Set();
    this.resolved = new Set();
    this.presence = [];
    this.remainingMs = 0;
    this.deadline = 0;
    this.started = false;
    this.opponentSeen = false;
    this.revealRound = -1;
    this.lastStampAt = 0;
    this.lastKeeperAt = 0;
    this.knownNames = new Map();
    this.trackMeta = new Map();
    this.rank?.close();
    this.rank = null;
  }

  leave({ bye = true } = {}) {
    if (bye && this.matchName) this.client.broadcast(this.matchName, 'bye', { from: this.client.clientId });
    this.reset();
    this.emit({ type: 'left' });
  }
}

/* ------------------------------------------------------------------ *\
 * ランキング（自分の行を配り、届いた行を混ぜる）
 * ------------------------------------------------------------------ */

export const RANK_CACHE_KEY = 'shootout4.peers.v1';
export const RANK_FRESH_MS = 10 * 60 * 1000;

export function mergeRows(local = [], peers = []) {
  const byId = new Map();
  for (const row of local) if (row && row.id) byId.set(row.id, row);
  for (const row of peers) {
    if (!row || !row.id) continue;
    const existing = byId.get(row.id);
    if (!existing) byId.set(row.id, row);
    else if (row.updatedAt && existing.updatedAt && row.updatedAt > existing.updatedAt) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function readRankCache(backend, { now = Date.now(), freshMs = RANK_FRESH_MS } = {}) {
  if (!backend) return [];
  try {
    const raw = backend.getItem(RANK_CACHE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.rows)) return [];
    if (now - Number(saved.savedAt || 0) > freshMs) return [];
    return saved.rows.filter((row) => row && typeof row.id === 'string');
  } catch {
    return [];
  }
}

export function writeRankCache(rows, backend, at = Date.now()) {
  if (!backend) return false;
  try {
    backend.setItem(RANK_CACHE_KEY, JSON.stringify({ savedAt: at, rows: rows.slice(0, 200) }));
    return true;
  } catch {
    return false;
  }
}

export class RankingNet {
  constructor({ client, onRows = () => {}, backend = typeof localStorage !== 'undefined' ? localStorage : null, now = () => Date.now(), schedule = setTimeout, clear = clearTimeout, windowMs = 2500 } = {}) {
    this.client = client;
    this.onRows = onRows;
    this.backend = backend;
    this.now = now;
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.windowMs = windowMs;
    this.channel = null;
    this.peers = new Map();
    this.timer = null;
  }

  cached() {
    return readRankCache(this.backend, { now: this.now() });
  }

  open({ scope = 'domestic', row = null } = {}) {
    this.close();
    this.channel = rankChannel({ scope });
    this.client.subscribe(this.channel, {
      onBroadcast: (event, payload) => {
        if (event !== 'row' || !payload || !payload.row) return;
        if (payloadTooLarge(payload)) return;
        const incoming = payload.row;
        if (typeof incoming.id !== 'string' || incoming.id.length > 40) return;
        this.peers.set(incoming.id, {
          ...incoming,
          nickname: String(incoming.nickname || 'PLAYER').slice(0, 16),
          countryCode: String(incoming.countryCode || 'JP').toUpperCase().slice(0, 2),
          points: Math.max(0, Math.round(Number(incoming.points) || 0)),
          wins: Math.max(0, Math.round(Number(incoming.wins) || 0)),
          losses: Math.max(0, Math.round(Number(incoming.losses) || 0)),
          updatedAt: Number(incoming.updatedAt) || this.now(),
        });
      },
    });
    if (row) this.publish(row);
    this.timer = this.schedule(() => {
      this.timer = null;
      const rows = [...this.peers.values()];
      writeRankCache(rows, this.backend, this.now());
      this.onRows(rows);
    }, this.windowMs);
    return this.channel;
  }

  publish(row) {
    if (!this.channel || !row) return false;
    return this.client.broadcast(this.channel, 'row', { row });
  }

  close() {
    if (this.timer) this.clear(this.timer);
    this.timer = null;
    if (this.channel) this.client.unsubscribe(this.channel);
    this.channel = null;
    this.peers.clear();
  }
}

/** 表示用の順位（自分を含めてポイント順） */
export function rankTable(rows, me) {
  const all = [...rows];
  if (me && !all.some((row) => row.id === me.id)) all.push(me);
  return all
    .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0))
    .map((row, index) => ({ ...row, place: index + 1, isMe: Boolean(me && row.id === me.id) }));
}
