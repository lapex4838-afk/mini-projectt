import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { detectLanguage } from '../google extension/utils/languageDetector.js';

const root = path.resolve('google extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function worker() {
  const listeners = [];
  const calls = [];
  let route;
  let ai = { safetyScore: 0, category: 'Dangerous', threats: ['Phishing'], goodPoints: [], humanSummary: 'Avoid.', advice: 'Leave.' };
  let requests = 0;
  let lastRequest;
  let failureStatus;
  function storage(area) {
    const data = {};
    return {
      data,
      get(keys, cb) {
        const result = structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])));
        if (cb) queueMicrotask(() => cb(result));
        else return Promise.resolve(result);
      },
      set(values, cb) {
        Object.assign(data, structuredClone(values));
        listeners.forEach(listener => listener(Object.fromEntries(Object.keys(values).map(k => [k, { newValue: values[k] }])), area));
        if (cb) queueMicrotask(cb);
        else return Promise.resolve();
      },
      remove(key, cb) { delete data[key]; if (cb) queueMicrotask(cb); else return Promise.resolve(); }
    };
  }
  const chrome = {
    runtime: { onMessage: { addListener(fn) { route = fn; } } },
    storage: { local: storage('local'), sync: storage('sync'), onChanged: { addListener(fn) { listeners.push(fn); } } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    webNavigation: { onCompleted: { addListener() {} } },
    declarativeNetRequest: { async updateEnabledRulesets(value) { calls.push(value); } }
  };
  const context = vm.createContext({ chrome, detectLanguage, URL, AbortSignal, console: { log() {}, error() {} }, fetch: async (url, options) => {
    requests++;
    lastRequest = { url, options };
    if (failureStatus) return { ok: false, status: failureStatus, json: async () => ({ error: { message: 'Provider error' } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(ai) } }] }) };
  } });
  vm.runInContext(read('background.js').replace(/^import .*;$/m, ''), context);
  return { chrome, calls, context, ai(value) { ai = value; }, fail(status) { failureStatus = status; }, get lastRequest() { return lastRequest; }, get requests() { return requests; },
    send(message, sender = {}) { return new Promise(resolve => route(message, sender, resolve)); } };
}
const fakeKey = 'sk-or-v1-' + 'x'.repeat(64);

test('all JavaScript parses and manifest resources exist', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.background.type, 'module');
  const files = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(s => [...s.js, ...s.css]),
    ...manifest.declarative_net_request.rule_resources.map(r => r.path)];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), file);
  for (const file of fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const resource of manifest.declarative_net_request.rule_resources) {
    const rules = JSON.parse(read(resource.path));
    assert.equal(new Set(rules.map(r => r.id)).size, rules.length);
    assert.ok(rules.every(r => r.action.type === 'block' && r.condition.urlFilter));
  }
});
test('language detector runs as a browser JavaScript module', () => {
  assert.equal(detectLanguage('Hello world'), 'en');
  assert.equal(detectLanguage('यह एक गोपनीयता नीति है'), 'hi');
  assert.equal(detectLanguage('தமிழ் மொழி'), 'ta');
  assert.equal(detectLanguage('বাংলা ভাষা'), 'bn');
  assert.equal(detectLanguage(null), 'en');
});
test('missing key never sends page content and does not count a scan', async () => {
  const w = worker();
  const result = await w.send({ type: 'SCAN_PAGE', text: 'private', url: 'https://example.com' });
  assert.match(result.error, /key/i);
  assert.equal(w.requests, 0);
  assert.equal((await w.send({ type: 'GET_STATS' })).pagesScanned, 0);
});
test('API key save, suffix, validation and clear', async () => {
  const w = worker();
  assert.ok((await w.send({ type: 'SAVE_API_KEY', key: 'bad' })).error);
  assert.ok((await w.send({ type: 'SAVE_API_KEY', key: fakeKey }, { tab: { id: 1 } })).error);
  assert.equal((await w.send({ type: 'SAVE_API_KEY', key: fakeKey })).ok, true);
  const state = await w.send({ type: 'CHECK_API_KEY' });
  assert.equal(state.hasKey, true);
  assert.equal(state.keySuffix, 'xxxx');
  await w.send({ type: 'CLEAR_API_KEY' });
  assert.equal((await w.send({ type: 'CHECK_API_KEY' })).hasKey, false);
});
test('zero safety score survives storage and flags a threat', async () => {
  const w = worker();
  await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
  await w.send({ type: 'SCAN_PAGE', text: 'test', url: 'https://example.com', title: 'Test' });
  assert.equal((await w.send({ type: 'GET_CURRENT_SCAN' })).overallScore, 0);
  const stats = await w.send({ type: 'GET_STATS' });
  assert.equal(stats.pagesScanned, 1);
  assert.equal(stats.threatsFound, 1);
});
test('AI requests use OpenRouter authentication, model and JSON mode', async () => {
  const w = worker();
  await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
  await w.send({ type: 'SCAN_PAGE', text: 'Synthetic page', url: 'https://example.com' });
  assert.equal(w.lastRequest.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(w.lastRequest.options.headers.Authorization, `Bearer ${fakeKey}`);
  const body = JSON.parse(w.lastRequest.options.body);
  assert.equal(body.model, 'openai/gpt-4o-mini');
  assert.equal(body.response_format.type, 'json_object');
});
test('billing and rate-limit errors reach the user without counting a completed scan', async () => {
  for (const [status, message] of [[402, /credits/i], [429, /rate limit/i]]) {
    const w = worker();
    await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
    w.fail(status);
    const result = await w.send({ type: 'SCAN_PAGE', text: 'Synthetic page', url: 'https://example.com' });
    assert.match(result.error, message);
    assert.equal((await w.send({ type: 'GET_STATS' })).pagesScanned, 0);
  }
});
test('malformed AI results receive a safe fallback', async () => {
  const w = worker();
  await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
  w.ai({ safetyScore: '<img src=x>', threats: 'not an array' });
  const result = await w.send({ type: 'SCAN_PAGE', text: 'test', url: 'https://example.com' });
  assert.equal(result.safetyScore, 50);
  assert.equal(result.category, 'Moderate Risk');
});
test('concurrent statistic updates are not lost', async () => {
  const w = worker();
  await Promise.all(Array.from({ length: 40 }, () => w.send({ type: 'AD_BLOCKED', count: 1 })));
  assert.equal((await w.send({ type: 'GET_STATS' })).adsBlocked, 40);
});
test('blocking settings apply at startup, on change and when paused', async () => {
  const w = worker();
  await tick();
  assert.equal(w.calls.at(-1).enableRulesetIds.length, 3);
  await w.chrome.storage.sync.set({ adsEnabled: false, trackersEnabled: false });
  await tick();
  assert.deepEqual([...w.calls.at(-1).disableRulesetIds].sort(), ['block_ads', 'block_trackers']);
  await w.chrome.storage.local.set({ guardianPaused: true });
  await tick();
  assert.equal(w.calls.at(-1).enableRulesetIds.length, 0);
});
test('HTTP on a known domain is still unsecured', async () => {
  const w = worker();
  assert.equal((await w.send({ type: 'DOMAIN_REP', url: 'http://google.com' })).rep, 'unsecured');
});
test('automatic scanning requires saved opt-in and respects pause', async () => {
  const w = worker();
  await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
  const request = { type: 'AUTO_SCAN_PAGE', isPrivacy: true, text: 'Policy', url: 'https://example.com' };
  assert.match((await w.send({ ...request })).error, /disabled/);
  assert.equal(w.requests, 0);
  await w.chrome.storage.sync.set({ autoPrivacy: true });
  await w.chrome.storage.local.set({ guardianPaused: true });
  assert.match((await w.send({ ...request })).error, /paused/);
  assert.equal(w.requests, 0);
});
test('payment transport and domain age are not fabricated by the model', async () => {
  const w = worker();
  await w.send({ type: 'SAVE_API_KEY', key: fakeKey });
  w.ai({ score: 30, verdict: 'Suspicious', flags: [], humanMessage: 'Review.', ssl: true, domainAge: 'Established' });
  const result = await w.send({ type: 'VERIFY_PAYMENT', url: 'http://example.com', text: '' });
  assert.equal(result.ssl, false);
  assert.equal(result.domainAge, 'Unknown');
});
test('cookie rejection respects settings and only clicks explicit reject actions', async () => {
  async function run(prefs, label) {
    const timers = [];
    let clicks = 0;
    const button = { textContent: label, getClientRects: () => [1], click() { clicks++; } };
    const banner = { textContent: 'We use cookies', querySelectorAll: () => [button] };
    const context = vm.createContext({
      document: { readyState: 'complete', querySelectorAll: () => [banner] },
      chrome: {
        runtime: { onMessage: { addListener() {} }, sendMessage(msg, cb) { cb({ ok: true }); } },
        storage: {
          local: { get(keys, cb) { if (cb) cb({}); else return Promise.resolve({}); } },
          sync: { get(keys, cb) { if (cb) cb(prefs); else return Promise.resolve(prefs); } }
        }
      },
      console: { log() {} }, setTimeout(fn, delay) { timers.push({ fn, delay }); }
    });
    vm.runInContext(read('content.js'), context);
    await tick();
    await timers.find(t => t.delay === 1500).fn();
    return clicks;
  }
  assert.equal(await run({}, 'Reject all'), 1);
  assert.equal(await run({ autoConsent: false }, 'Reject all'), 0);
  assert.equal(await run({ privacyLevel: 'permissive' }, 'Reject all'), 0);
  assert.equal(await run({}, 'Accept all'), 0);
  assert.equal(await run({}, 'Manage preferences'), 0);
});
test('popup renders untrusted AI text as escaped text', () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', classList: { remove() {} }, addEventListener() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: get, querySelectorAll: () => [] }, console });
  vm.runInContext(read('popup.js').replace(/\(async \(\) => \{[\s\S]*?\}\)\(\);/, ''), context);
  context.payload = { safetyScore: 0, category: '<img src=x onerror=alert(1)>', humanSummary: '<script>bad</script>', threats: ['<a href=x>bad</a>'], goodPoints: [] };
  vm.runInContext('displayScanResult(payload)', context);
  const html = get('scan-result').innerHTML;
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;a'));
});
test('popup navigation targets and scan controls exist in the HTML', () => {
  const html = read('popup.html');
  for (const match of html.matchAll(/data-tab="([^"]+)"/g)) {
    assert.ok(html.includes(`id="tab-${match[1]}"`), `Missing panel: ${match[1]}`);
  }
  assert.ok(html.includes('id="scan-page-btn"'));
  assert.ok(html.includes('id="dashboard-scan-btn"'));
});
test('scan reconnects an existing tab with no content script', async () => {
  let injected = 0;
  let deliveries = 0;
  const chrome = {
    runtime: {},
    tabs: { sendMessage(id, msg, cb) {
      deliveries++;
      if (!injected) chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      cb(injected ? { text: 'Example page', title: 'Example' } : undefined);
      delete chrome.runtime.lastError;
    } },
    scripting: { async executeScript(options) {
      assert.equal(options.target.tabId, 42);
      assert.equal(options.files[0], 'content.js');
      injected++;
    } }
  };
  const context = vm.createContext({ chrome, document: { getElementById: () => null, querySelectorAll: () => [] }, console });
  vm.runInContext(read('popup.js').replace(/\(async \(\) => \{[\s\S]*?\}\)\(\);/, ''), context);
  const result = await vm.runInContext('sendContent(42, { type: "GET_PAGE_TEXT" })', context);
  assert.equal(result.text, 'Example page');
  assert.equal(injected, 1);
  assert.equal(deliveries, 2);
});
