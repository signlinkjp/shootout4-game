/**
 * SHOOTOUT 4 — 通信対戦（Supabase Realtime の broadcast / presence だけ）
 *
 * 部屋はチャンネル名そのもの。データベースも認証も使わない。
 *
 *   クイックマッチ  shootout-quick:{world|国コード}:{domestic|world}
 *   フレンド対戦    shootout-room:{コード}
 *   対戦            shootout-match:{id~tag-id~tag}（2人のIDと試合ごとの目印から決まる名前）
 *   ランキング      shootout-rank:{scope}
 *
 * 1本ごとに、蹴る側は「狙い」、止める側は「飛ぶ方向」を1つ送る。
 * 両方そろった瞬間に、どちらの端末でも同じ判定（core/rules.js）で結果が出る。
 * 8秒＋猶予で片方が来ないときはホストが欠けた分を決めて配る（全員が同じ結果）。
 *
 * 安全: 自由入力のチャットは無い（定型スタンプのみ・4秒あき）。受信は
 * validateOnlineKick / validateStamp で検証し、大きすぎる電文は捨てる。
 */

import { CONFIG } from '../config.js';
import { DIRECTIONS, MISS, isPick, payloadTooLarge, validateOnlineKick, validateStamp, MAX_TOTAL_KICKS } from '../core/rules.js';
import { EMOTE_WIRE_IDS } from '../core/emotes.js';
import {
  fromWire, toWire, normalizeRow, rankTable,
} from '../core/ranking.js';
import { RealtimeClient, realtimeUrl, presenceMembers } from './realtime.js';

export { RealtimeClient, realtimeUrl, presenceMembers };
/* ランキングの並べ方が1か所になるよう、計算は core/ranking.js に置く（画面とテストはここから読める） */
export { rankTable };

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

export function matchChannel(keyA, keyB, tagA = '', tagB = '') {
  /*
   * Build 11: 試合ごとの目印（tag）まで名前に入れる。名前が毎試合変われば、
   * 前のセッションの phx_leave（在室の leaves）が新しい試合の部屋に届くことは
   * 物理的に起きない。tag が片方にしか無いときは、あるほうだけで一意にする。
   */
  const sides = [
    [String(keyA), String(tagA || '')],
    [String(keyB), String(tagB || '')],
  ].sort((one, two) => (one[0] < two[0] ? -1 : one[0] > two[0] ? 1 : 0));
  const label = sides.map(([key, tag]) => (tag ? `${key}~${tag}` : key)).join('-');
  return `shootout-match:${label}`;
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

/** 試合ごとの目印（Build 11: 4文字の英数字。毎試合作り直す） */
export function sessionTag(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export function fallbackDirection(round, seed = 0) {
  const index = Math.abs(Math.floor(Number(round) * 7 + Number(seed) * 13)) % DIRECTIONS.length;
  return DIRECTIONS[index];
}

const JOIN_WAIT_MS = 8000;
const MATCH_JOIN_WAIT_MS = 15000;
const WAIT_LINGER_MS = 2500;
/** 相手が試合部屋に現れるまで待機部屋に残る上限（2.5秒 × 3回） */
const WAIT_LINGER_ROUNDS = 3;
const REVEAL_GRACE_MS = 1400;
/**
 * 相手が在室から消えてから「退出」と決めるまでの猶予。
 * 試合チャンネルは毎試合一意（Build 11）なので残像の leave は届かないが、
 * 通信の瞬断で在室が一瞬消えることはある。短い猶予の間に相手から何か届けば
 * 取り消す（猶予の間に presence を送り直すことはしない）。
 */
const OPPONENT_LEFT_GRACE_MS = 2500;
/** 相手の hello に hello で返す最短の間隔（返事の連打を防ぐ） */
const HELLO_REPLY_MS = 1500;
export const ONLINE_TURN_MS = 8000;
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
    leaveGraceMs = OPPONENT_LEFT_GRACE_MS,
    helloReplyMs = HELLO_REPLY_MS,
    waitLingerMs = WAIT_LINGER_MS,
  } = {}) {
    this.client = client;
    this.onEvent = onEvent;
    this.now = now;
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.random = random;
    this.matchWaitMs = matchWaitMs;
    /* 退出判定の猶予・hello の返事（テストから短くできる） */
    this.leaveGraceMs = Number(leaveGraceMs) >= 0 ? Number(leaveGraceMs) : OPPONENT_LEFT_GRACE_MS;
    this.helloReplyMs = Number(helloReplyMs) >= 0 ? Number(helloReplyMs) : HELLO_REPLY_MS;
    this.waitLingerMs = Number(waitLingerMs) >= 0 ? Number(waitLingerMs) : WAIT_LINGER_MS;
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
    /* 「相手が退出しました」を二重に出さない（Build 9） */
    this.leftNotified = false;
    /* 試合ごとの目印・退出判定の猶予・pair 再送のID管理 */
    this.sessionTag = '';
    this.candidate = null;
    this.matchToken = '';
    this.pairTimers = [];
    this.leaveTimer = null;
    this.waitLingerRounds = 0;
    this.lastHelloAt = 0;
    this.lastOpponentContactAt = 0;
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

  /**
   * チャンネルを購読する。
   * onJoined … SUBSCRIBED（phx_reply ok）になった瞬間に呼ぶ。試合部屋では、ここで
   *            hello を送る（Build 9: 購読完了前に送ると、1回の取りこぼしで
   *            「相手が来ない」と誤判定して1〜2本目で強制退出していた）。
   */
  openChannel(name, meta, { onJoined = null } = {}) {
    this.trackMeta = this.trackMeta || new Map();
    this.trackMeta.set(name, meta);
    this.client.subscribe(name, {
      onStatus: (status) => {
        if (status === 'joined') {
          const current = this.trackMeta.get(name);
          if (current) this.client.track(name, current);
          if (onJoined) onJoined(name);
        }
        if (status === 'error') this.emit({ type: 'error', reason: name === this.matchName ? 'match-join' : 'join' });
      },
      onPresence: ({ members }) => {
        if (this.matchName && name === this.matchName) this.handleMatchPresence(members);
        else this.handlePresence(name, members);
      },
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
    this.sessionTag = sessionTag(this.random);
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
    this.sessionTag = sessionTag(this.random);
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
    this.openChannel(name, this.meta({ mode: this.mode, tag: this.sessionTag }));
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
          /* Build 11: 相手の試合ごとの目印（試合チャンネル名に使う） */
          tag: member.tag ? String(member.tag).slice(0, 8) : '',
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

  /** 在室の一覧から相手の目印を取る */
  tagOf(key) {
    const member = this.presence.find((entry) => entry.key === key);
    return member && member.tag ? String(member.tag) : '';
  }

  /**
   * 相手と組む。
   * Build 11: 試合チャンネル名は毎試合一意（2人のID + 試合ごとの目印）なので、
   * 名前を決められるのは先に組む側（IDが小さい＝ホスト）だけ。もう一方は
   * `pair` で渡された部屋名をそのまま使う（presence の目印がまだ届いていない
   * 場合に別々の名前を作ってすれ違うのを防ぐ）。
   */
  pairWith(partnerKey, { initiator = false, room = null } = {}) {
    if (!partnerKey || this.matchName) return null;
    const given = typeof room === 'string' && room.startsWith('shootout-match:') ? room : null;
    if (!given && !initiator) {
      /* 相手（先に組む側）から部屋名が届くのを待つ。待つ間も待機部屋には残る */
      this.candidate = { key: partnerKey, tag: this.tagOf(partnerKey) };
      this.waitingChannel = this.channel;
      this.armWaitRelease();
      this.emit({ type: 'waiting', present: this.presence.length, remainingMs: this.remainingMs });
      return null;
    }
    const name = given || matchChannel(
      this.client.clientId,
      partnerKey,
      this.sessionTag,
      this.tagOf(partnerKey),
    );
    this.matchName = name;
    this.matchToken = this.sessionTag || name.slice(-8);
    this.candidate = null;
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
    /* 購読より先に「この試合の状態」を整える（同期で在室が届く実装でも上書きしない） */
    this.started = true;
    this.opponentSeen = false;
    this.leftNotified = false;
    this.lastOpponentContactAt = 0;
    this.openChannel(name, this.meta({ mode: 'match', token: this.matchToken }), {
      onJoined: () => this.announceMatch(name),
    });
    /* すでに購読済み（再接続など）なら joined が来ないので、その場で名乗る */
    if (typeof this.client.joined === 'function' && this.client.joined(name)) this.announceMatch(name);
    if (waiting && waiting !== name) {
      this.waitingChannel = waiting;
      this.armWaitRelease();
      if (initiator) {
        /* 取りこぼした相手のためにもう一度「この部屋へ」と伝える。
           タイマーは reset() で確実に消せるよう ID を持っておく（Build 10） */
        for (const delay of [400, 1200]) {
          this.pairTimers.push(this.schedule(() => {
            if (this.matchName !== name) return;
            this.client.broadcast(waiting, 'pair', { from: this.client.clientId, to: partnerKey, room: name });
          }, delay));
        }
      }
    }
    this.emit({ type: 'paired', host: this.host, opponent: this.opponent, room: name });
    this.client.onStatus = null;
    if (this.matchWatchdog) this.clear(this.matchWatchdog);
    this.matchWatchdog = this.schedule(() => {
      this.matchWatchdog = null;
      if (!this.matchName || this.opponentSeen) return;
      this.emit({ type: 'opponent-left', reason: 'no-opponent' });
    }, this.matchWaitMs);
  }

  /**
   * 試合部屋で名乗る（hello）＋まだ結果の出ていない自分の手を送り直す。
   * SUBSCRIBED のたびに呼ばれるので、再接続・取りこぼしのあとも相手に届く。
   */
  announceMatch(name) {
    if (!name || name !== this.matchName) return;
    this.lastHelloAt = this.now();
    this.client.broadcast(name, 'hello', {
      from: this.client.clientId,
      ...this.meta({ host: this.host, token: this.matchToken }),
    });
    this.resendPicks(name);
  }

  /** まだ決着していない自分の手を送り直す（後から入った相手・取りこぼしのため） */
  resendPicks(name) {
    if (!name || name !== this.matchName) return;
    for (const [index, dir] of this.myPicks) {
      if (this.resolved.has(index)) continue;
      this.client.broadcast(name, 'pick', {
        from: this.client.clientId,
        round: index,
        dir,
        timeout: false,
      });
    }
  }

  /**
   * 相手の存在を確認できた（hello・pick・keeper・stamp・reveal・presence）。
   * Build 10: ここで待機部屋を離れない。前のセッションの在室が消える通知で
   * 相手がまだ合流できていないことがあるため、待機部屋は WAIT_LINGER の
   * タイマーだけで離れる（相手の「居る」を見た瞬間に切るとすれ違う）。
   */
  noteOpponentSeen() {
    this.opponentSeen = true;
    this.lastOpponentContactAt = this.now();
    if (this.matchWatchdog) {
      this.clear(this.matchWatchdog);
      this.matchWatchdog = null;
    }
    /* 残像の leave で始めた退出の猶予を取り消す（相手は居る） */
    if (this.leaveTimer) {
      this.clear(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  /**
   * 待機部屋を離れるタイマー。
   * 相手がまだ試合部屋に現れていなければ、2.5秒ごとにもう一度待つ（最大3回）。
   * 先に切ってしまうと、相手は在室の更新を受け取れずに待ち続ける。
   * まだ部屋名が届いていない（相手が先に組む側）なら、そのたびに pair を頼み直す。
   */
  armWaitRelease(delay = this.waitLingerMs) {
    if (!this.waitingChannel) return;
    if (this.waitLinger) {
      this.clear(this.waitLinger);
      this.waitLinger = null;
    }
    this.waitLinger = this.schedule(() => {
      this.waitLinger = null;
      this.waitLingerRounds += 1;
      if (!this.opponentSeen && this.matchName && this.waitLingerRounds < WAIT_LINGER_ROUNDS) {
        this.armWaitRelease();
        return;
      }
      /* まだ部屋名が届いていない（相手が先に組む側）→ もう一度 pair を頼む */
      if (!this.matchName && this.candidate && this.waitLingerRounds < WAIT_LINGER_ROUNDS) {
        this.client.broadcast(this.waitingChannel, 'pair', {
          from: this.client.clientId,
          to: this.candidate.key,
          ask: true,
        });
        this.armWaitRelease();
        return;
      }
      this.releaseWaiting();
    }, delay);
  }

  /**
   * 相手が在室から消えたときに「本当に退出か」を確かめる。
   * Build 11: 在室（presence）の送り直しはしない（Realtime の presence は
   * レート制限があり、連射するとチャンネルごとサーバーに閉じられる）。
   * 「こちらに居る」の hello を1回だけ送り、在室が戻るか応答があれば取り消す。
   */
  scheduleOpponentLeftCheck() {
    if (this.leftNotified) return;
    if (this.leaveTimer) return;
    if (!(this.leaveGraceMs > 0)) {
      this.finishOpponentLeft();
      return;
    }
    /* 相手が居るなら hello か在室が返る（届けば猶予を取り消す） */
    this.pingMatch();
    this.leaveTimer = this.schedule(() => {
      this.leaveTimer = null;
      this.finishOpponentLeft();
    }, this.leaveGraceMs);
  }

  /** 「こちらに居る」の短い合図（相手の hello か在室が返れば居ると分かる） */
  pingMatch() {
    const name = this.matchName;
    if (!name) return false;
    const sent = this.client.broadcast(name, 'hello', {
      from: this.client.clientId,
      ...this.meta({ host: this.host, token: this.matchToken, probe: true }),
    });
    if (sent) this.lastHelloAt = this.now();
    return sent;
  }

  /** 退出を1回だけ伝える */
  finishOpponentLeft() {
    if (this.leftNotified) return;
    this.leftNotified = true;
    this.emit({ type: 'opponent-left' });
  }

  /**
   * 試合部屋の在室者（Build 9）。
   * hello を1回取りこぼしても、presence で相手が見えれば「居る」と分かる。
   * 逆に、一度見た相手が本当に消えたときだけ「退出」を1回だけ出す。
   */
  handleMatchPresence(members) {
    if (!this.matchName || !this.opponent) return;
    const keys = (Array.isArray(members) ? members : [])
      .filter((member) => member && member.key)
      .map((member) => member.key);
    if (keys.includes(this.opponent.key)) {
      this.noteOpponentSeen();
      return;
    }
    /* 自分が先に入った直後は、相手がまだ来ていないだけ。退出とは違う */
    if (!this.opponentSeen || !this.started || this.leftNotified) return;
    /* 消えた瞬間には決めない。瞬断で在室が一瞬消えることがあるので、
       猶予の間に相手から何か届けば取り消す */
    this.scheduleOpponentLeftCheck();
  }

  releaseWaiting() {
    if (this.waitLinger) {
      this.clear(this.waitLinger);
      this.waitLinger = null;
    }
    for (const id of this.pairTimers) this.clear(id);
    this.pairTimers = [];
    if (this.waitingChannel) {
      this.client.unsubscribe(this.waitingChannel);
      this.waitingChannel = null;
    }
  }

  handleBroadcast(name, event, payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payloadTooLarge(payload)) return;
    const mine = this.client.clientId;
    /*
     * `pair` は待機部屋から届く（試合部屋に切り替えたあとは name !== channel になる）。
     * どちらのチャンネルで届いても、自分宛てなら部屋名を使うか渡す。
     */
    if (event === 'pair' && payload.to === mine) {
      const from = typeof payload.from === 'string' ? payload.from : '';
      if (!from) return;
      if (!this.matchName) {
        /* 先に組んだ側が決めた、この試合だけの部屋名をそのまま使う */
        this.pairWith(from, { initiator: false, room: payload.room });
        return;
      }
      /* 部屋名が届かなかった相手の頼みに、もう一度だけ部屋名を伝える */
      if (payload.ask && typeof payload.room !== 'string') {
        this.client.broadcast(name, 'pair', {
          from: mine,
          to: from,
          room: this.matchName,
        });
      }
      return;
    }
    if (name !== this.channel) return;

    if (event === 'hello') {
      if (payload.from === mine) return;
      this.noteOpponentSeen();
      const nickname = String(payload.nickname || '').slice(0, 12);
      this.opponent = {
        key: payload.from,
        nickname: nickname || this.opponent?.nickname || 'PLAYER',
        countryCode: payload.countryCode || this.opponent?.countryCode || 'JP',
        pro: Boolean(payload.pro),
        token: typeof payload.token === 'string' ? payload.token.slice(0, 24) : (this.opponent?.token || ''),
      };
      /*
       * Build 10: 相手は後から入ってきたかもしれない。直近に名乗っていなければ
       * hello を返し（在室も言い直す）、まだ決着していない自分の手を送り直す。
       * これで「先に入った側の pick を、遅れて入った側が取りこぼす」すれ違いも直る。
       */
      if (this.now() - (this.lastHelloAt || 0) > this.helloReplyMs) this.announceMatch(name);
      else this.resendPicks(name);
      this.emit({ type: 'opponent-info', opponent: this.opponent });
      return;
    }

    if (event === 'pick') {
      const valid = validateOnlineKick(payload, { self: mine, seen: this.seen, maxRounds: MAX_TOTAL_KICKS });
      if (!valid.ok) return;
      /* 手が届いた＝相手は居る（hello を取りこぼしていても強制退出しない） */
      this.noteOpponentSeen();
      this.seen.add(`${valid.from}:${valid.round}`);
      this.oppPicks.set(valid.round, valid.dir);
      this.emit({ type: 'opponent-pick', round: valid.round });
      this.tryResolve(valid.round);
      return;
    }

    if (event === 'reveal') {
      const round = Number(payload.round);
      if (!Number.isInteger(round) || round < 0 || round >= MAX_TOTAL_KICKS) return;
      const shooterSide = this.shooterOf(round);
      const shooterPick = shooterSide === 'home' ? payload.home : payload.away;
      const keeperPick = shooterSide === 'home' ? payload.away : payload.home;
      /* 蹴る側は4方向か枠外（MISS）。キーパーは4方向か「動けず」（MISS を合図に使う） */
      if (!isPick(shooterPick)) return;
      if (keeperPick != null && !isPick(keeperPick)) return;
      if (this.resolved.has(round)) return;
      this.noteOpponentSeen();
      this.forceResolve(round, payload.home, payload.away);
      return;
    }

    if (event === 'stamp') {
      const valid = validateStamp(payload, {
        self: mine,
        allowed: EMOTE_WIRE_IDS,
        lastAt: this.lastStampAt,
        now: this.now(),
      });
      if (!valid.ok) return;
      this.lastStampAt = this.now();
      this.noteOpponentSeen();
      this.emit({ type: 'stamp', id: valid.id, from: valid.from });
      return;
    }

    if (event === 'keeper') {
      const from = typeof payload.from === 'string' ? payload.from.slice(0, 40) : '';
      if (!from || from === mine) return;
      const x = Number(payload.x);
      if (!Number.isFinite(x) || x < -1.2 || x > 1.2) return;
      this.noteOpponentSeen();
      this.emit({ type: 'opponent-keeper', x: Math.max(-1, Math.min(1, x)) });
      return;
    }

    if (event === 'bye') {
      if (payload.from === mine) return;
      /* 退出の合図はそのまま「退出」。presence の遅れで二重に出さない */
      this.finishOpponentLeft();
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
        const mineSide = this.mySide;
        /*
         * 時間切れの埋め合わせ（Build 7）:
         *  蹴る側が来なければ枠外（MISS）。キーパーが来なければ動けない（MISS を合図）。
         *  「選んだけど決定を押し忘れた」ときは、その選んだ手がすでに届いているので
         *  ここでは触らない（4方向はそのまま使う）。
         */
        const mine = this.myPicks.get(round) ?? MISS;
        const theirs = this.oppPicks.get(round) ?? MISS;
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
    const keeperPick = shooter === 'home' ? away : home;
    const miss = shot === MISS;
    /*
     * キーパーが枠外（MISS）を送ってきた＝時間切れで動けなかった（Build 7）。
     * シュートが枠外なら、そもそも失点にはならないので「動けず」にはしない。
     */
    const stuck = !miss && keeperPick === MISS;
    const save = miss || stuck ? null : keeperPick;
    const goal = !miss && (stuck ? true : shot !== save);
    const event = {
      type: 'kick',
      round: index,
      shooter, /* 'home' | 'away' */
      shooterSide: shooter === this.mySide ? 'me' : 'opp',
      shot,
      save,
      miss,
      stuck,
      goal,
    };
    this.emit(event);
    return event;
  }

  /**
   * 時間切れの手（Build 7）。蹴る側なら枠外、キーパーなら「動けない」（どちらも MISS を送る）。
   * 方向を選んでいたときは、このメソッドではなく pick() でその方向を送ること。
   */
  timeoutPick(round) {
    if (this.myPicks.has(Number(round))) return false;
    return this.pick(round, MISS, { timeout: true });
  }

  /** スタンプ・定型文を送る（許可リストの id だけ・本文は送らない） */
  sendStamp(id) {
    if (!this.matchName) return false;
    const value = String(id || '');
    if (!EMOTE_WIRE_IDS.includes(value)) return false;
    return this.client.broadcast(this.matchName, 'stamp', { from: this.client.clientId, id: value });
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
    /* 試合ごとの目印・pair の再送・退出の猶予も残さない（在室の連射はしない） */
    for (const id of this.pairTimers || []) this.clear(id);
    if (this.leaveTimer) this.clear(this.leaveTimer);
    this.pairTimers = [];
    this.leaveTimer = null;
    this.waitTimer = null;
    this.tickTimer = null;
    this.revealTimer = null;
    this.matchWatchdog = null;
    this.waitLinger = null;
    this.waitLingerRounds = 0;
    this.channel = null;
    this.matchToken = '';
    this.sessionTag = '';
    this.candidate = null;
    this.lastHelloAt = 0;
    this.lastOpponentContactAt = 0;
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
    this.leftNotified = false;
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

/**
 * 自分と相手の行を混ぜる（Build 4: 行は勝ち点の集計を持つ）。
 * 同じ id は updatedAt が新しいほうを採用する。
 */
export function mergeRows(local = [], peers = []) {
  const byId = new Map();
  for (const row of local) {
    const normal = normalizeRow(row);
    if (normal) byId.set(normal.id, normal);
  }
  for (const row of peers) {
    const normal = normalizeRow(row);
    if (!normal) continue;
    const existing = byId.get(normal.id);
    if (!existing) byId.set(normal.id, normal);
    else if (normal.updatedAt > existing.updatedAt) byId.set(normal.id, normal);
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
    return saved.rows.map((row) => normalizeRow(row)).filter(Boolean);
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
        const incoming = fromWire(payload.row, { now: this.now() });
        if (!incoming) return;
        this.peers.set(incoming.id, incoming);
      },
      onPresence: ({ members }) => {
        /* 在席の相手には自分の行を配る（2.5秒ごとのタイマーを待たずに届く） */
        if (!row || !Array.isArray(members)) return;
        const mine = this.client.clientId;
        if (members.some((member) => member && member.key && member.key !== mine)) this.publish(row);
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

  /** 自分の行を配る（小さい配列の形。512文字の上限に収まる） */
  publish(row) {
    if (!this.channel || !row) return false;
    const wire = toWire(row);
    if (!wire) return false;
    return this.client.broadcast(this.channel, 'row', { row: wire });
  }

  close() {
    if (this.timer) this.clear(this.timer);
    this.timer = null;
    if (this.channel) this.client.unsubscribe(this.channel);
    this.channel = null;
    this.peers.clear();
  }
}

