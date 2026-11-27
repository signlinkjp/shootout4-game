import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RealtimeClient, ShootoutSession, RankingNet, realtimeUrl, presenceMembers,
  quickChannel, roomChannel, matchChannel, rankChannel, normalizeCode, randomCode,
  onlineConfig, onlineConfigured, fallbackDirection, mergeRows, readRankCache,
  writeRankCache, rankTable, ONLINE_TURN_MS, sessionTag, domesticRegion,
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

test('8秒で来ない手はホストが決めて配る（両者の結果が一致する）', async () => {
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
  assert.equal(merged.find((row) => row.id === 'b').total.points, 310, '新しい updatedAt の行を採用');

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

/* ------------------------------------------------------------------ *\
 * Build 9: 早すぎる強制退出（no-opponent）の修正
 *   hello を1回取りこぼしても、SUBSCRIBED・presence・pick 受信のどれかで
 *   「相手は居る」と分かり、matchWaitMs を過ぎても退出させない。
 * ------------------------------------------------------------------ */

/** 購読・在室・受信を手動で動かせるクライアント（時間を待たずに確かめる） */
function manualClient(id) {
  const handlers = new Map();
  const sent = [];
  const unsubscribed = [];
  return {
    clientId: id,
    sent,
    unsubscribed,
    handlers,
    subscribe(name, value) { handlers.set(name, value); return name; },
    unsubscribe(name) { unsubscribed.push(name); handlers.delete(name); },
    track: () => true,
    joined: () => false,
    broadcast: (name, event, payload) => { sent.push({ name, event, payload }); return true; },
    fireStatus(name, status) { handlers.get(name)?.onStatus?.(status); },
    firePresence(name, members) { handlers.get(name)?.onPresence?.({ members }); },
    fireBroadcast(name, event, payload) { handlers.get(name)?.onBroadcast?.(event, payload); },
    helloCount: () => sent.filter((item) => item.event === 'hello').length,
  };
}

function manualSession({ client, events = [], matchWaitMs = 60, extra = {} }) {
  return new ShootoutSession({
    client,
    onEvent: (event) => events.push(event),
    schedule,
    clear,
    matchWaitMs,
    ...extra,
  });
}

function pairThroughWaiting(session, client, { partner = 'other', self = 'me' } = {}) {
  session.mode = 'quick';
  session.channel = 'shootout-quick:JP:domestic';
  session.openChannel(session.channel, session.meta({ mode: 'quick' }));
  session.handlePresence(session.channel, [{ key: self }, { key: partner }]);
  return session.matchName;
}

test('Build 9: hello は購読完了（SUBSCRIBED）後に送り、結果の出ていない自分の手も送り直す', () => {
  const client = manualClient('me');
  const session = manualSession({ client });
  const name = pairThroughWaiting(session, client);
  assert.equal(name, 'shootout-match:me-other');
  assert.equal(client.helloCount(), 0, '購読完了前に hello を送らない（取りこぼしの原因）');

  session.myPicks.set(0, 'TL'); /* 送ったが相手に届いていない手 */
  client.fireStatus(name, 'joined');
  assert.equal(client.helloCount(), 1, 'SUBSCRIBED で名乗る');
  const picks = client.sent.filter((item) => item.event === 'pick');
  assert.equal(picks.length, 1);
  assert.equal(picks[0].payload.round, 0);
  assert.equal(picks[0].payload.dir, 'TL');

  session.resolved.add(0);
  client.fireStatus(name, 'joined');
  assert.equal(client.sent.filter((item) => item.event === 'pick').length, 1, '決着済みの手は送らない');
});

test('Build 9: hello を1回取りこぼしても、相手の在室（presence）で強制退出しない', async () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events, matchWaitMs: 60 });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  /* 名乗ったが、相手はまだ部屋に居ない＝取りこぼし（何も届かない） */
  client.fireStatus(name, 'joined');
  assert.equal(session.opponentSeen, false);

  /* 相手が部屋に入ってきた（presence） */
  client.firePresence(name, [{ key: 'me' }, { key: 'other' }]);
  assert.equal(session.opponentSeen, true, 'presence で相手を確認');

  await flush(120); /* matchWaitMs(60) を過ぎても */
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 0, '強制退出しない');
});

test('Build 9: hello も presence も来なくても、相手の pick で「居る」と分かる', async () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events, matchWaitMs: 60 });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  client.fireStatus(name, 'joined');

  client.fireBroadcast(name, 'pick', { from: 'other', round: 0, dir: 'BR' });
  assert.equal(session.opponentSeen, true, 'pick を受けたら相手は居る');

  await flush(120);
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 0);
});

test('Build 9: 本当に相手が来ないときだけ、matchWaitMs で1回だけ退出する', async () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events, matchWaitMs: 60 });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  client.fireStatus(name, 'joined');
  /* 取りこぼしのまま、presence も pick も来ない */
  await flush(140);
  const left = events.filter((event) => event.type === 'opponent-left');
  assert.equal(left.length, 1, '来ないときは退出させる（安全弁は残す）');
  assert.equal(left[0].reason, 'no-opponent');
});

test('Build 9/10: 一度見た相手が消えたら退出を1回だけ出し、bye と重ねて二重に出さない', async () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events, matchWaitMs: 60, extra: { leaveGraceMs: 40 } });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  client.fireStatus(name, 'joined');
  client.firePresence(name, [{ key: 'me' }, { key: 'other' }]);
  assert.equal(session.opponentSeen, true);

  /* 相手が部屋から消えた（presence の leaves だけが届く）
     Build 10: 消えた瞬間には出さず、猶予（leaveGraceMs）のあとに1回だけ出す */
  client.firePresence(name, [{ key: 'me' }]);
  client.firePresence(name, [{ key: 'me' }]);
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 0, 'すぐには出さない');
  await flush(80);
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 1, '1回だけ');

  /* そのあと bye が届いても二重にしない */
  client.fireBroadcast(name, 'bye', { from: 'other' });
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 1);
});

test('Build 9: 本物のブローカーで最初の hello を落としても、1〜2本目で退出させられない', async () => {
  const broker = new Broker();
  /* 最初の hello だけ捨てる（実際に起きた「取りこぼし」を再現） */
  const originalReceive = broker.receive.bind(broker);
  let droppedHello = 0;
  broker.receive = (socket, message) => {
    const isHello = message?.event === 'broadcast' && message.payload?.event === 'hello';
    if (isHello && droppedHello < 1) {
      droppedHello += 1;
      return;
    }
    originalReceive(socket, message);
  };

  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA, { matchWaitMs: 160 });
  const sb = makeSession(b, eventsB, { matchWaitMs: 160 });
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(60);
  assert.ok(sa.matchName, 'A が組めた');
  assert.equal(sa.matchName, sb.matchName);
  assert.equal(droppedHello, 1, 'hello を1回落とした');

  /* 1本目と2本目をプレイ中でも、退出させられない */
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(30);
  sa.pick(1, 'TL');
  sb.pick(1, 'TL');
  await flush(200); /* matchWaitMs(160) を過ぎる */
  assert.equal(eventsA.filter((event) => event.type === 'opponent-left').length, 0, 'A は退出しない');
  assert.equal(eventsB.filter((event) => event.type === 'opponent-left').length, 0, 'B も退出しない');
  assert.equal(eventsA.filter((event) => event.type === 'kick').length, 2, '1〜2本目が成立している');
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

/* ------------------------------------------------------------------ *\
 * Build 10: クイックマッチのすれ違い（待機部屋の早すぎる離脱）と
 *           やり直し直後の在室の残像（phx_leave の leaves）による誤退出
 * ------------------------------------------------------------------ */

/** タイマーを手で進められる時計（reset がタイマーを消したことを確かめる） */
function fakeClock() {
  let id = 0;
  const tasks = new Map();
  return {
    schedule(fn, ms) {
      id += 1;
      tasks.set(id, { fn, ms });
      return id;
    },
    clear(timerId) { tasks.delete(timerId); },
    pending() { return [...tasks.values()].map((task) => task.ms); },
    runMs(ms) {
      for (const [timerId, task] of [...tasks]) {
        if (task.ms !== ms) continue;
        tasks.delete(timerId);
        task.fn();
      }
    },
    run() {
      for (const [timerId, task] of [...tasks]) {
        tasks.delete(timerId);
        task.fn();
      }
    },
    size() { return tasks.size; },
  };
}

const WAITING = 'shootout-quick:JP:domestic';

test('Build 10: 相手を試合部屋で見ても、待機部屋はすぐには離れない（相手の合流を妨げない）', () => {
  const clock = fakeClock();
  const client = manualClient('me');
  const session = new ShootoutSession({ client, schedule: clock.schedule, clear: clock.clear, waitLingerMs: 2500 });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  client.fireStatus(name, 'joined');
  client.firePresence(name, [{ key: 'me' }, { key: 'other' }]);
  assert.equal(session.opponentSeen, true);
  assert.ok(!client.unsubscribed.includes(WAITING), '在室を見た瞬間に待機部屋を切らない');

  clock.runMs(2500);
  assert.deepEqual(client.unsubscribed, [WAITING], '待機部屋は2.5秒のタイマーでだけ離れる');
});

test('Build 10: 相手が試合部屋に現れるまでは、待機部屋に2.5秒ずつ残る（最大3回）', () => {
  const clock = fakeClock();
  const client = manualClient('me');
  const session = new ShootoutSession({ client, schedule: clock.schedule, clear: clock.clear, waitLingerMs: 2500 });
  pairThroughWaiting(session, client);
  assert.ok(session.waitingChannel, '待機部屋に居る');

  clock.runMs(2500);
  assert.ok(!client.unsubscribed.includes(WAITING), '相手が来ていないので待つ（1回目）');
  clock.runMs(2500);
  assert.ok(!client.unsubscribed.includes(WAITING), 'もう一度待つ（2回目）');
  clock.runMs(2500);
  assert.ok(client.unsubscribed.includes(WAITING), '3回で離れる（安全弁）');
});

test('Build 10: pair の再送と退出の猶予は reset で確実に消える（次の試合に残さない）', () => {
  const clock = fakeClock();
  const client = manualClient('me');
  const session = new ShootoutSession({ client, schedule: clock.schedule, clear: clock.clear, leaveGraceMs: 30 });
  pairThroughWaiting(session, client);
  assert.equal(client.sent.filter((item) => item.event === 'pair').length, 1, '組んだ合図を1回送る');
  const pendingPair = clock.pending().filter((ms) => ms === 400 || ms === 1200);
  assert.equal(pendingPair.length, 2, '取りこぼし用の再送を2回予約する');

  const before = client.sent.length;
  session.reset();
  assert.equal(clock.size(), 0, 'reset でタイマーが残らない');
  clock.run();
  assert.equal(client.sent.length, before, 'reset のあとに電文が飛ばない');
});

test('Build 10: やり直し直後の在室の残像（leaves）では退出させない', async () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events, extra: { leaveGraceMs: 60 } });
  const name = pairThroughWaiting(session, client);
  session.started = true;
  client.fireStatus(name, 'joined');
  client.firePresence(name, [{ key: 'me' }, { key: 'other' }]);
  client.firePresence(name, [{ key: 'me' }]);
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 0, 'すぐには決めない');
  assert.ok(client.sent.some((item) => item.event === 'hello' && item.payload.probe), '在室を言い直して相手を呼ぶ');

  await flush(20);
  client.firePresence(name, [{ key: 'me' }, { key: 'other' }]);
  await flush(120);
  assert.equal(events.filter((event) => event.type === 'opponent-left').length, 0, '戻ってきたら取り消す');
  assert.equal(session.leftNotified, false);
});

test('Build 10: 後から届いた hello でこちらの情報と未解決の pick を送り直す', () => {
  const client = manualClient('me');
  const events = [];
  const session = manualSession({ client, events });
  const name = pairThroughWaiting(session, client);
  client.fireStatus(name, 'joined');
  session.myPicks.set(0, 'TL');
  session.myPicks.set(1, 'BR');
  session.resolved.add(1);

  /* 相手が後から入ってきた（こちらは名乗ってから時間が経っている） */
  session.lastHelloAt = 0;
  client.fireBroadcast(name, 'hello', { from: 'other', nickname: 'OPP', token: 'tok' });
  const hellos = client.sent.filter((item) => item.event === 'hello');
  assert.equal(hellos.length, 2, 'hello に hello を返す');
  assert.equal(hellos[1].payload.token, session.matchToken, '試合ごとの目印を載せる');
  const picks = client.sent.filter((item) => item.event === 'pick');
  assert.equal(picks.length, 1, '決着していない手だけ送り直す');
  assert.equal(picks[0].payload.round, 0);
  assert.equal(picks[0].payload.dir, 'TL');
  assert.equal(session.opponent.token, 'tok');
  assert.equal(events.filter((event) => event.type === 'opponent-info').length, 1);

  /* 直近に名乗っていれば hello は連打せず、手だけ送る */
  const before = client.sent.length;
  client.fireBroadcast(name, 'hello', { from: 'other', nickname: 'OPP' });
  const after = client.sent.slice(before);
  assert.equal(after.filter((item) => item.event === 'hello').length, 0, 'hello を連打しない');
  assert.equal(after.filter((item) => item.event === 'pick').length, 1, '手は送り直す');
});

test('Build 10: クイックマッチをやり直しても、両方が合流し退出を誤爆しない', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA, { leaveGraceMs: 120 });
  const sb = makeSession(b, eventsB, { leaveGraceMs: 120 });
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(60);
  assert.ok(sa.matchName && sb.matchName, '1回目が組める');
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(40);

  /* やり直し（退出の合図なしで、すぐ2回目のクイックマッチ） */
  sa.leave({ bye: false });
  sb.leave({ bye: false });
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(250);
  assert.ok(sa.matchName, '2回目もAが組める');
  assert.equal(sa.matchName, sb.matchName, '同じ対戦部屋');
  assert.equal(sa.opponentSeen, true);
  assert.equal(sb.opponentSeen, true);

  /* 3秒待っても退出を誤爆しない（このテストは猶予120msで厳しめに見る） */
  await flush(600);
  assert.equal(eventsA.filter((event) => event.type === 'opponent-left').length, 0, 'A は退出させない');
  assert.equal(eventsB.filter((event) => event.type === 'opponent-left').length, 0, 'B も退出させない');

  /* 2回目の1本目も成立する */
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(40);
  assert.equal(eventsA.filter((event) => event.type === 'kick').length, 2, '1回目と2回目の1本目');
  assert.equal(eventsB.filter((event) => event.type === 'kick').length, 2);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

/* ------------------------------------------------------------------ *\
 * Build 11: presence の連射（レート制限）廃止・試合チャンネルの一意化・
 *           phx_close からの自動復帰
 * ------------------------------------------------------------------ */

/** ブローカーが受け取った presence 電文をトピックごとに数える */
function countPresence(broker) {
  const counts = new Map();
  const original = broker.receive.bind(broker);
  broker.receive = (socket, message) => {
    if (message && message.event === 'presence' && typeof message.topic === 'string') {
      const topic = message.topic.replace(/^realtime:/, '');
      counts.set(topic, (counts.get(topic) || 0) + 1);
    }
    original(socket, message);
  };
  return counts;
}

test('Build 11: 試合チャンネル名は2人のIDと試合ごとの目印から作る', () => {
  assert.equal(sessionTag(() => 0), 'AAAA');
  assert.equal(sessionTag(() => 0.999999).length, 4);
  const name = matchChannel('bbb', 'aaa', 'XY12', 'Z345');
  assert.equal(name, 'shootout-match:aaa~Z345-bbb~XY12', 'ソート順に組み合わせる');
  assert.equal(matchChannel('bbb', 'aaa'), 'shootout-match:aaa-bbb', '目印が無くても壊れない');
});

test('Build 11: 試合中に presence（在室）を送り直さない（レート制限で切られない）', async () => {
  const broker = new Broker();
  const counts = countPresence(broker);
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const sa = makeSession(a, eventsA, { leaveGraceMs: 500 });
  const sb = makeSession(b, [], { leaveGraceMs: 500 });
  sa.quickMatch({ scope: 'domestic', country: 'JP', language: 'ja', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', language: 'ja', profile: { nickname: 'B' } });
  await flush(60);
  assert.ok(sa.matchName && sa.matchName === sb.matchName);
  const waiting = WAITING;
  const match = sa.matchName;
  assert.equal(counts.get(waiting), 2, '待機部屋の在室は1人1回だけ');
  assert.equal(counts.get(match), 2, '試合部屋の在室も1人1回だけ');

  /* Build 10 は3秒ごとに retrack していた（＝ここで4件以上に増えていた） */
  await flush(3400);
  assert.equal(counts.get(match), 2, '3秒を過ぎても在室を送り直さない');
  assert.equal(sa.opponentSeen, true);
  assert.equal(eventsA.filter((event) => event.type === 'opponent-left').length, 0);

  /* 1本目は普通に蹴れる */
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(40);
  assert.equal(eventsA.filter((event) => event.type === 'kick').length, 1);
  assert.equal(typeof sa.startPresenceBeat, 'undefined', '在室の連射は廃止した');
  assert.equal(typeof sa.retrackMatch, 'undefined');
  assert.equal(typeof a.retrack, 'undefined', 'realtime から retrack も消した');
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('Build 11: 続けて2試合しても、試合チャンネルは毎回べつ（前の残像が届かない）', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA, { leaveGraceMs: 150 });
  const sb = makeSession(b, eventsB, { leaveGraceMs: 150 });
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(60);
  const first = sa.matchName;
  assert.match(first, /^shootout-match:aaa~[^-]+-bbb~[^-]+$/);
  assert.ok(first.includes(sa.sessionTag) && first.includes(sb.sessionTag));
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(40);

  sa.leave({ bye: false });
  sb.leave({ bye: false });
  await flush(30);
  sa.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'A' } });
  sb.quickMatch({ scope: 'domestic', country: 'JP', profile: { nickname: 'B' } });
  await flush(60);
  assert.ok(sa.matchName, '2試合目も組める');
  assert.equal(sa.matchName, sb.matchName);
  assert.notEqual(sa.matchName, first, '前の試合と同じ部屋名を使い回さない');
  assert.ok(!first.includes(sa.sessionTag), '目印は試合ごとに作り直す');

  await flush(300);
  assert.equal(eventsA.filter((event) => event.type === 'opponent-left').length, 0);
  assert.equal(eventsB.filter((event) => event.type === 'opponent-left').length, 0);
  sa.pick(0, 'TL');
  sb.pick(0, 'BR');
  await flush(40);
  assert.equal(eventsA.filter((event) => event.type === 'kick').length, 2);
  assert.equal(eventsB.filter((event) => event.type === 'kick').length, 2);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('Build 11: 相手の目印が届かなくても、こちらの目印だけで一意な部屋名を作る', () => {
  const client = manualClient('aaa');
  const session = manualSession({ client });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'Z9Z9';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'Z9Z9' }));
  session.handlePresence(WAITING, [{ key: 'aaa' }, { key: 'zzz' }]);
  assert.equal(session.matchName, 'shootout-match:aaa~Z9Z9-zzz');
  const pair = client.sent.find((item) => item.event === 'pair');
  assert.equal(pair.payload.room, session.matchName, 'この部屋へ来るよう相手に伝える');
});

test('Build 11: 先に組む側でないほうは、pair で渡された部屋名をそのまま使う', () => {
  const client = manualClient('zzz');
  const session = manualSession({ client });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'B1B1';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'B1B1' }));
  session.handlePresence(WAITING, [{ key: 'aaa', tag: 'A1A1' }, { key: 'zzz', tag: 'B1B1' }]);
  assert.equal(session.matchName, null, '自分では部屋名を作らない（すれ違わない）');
  assert.equal(session.waitingChannel, WAITING, '待機部屋には残る');

  session.handleBroadcast(WAITING, 'pair', {
    from: 'aaa',
    to: 'zzz',
    room: 'shootout-match:aaa~A1A1-zzz~B1B1',
  });
  assert.equal(session.matchName, 'shootout-match:aaa~A1A1-zzz~B1B1');
  assert.equal(client.sent.filter((item) => item.event === 'pair').length, 0, 'pair を決めるのは先に組む側だけ');
  session.reset();
});

test('Build 12: 部屋名が届かないときは pair を頼み直し、待機部屋からは抜けない（Build 11 の「3回で離れる」を廃止）', () => {
  const clock = fakeClock();
  const client = manualClient('zzz');
  const session = new ShootoutSession({
    client, schedule: clock.schedule, clear: clock.clear, waitLingerMs: 2500, pairWaitMs: 2000,
  });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'B1B1';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'B1B1' }));
  session.handlePresence(WAITING, [{ key: 'aaa', tag: 'A1A1' }, { key: 'zzz', tag: 'B1B1' }]);
  assert.equal(session.matchName, null);
  assert.equal(client.unsubscribed.length, 0, '相手を見た瞬間には待機部屋を切らない');

  const asks = () => client.sent.filter((item) => item.event === 'pair' && item.payload.ask);
  clock.runMs(2000);
  assert.equal(asks().length, 1, '1回目は pair を頼む');
  assert.equal(asks()[0].payload.to, 'aaa');
  assert.equal(client.unsubscribed.length, 0);
  clock.runMs(2000);
  assert.equal(asks().length, 2, '2回目も頼む');
  /* 3回目は自分が部屋を作る。待機部屋は切らない（切ると相手とすれ違ったまま死ぬ） */
  clock.runMs(2000);
  assert.ok(session.matchName, '自分が部屋名を決める');
  assert.equal(client.unsubscribed.length, 0, '待機部屋からは抜けない');
});

test('Build 11: 部屋名を頼まれたら、もう一度だけ部屋名を伝える', () => {
  const posted = [];
  const handlers = new Map();
  const client = {
    clientId: 'aaa',
    subscribe: (name, value) => { handlers.set(name, value); return name; },
    unsubscribe: () => {},
    track: () => true,
    joined: () => false,
    broadcast: (name, event, payload) => { posted.push({ name, event, payload }); return true; },
  };
  const session = new ShootoutSession({ client });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'A1A1';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'A1A1' }));
  session.handlePresence(WAITING, [{ key: 'aaa', tag: 'A1A1' }, { key: 'zzz', tag: 'B1B1' }]);
  const room = session.matchName;
  assert.ok(room);

  handlers.get(WAITING).onBroadcast('pair', { from: 'zzz', to: 'aaa', ask: true });
  const answers = posted.filter((item) => item.name === WAITING && item.event === 'pair' && item.payload.room === room);
  assert.equal(answers.length >= 2, true, '最初の合図か、頼まれての返事のどちらかで部屋名が届く');
  assert.equal(answers.at(-1).payload.to, 'zzz');
  session.reset();
});

test('Build 11: phx_close でサーバーに切られたチャンネルは、少し待って自動で入り直す', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const statuses = [];
  const members = [];
  let tracked = 0;
  const originalReceive = broker.receive.bind(broker);
  broker.receive = (socket, message) => {
    if (message && message.event === 'presence') tracked += 1;
    originalReceive(socket, message);
  };
  a.subscribe('shootout-test:room', {
    /* online.js の openChannel と同じく、入れたら在室（presence）を1回だけ送る */
    onStatus: (status) => {
      statuses.push(status);
      if (status === 'joined') a.track('shootout-test:room', { role: 'test' });
    },
    onPresence: ({ members: list }) => members.push(list.length),
    onBroadcast: () => {},
  });
  await flush(30);
  assert.equal(a.joined('shootout-test:room'), true);
  assert.equal(tracked, 1, '入れたら在室を1回送る');

  /* サーバーからの強制切断（レート制限などで起きる phx_close） */
  a.socket.onmessage({
    data: JSON.stringify({ topic: 'realtime:shootout-test:room', event: 'phx_close', payload: {} }),
  });
  assert.equal(a.joined('shootout-test:room'), false, '閉じたチャンネルは joined にしない');
  assert.ok(statuses.includes('closed'));

  await flush(1200);
  assert.equal(a.joined('shootout-test:room'), true, '自動で入り直した');
  assert.equal(tracked, 2, '入り直したら在室を1回だけ送り直す');
  a.close();
  await flush(10);
});

test('Build 11: phx_close を何度も繰り返しても、入り直しは間隔を空けて諦める', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  let joins = 0;
  const originalReceive = broker.receive.bind(broker);
  broker.receive = (socket, message) => {
    if (message && message.event === 'phx_join') joins += 1;
    originalReceive(socket, message);
  };
  const errors = [];
  a.subscribe('shootout-test:retry', { onStatus: (status) => errors.push(status) });
  await flush(30);
  const joinsAtStart = joins;
  /* 9回続けて切る（REJOIN_ATTEMPTS は8回） */
  for (let i = 0; i < 9; i += 1) {
    a.socket.onmessage({
      data: JSON.stringify({ topic: 'realtime:shootout-test:retry', event: 'phx_close', payload: {} }),
    });
    await flush(20);
  }
  await flush(3000);
  assert.ok(joins - joinsAtStart <= 8, `入り直しは最大8回（実際 ${joins - joinsAtStart}）`);
  assert.equal(errors.includes('error'), true, '諦めたら error を出す（黙って死なない）');
  a.close();
  await flush(10);
});

/* ------------------------------------------------------------------ *\
 * Build 12: 国内戦のクイックマッチが「相手を探しています」のまま進まない不具合
 * ------------------------------------------------------------------ */

test('Build 12: 国内戦の地域はユニフォーム国ではなく、アプリの言語/地域で決める', () => {
  assert.equal(domesticRegion('ja'), 'JP');
  assert.equal(domesticRegion('ja-JP'), 'JP');
  assert.equal(domesticRegion('ko'), 'KR');
  assert.equal(domesticRegion('zh-Hant'), 'TW');
  assert.equal(domesticRegion('zh-Hans'), 'CN');
  assert.equal(domesticRegion('pt'), 'BR');
  assert.equal(domesticRegion(''), 'EN');
  /* 言語が分からないときだけ端末の時間帯で推測する */
  assert.equal(domesticRegion('', 'Asia/Tokyo'), 'JP');
  assert.equal(domesticRegion('xx', 'Europe/Berlin'), 'DE');
  assert.equal(quickChannel({ scope: 'domestic', region: domesticRegion('ja') }), 'shootout-quick:JP:domestic');
});

test('Build 12: 別のユニフォーム国でも、同じ言語の国内戦は同じ待機部屋で組めて3本目まで進む', async () => {
  const broker = new Broker();
  const a = makeClient(broker, 'aaa');
  const b = makeClient(broker, 'bbb');
  const eventsA = [];
  const eventsB = [];
  const sa = makeSession(a, eventsA);
  const sb = makeSession(b, eventsB);

  /* A は日本ユニフォーム、B はブラジルユニフォーム。どちらも日本語で国内戦 */
  const nameA = sa.quickMatch({
    scope: 'domestic', country: 'JP', language: 'ja', profile: { nickname: 'A', countryCode: 'JP' },
  });
  const nameB = sb.quickMatch({
    scope: 'domestic', country: 'BR', language: 'ja', profile: { nickname: 'B', countryCode: 'BR' },
  });
  assert.equal(nameA, 'shootout-quick:JP:domestic');
  assert.equal(nameB, 'shootout-quick:JP:domestic', 'ユニフォーム国（BR）で部屋を分けない');
  assert.equal(sa.region, 'JP');
  assert.equal(sb.region, 'JP');

  await flush(60);
  assert.ok(sa.matchName, 'A が組めた');
  assert.equal(sa.matchName, sb.matchName, '同じ対戦部屋');
  /* 表示カードは着用ユニフォーム国のまま */
  assert.equal(sa.opponent.countryCode, 'BR');
  assert.equal(sb.opponent.countryCode, 'JP');

  for (const round of [0, 1, 2]) {
    sa.pick(round, 'TL');
    sb.pick(round, 'BR');
    await flush(40);
  }
  const kicksA = eventsA.filter((event) => event.type === 'kick');
  const kicksB = eventsB.filter((event) => event.type === 'kick');
  assert.equal(kicksA.length, 3, '3本目までフリーズしない（A）');
  assert.equal(kicksB.length, 3, '3本目までフリーズしない（B）');
  assert.deepEqual(kicksA.map((event) => event.goal), kicksB.map((event) => event.goal));
  assert.deepEqual(kicksA.map((event) => event.round), [0, 1, 2]);
  sa.leave({ bye: false });
  sb.leave({ bye: false });
});

test('Build 12: 部屋名を待つあいだは待機部屋を離れるタイマーを張らない（7.5秒たっても切らない）', () => {
  const clock = fakeClock();
  const client = manualClient('zzz');
  const session = new ShootoutSession({
    client, schedule: clock.schedule, clear: clock.clear, waitLingerMs: 2500, pairWaitMs: 2000,
  });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'B1B1';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'B1B1' }));
  session.handlePresence(WAITING, [{ key: 'aaa', tag: 'A1A1' }, { key: 'zzz', tag: 'B1B1' }]);

  assert.equal(session.matchName, null, '先に組む側ではないので部屋名はまだ決まらない');
  assert.equal(session.waitLinger, null, '待機部屋を離れるタイマー（2.5秒×3）を張らない');
  assert.ok(!client.unsubscribed.includes(WAITING), '待機部屋に残る');

  /* 7.5秒ぶん以上、待つ（pair 待ちのタイマーだけが進む） */
  for (let i = 0; i < 4; i += 1) clock.runMs(2000);
  assert.ok(!client.unsubscribed.includes(WAITING), '7.5秒たっても待機部屋を切らない');
  assert.equal(session.waitingChannel, WAITING);
});

test('Build 12: pair が届かないときは頼み直し、それでも来なければ自分が部屋を作る', () => {
  const clock = fakeClock();
  const client = manualClient('zzz');
  const session = new ShootoutSession({ client, schedule: clock.schedule, clear: clock.clear, pairWaitMs: 2000 });
  session.mode = 'quick';
  session.channel = WAITING;
  session.sessionTag = 'B1B1';
  session.openChannel(session.channel, session.meta({ mode: 'quick', tag: 'B1B1' }));
  session.handlePresence(WAITING, [{ key: 'aaa', tag: 'A1A1' }, { key: 'zzz', tag: 'B1B1' }]);

  const asks = () => client.sent.filter((item) => item.event === 'pair' && item.payload.ask).length;
  clock.runMs(2000);
  assert.equal(asks(), 1, '2秒たっても来なければ部屋名を頼み直す');
  clock.runMs(2000);
  assert.equal(asks(), 2, 'もう一度頼む');
  assert.equal(session.matchName, null);
  clock.runMs(2000);
  assert.equal(
    session.matchName,
    matchChannel('zzz', 'aaa', 'B1B1', 'A1A1'),
    'それでも来なければ自分が名前を決める（同じ規則なので相手と同じ部屋になる）',
  );
  assert.ok(!client.unsubscribed.includes(WAITING), '待機部屋はまだ残す');
});

test('Build 12: 30秒タイムアウトしたら待機部屋を閉じる（在室に居座らない）', () => {
  const clock = fakeClock();
  const client = manualClient('me');
  const events = [];
  const session = new ShootoutSession({
    client, schedule: clock.schedule, clear: clock.clear, onEvent: (event) => events.push(event),
  });
  const name = session.quickMatch({
    scope: 'domestic', country: 'JP', language: 'ja', profile: { nickname: 'A' }, timeoutMs: 30000,
  });
  assert.equal(name, WAITING);
  assert.equal(session.channel, WAITING);

  clock.runMs(30000);
  assert.ok(events.some((event) => event.type === 'timeout'), 'タイムアウトを伝える');
  assert.deepEqual(client.unsubscribed, [WAITING], '待機部屋を1回だけ閉じる');
  assert.equal(session.channel, null, '閉じた部屋に残らない');
  assert.equal(session.waitingChannel, null);
  assert.equal(session.waitTimer, null);
});
