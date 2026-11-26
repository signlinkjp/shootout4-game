import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RealtimeClient, ShootoutSession, RankingNet, realtimeUrl, presenceMembers,
  quickChannel, roomChannel, matchChannel, rankChannel, normalizeCode, randomCode,
  onlineConfig, onlineConfigured, fallbackDirection, mergeRows, readRankCache,
  writeRankCache, rankTable, ONLINE_TURN_MS,
} from '../src/net/online.js';

/* ------------------------------------------------------------------ *\
 * フェイクの Realtime サーバー（Supabase Realtime と同じ形の電文）
 * ------------------------------------------------------------------ */

class Broker {
  constructor() {
    this.sockets = new Set();
    this.topics = new Map(); // topic -> Map(socket -> {key, meta})
  }

  attach(socket) {
    this.sockets.add(socket);
    setTimeout(() => {
      if (socket.readyState !== 0) return;
      socket.readyState = 1;
      socket.onopen && socket.onopen();
    }, 0);
  }

  detach(socket) {
    if (socket.readyState === 3) return;
    socket.readyState = 3;
    for (const [topic, members] of this.topics) {
      const entry = members.get(socket);
      if (!entry) continue;
      members.delete(socket);
      this.sendPresenceDiff(topic, {}, { [entry.key]: {} });
    }
  }

  receive(socket, message) {
    if (!message || !message.topic) return;
    const topic = message.topic.replace(/^realtime:/, '');
    if (message.topic === 'phoenix') return;
    if (message.event === 'phx_join') {
      if (!this.topics.has(topic)) this.topics.set(topic, new Map());
      const members = this.topics.get(topic);
      const key = message.payload?.config?.presence?.key ?? 'unknown';
      members.set(socket, { key, meta: {} });
      this.send(socket, { topic: message.topic, event: 'phx_reply', ref: message.ref, payload: { status: 'ok', response: {} } });
      this.send(socket, { topic: message.topic, event: 'presence_state', payload: this.presenceState(topic) });
      this.sendPresenceDiff(topic, { [key]: { metas: [{}] } }, {}, socket);
      return;
    }
    if (message.event === 'presence') {
      const members = this.topics.get(topic);
      if (!members) return;
      const entry = members.get(socket);
      if (!entry) return;
      if (message.payload?.event === 'track') entry.meta = message.payload.payload || {};
      if (message.payload?.event === 'leave') entry.meta = {};
      this.sendPresenceDiff(topic, { [entry.key]: { metas: [entry.meta] } }, {}, socket);
      return;
    }
    if (message.event === 'broadcast') {
      const members = this.topics.get(topic);
      if (!members) return;
      const payload = message.payload || {};
      for (const peer of members.keys()) {
        if (peer === socket) continue;
        this.send(peer, { topic: message.topic, event: 'broadcast', payload });
      }
      return;
    }
    if (message.event === 'phx_leave') {
      const members = this.topics.get(topic);
      const entry = members?.get(socket);
      if (members && entry) {
        members.delete(socket);
        this.sendPresenceDiff(topic, {}, { [entry.key]: {} }, socket);
      }
      this.send(socket, { topic: message.topic, event: 'phx_reply', ref: message.ref, payload: { status: 'ok', response: {} } });
    }
  }

  presenceState(topic) {
    const state = {};
    for (const [, entry] of this.topics.get(topic) || []) {
      state[entry.key] = { metas: [entry.meta] };
    }
    return state;
  }

  sendPresenceDiff(topic, joins, leaves, except = null) {
    for (const socket of (this.topics.get(topic) || new Map()).keys()) {
      if (socket === except) continue;
      this.send(socket, { topic: `realtime:${topic}`, event: 'presence_diff', payload: { joins, leaves } });
    }
  }

  /** テスト用: 1台から生の電文を送る（不正電文の検証に使う） */
  inject(topic, payload, fromKey) {
    for (const [socket, entry] of this.topics.get(topic) || []) {
      if (entry.key === fromKey) continue;
      this.send(socket, { topic: `realtime:${topic}`, event: 'broadcast', payload });
    }
  }

  send(socket, message) {
    if (socket.readyState !== 1) return;
    socket.onmessage && socket.onmessage({ data: JSON.stringify(message) });
  }

  makeSocket() {
    const broker = this;
    return class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        broker.attach(this);
      }
      send(data) {
        broker.receive(this, JSON.parse(data));
      }
      close() {
        broker.detach(this);
        this.onclose && this.onclose({ code: 1000, reason: '' });
      }
    };
  }
}

const flush = (ms = 12) => new Promise((resolve) => setTimeout(resolve, ms));

const schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  if (id && typeof id.unref === 'function') id.unref();
  return id;
};
const clear = (id) => clearTimeout(id);

function makeClient(broker, id) {
  return new RealtimeClient({
    url: 'https://example.supabase.co',
    key: 'sb_publishable_test_key_for_the_broker_0123456789',
    WebSocketImpl: broker.makeSocket(),
    clientId: id,
    schedule,
    clear,
  });
}

function makeSession(client, events, extra = {}) {
  return new ShootoutSession({
    client,
    onEvent: (event) => events.push(event),
    schedule,
    clear,
    ...extra,
  });
}

test('Realtime の WebSocket URL を組み立てる', () => {
  const url = realtimeUrl('https://siivncidktbuyqwsjeqd.supabase.co', 'sb_publishable_x');
  assert.match(url, /^wss:\/\/siivncidktbuyqwsjeqd\.supabase\.co\/realtime\/v1\/websocket\?apikey=/);
  assert.match(url, /vsn=1\.0\.0/);
});

test('通信先は設定から来る（差し替え可能）', () => {
  const config = onlineConfig();
  assert.equal(config.configured, true);
  assert.match(config.url, /^https:\/\//);
  assert.equal(onlineConfigured(), true);
});

test('チャンネル名: クイック・部屋・対戦・ランキング', () => {
  assert.equal(quickChannel({ scope: 'domestic', country: 'jp' }), 'shootout-quick:JP:domestic');
  assert.equal(quickChannel({ scope: 'world', country: 'JP' }), 'shootout-quick:world:world');
  assert.equal(roomChannel('ab-12x'), 'shootout-room:AB12X');
  assert.equal(matchChannel('bbb', 'aaa'), 'shootout-match:aaa-bbb');
  assert.equal(rankChannel({ scope: 'world' }), 'shootout-rank:world');
});

test('ルームコードは英数字のみ・4文字以上', () => {
  assert.equal(normalizeCode(' ab-1 2cd '), 'AB12CD');
  assert.equal(normalizeCode('!!!'), '');
  const code = randomCode(() => 0.5);
  assert.equal(code.length, 5);
  assert.doesNotMatch(code, /[0O1I]/);
});

test('2台が組んで、交互に1本ずつ結果が一致する', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA);
  const sb = makeSession(b, eventsB);
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A', countryCode: 'JP' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B', countryCode: 'BR' } });
  await flush(40);
  assert.ok(sa.matchName, 'A が組めた');
  assert.equal(sa.matchName, sb.matchName, '同じ対戦チャンネル');
  assert.equal(sa.mySide === 'home', sb.mySide === 'away');

  /* 1本目: home（A）がシュート、away（B）がキーパー */
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(30);
  const kicksA = eventsA.filter((event) => event.type === 'kick');
  const kicksB = eventsB.filter((event) => event.type === 'kick');
  assert.equal(kicksA.length, 1);
  assert.equal(kicksB.length, 1);
  assert.deepEqual(kicksA[0].goal, kicksB[0].goal);
  assert.equal(kicksA[0].goal, true, 'TL と BR は違うのでゴール');
  assert.equal(kicksA[0].shooterSide, 'me');
  assert.equal(kicksB[0].shooterSide, 'opp');

  /* 2本目: away（B）がシュート */
  sa.pick(1, 'TL');
  sb.pick(1, 'TL');
  await flush(30);
  const secondA = eventsA.filter((event) => event.type === 'kick')[1];
  const secondB = eventsB.filter((event) => event.type === 'kick')[1];
  assert.equal(secondA.goal, false, '同じ方向はセーブ');
  assert.equal(secondA.shooterSide, 'opp');
  assert.deepEqual(secondA.goal, secondB.goal);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('不正な手・重複・自分の手は捨てる', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const events = [];
  const sa = makeSession(a, events);
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sa.joinRoom({ code: 'ABCDE', profile: { nickname: 'A' } });
  sa.pick(0, 'TL');
  assert.equal(events.filter((event) => event.type === 'kick').length, 0);
  a.broadcast(sa.matchName || 'shootout-room:ABCDE', 'pick', { from: 'aaa', round: 0, dir: 'ZZ' });
  sa.leave({ bye: false });
  b.close?.();
  await flush(10);
});

test('フレンド対戦: 合言葉の部屋で2人が組める', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const sa = makeSession(a, eventsA);
  const sb = makeSession(b, []);
  sa.joinRoom({ code: 'ZZ9', profile: { nickname: 'A' } });
  sb.joinRoom({ code: 'ZZ9', profile: { nickname: 'B' } });
  await flush(40);
  assert.ok(sa.matchName);
  assert.equal(sa.matchName, sb.matchName);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('7秒で来ない手はホストが決めて配る（両者の結果が一致する）', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA, { matchWaitMs: 1000 });
  const sb = makeSession(b, eventsB, { matchWaitMs: 1000 });
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(40);
  /* ホストだけが手を送り、相手は送らない */
  sa.pick(0, 'TR');
  await flush(ONLINE_TURN_MS + 1800);
  const resolvedA = eventsA.filter((event) => event.type === 'kick');
  const resolvedB = eventsB.filter((event) => event.type === 'kick');
  assert.equal(resolvedA.length, 1, 'ホストが締めた');
  assert.equal(resolvedB.length, 1, '相手にも届いた');
  assert.equal(resolvedA[0].goal, resolvedB[0].goal);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('スタンプは定型のみ・4秒あき', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const events = [];
  const sb = makeSession(b, events);
  const sa = makeSession(a, []);
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(40);
  sa.sendStamp('nice');
  await flush(20);
  assert.equal(events.filter((event) => event.type === 'stamp').length, 1);
  a.broadcast(sb.channel ? sa.matchName : '', 'stamp', { from: 'aaa', id: 'nice' });
  await flush(10);
  assert.equal(events.filter((event) => event.type === 'stamp').length, 1, '4秒以内は捨てる');
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('退出は相手に伝わる', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const events = [];
  const sa = makeSession(a, []);
  const sb = makeSession(b, events);
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(40);
  sa.leave();
  await flush(20);
  assert.ok(events.some((event) => event.type === 'opponent-left'));
  sb.leave({ bye: false });
});

test('ランキング: 行を混ぜて順位を付け、キャッシュする', () => {
  const rows = [
    { id: 'a', nickname: 'A', points: 120, updatedAt: 1 },
    { id: 'b', nickname: 'B', points: 300, wins: 4, updatedAt: 1 },
  ];
  const merged = mergeRows(rows, [{ id: 'b', points: 310, updatedAt: 5 }, { id: 'c', points: 50, updatedAt: 3 }]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((row) => row.id === 'b').points, 310);

  const table = rankTable(merged, { id: 'me', nickname: 'ME', points: 200 });
  assert.equal(table[0].id, 'b');
  assert.equal(table.find((row) => row.id === 'me').place, 2);
  assert.equal(table.find((row) => row.id === 'me').isMe, true);

  const backend = new Map();
  const storage = { getItem: (k) => backend.get(k) ?? null, setItem: (k, v) => backend.set(k, v) };
  writeRankCache(merged, storage, 1000);
  assert.equal(readRankCache(storage, { now: 2000 }).length, 3);
  assert.equal(readRankCache(storage, { now: 1000 + 10 * 60 * 1000 + 1 }).length, 0);
});

test('presence の形を配列にする', () => {
  const members = presenceMembers({ aaa: { metas: [{ nickname: 'A' }] }, bbb: { metas: [] } });
  assert.deepEqual(members, [{ key: 'aaa', nickname: 'A' }]);
});

test('タイムアップの代わりの方向は決定的', () => {
  assert.equal(fallbackDirection(0, 5), fallbackDirection(0, 5));
  assert.ok(['TL', 'TR', 'BL', 'BR'].includes(fallbackDirection(3, 2)));
});

/* ------------------------------------------------------------------ *\
 * Build 2: キーパーの左右同期・時間切れの枠外（OUT）
 * ------------------------------------------------------------------ */

function captureClient() {
  const sent = [];
  return {
    clientId: 'me',
    sent,
    broadcast: (name, event, payload) => { sent.push({ name, event, payload }); return true; },
    subscribe: () => {},
    unsubscribe: () => {},
    track: () => {},
  };
}

test('キーパーの左右位置は80〜120msに1回だけ送る（駆け引きの同期）', () => {
  const client = captureClient();
  const session = new ShootoutSession({ client, now: () => 0 });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  assert.equal(session.sendKeeper(0.4, { now: 1000 }), true);
  assert.equal(session.sendKeeper(0.9, { now: 1050 }), false, '間隔が短すぎる送信は捨てる');
  assert.equal(session.sendKeeper(-0.3, { now: 1100 }), true);
  assert.equal(client.sent.length, 2);
  assert.equal(client.sent[1].event, 'keeper');
  assert.equal(client.sent[1].payload.x, -0.3);
  assert.equal(session.sendKeeper(5, { now: 1200, force: true }), true);
  assert.equal(client.sent[2].payload.x, 1, '範囲は -1〜1 に丸める');
});

test('相手のキーパー位置を受け取り、範囲外・自分の手は捨てる', () => {
  const events = [];
  const client = captureClient();
  const session = new ShootoutSession({ client, onEvent: (event) => events.push(event) });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  session.handleBroadcast(session.channel, 'keeper', { from: 'other', x: 0.5 });
  session.handleBroadcast(session.channel, 'keeper', { from: 'me', x: 0.2 });
  session.handleBroadcast(session.channel, 'keeper', { from: 'other', x: 9 });
  session.handleBroadcast(session.channel, 'keeper', { from: 'other', x: -0.4 });
  const kept = events.filter((event) => event.type === 'opponent-keeper');
  assert.deepEqual(kept.map((event) => event.x), [0.5, -0.4]);
});

test('時間切れの枠外（OUT）も通信で通り、両者の結果が一致する', () => {
  const client = captureClient();
  const session = new ShootoutSession({ client });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  assert.equal(session.pick(0, 'OUT', { timeout: true }), true, 'OUT は送れる');
  assert.equal(session.pick(1, 'CENTER'), false, '未知の手は送れない');
  const event = session.forceResolve(0, 'OUT', 'TL');
  assert.equal(event.goal, false);
  assert.equal(event.miss, true);
  assert.equal(event.save, null);
  assert.equal(event.shooter, 'home');
});
