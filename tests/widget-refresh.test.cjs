const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace('export default class SjcGoldExtension', 'class SjcGoldExtension');

function harness() {
    const timers = new Map();
    const removed = [];
    const disconnected = [];
    const logs = [];
    let nextId = 1;
    let actorDestroyed = 0;
    let runnerDestroyed = 0;
    class Widget {
        destroy() {
            actorDestroyed++;
        }
    }
    const context = vm.createContext({
        Gio: {
            _promisify() {},
            Subprocess: {prototype: {}},
            IOErrorEnum: {CANCELLED: 'cancelled'},
        },
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add(priority, delay, callback) {
                assert.equal(priority, 0);
                const id = nextId++;
                timers.set(id, {delay, callback});
                return id;
            },
            source_remove(id) {
                assert.ok(timers.delete(id), `timer ${id} must exist`);
                removed.push(id);
            },
        },
        GObject: {registerClass: cls => cls},
        St: {Widget},
        Extension: class {},
        Main: {layoutManager: {
            disconnect: id => disconnected.push(['monitor', id]),
        }},
        console: {error: message => logs.push(message)},
    });
    vm.runInContext(source, context, {filename});
    const widget = vm.runInContext('Object.create(SjcGoldWidget.prototype)', context);
    const calls = [];
    const rendered = [];
    const result = {
        stdout: JSON.stringify({buy: 100, sell: 110}),
        stderr: '',
        successful: true,
    };
    let duration = 5;
    widget._destroyed = false;
    widget._refreshSourceId = 0;
    widget._failureCount = 0;
    widget._scriptPath = '/extension path/sjc_price.py';
    widget._positionChangedId = 11;
    widget._durationChangedId = 12;
    widget._monitorsChangedId = 13;
    widget._settings = {
        get_int(key) {
            assert.equal(key, 'duration');
            return duration;
        },
        disconnect: id => disconnected.push(['settings', id]),
    };
    widget._runner = {
        running: false,
        async run(argv) {
            calls.push(Array.from(argv));
            return result;
        },
        destroy() {
            runnerDestroyed++;
        },
    };
    // Rendering is a separate boundary; retain the original orchestration.
    widget._renderData = data => rendered.push(data);
    widget._errorText = {text: '', visible: false};
    return {
        widget, timers, removed, disconnected, logs, calls, rendered, result,
        setDuration(value) { duration = value; },
        counts: () => ({actorDestroyed, runnerDestroyed}),
        fire(id) {
            const timer = timers.get(id);
            assert.ok(timer);
            timers.delete(id);
            return timer.callback();
        },
    };
}

test('successful refresh validates data, resets failures and schedules current interval', async () => {
    const h = harness();
    h.widget._failureCount = 4;
    h.widget._errorText = {text: 'old error', visible: true};
    await h.widget._refresh();
    assert.deepEqual(h.calls, [['python3', '-B', '/extension path/sjc_price.py']]);
    assert.equal(h.rendered.length, 1);
    assert.equal(h.rendered[0].buy, 100);
    assert.equal(h.widget._failureCount, 0);
    assert.equal(h.widget._errorText.visible, false);
    assert.equal(h.widget._errorText.text, '');
    assert.equal(h.timers.get(h.widget._refreshSourceId).delay, 300000);
    assert.deepEqual(h.logs, []);
});

test('partial market responses render and warn without failure backoff', async () => {
    const h = harness();
    h.result.stdout = JSON.stringify({
        buy: 100, sell: 110, spot_usd_oz: null, market_error: 'feed unavailable',
    });
    await h.widget._refresh();
    assert.equal(h.rendered.length, 1);
    assert.match(h.widget._errorText.text, /feed unavailable/);
    assert.equal(h.widget._errorText.style_class, 'sjc-warning-text');
    assert.equal(h.widget._errorText.visible, true);
    assert.equal(h.widget._failureCount, 0);
    assert.deepEqual(h.logs, []);
});

test('destroyed or already-running widgets do not start refreshes or alter timers', async () => {
    for (const field of ['destroyed', 'running']) {
        const h = harness();
        h.widget._scheduleNextRefresh(123);
        if (field === 'destroyed')
            h.widget._destroyed = true;
        else
            h.widget._runner.running = true;
        await h.widget._refresh();
        assert.equal(h.calls.length, 0);
        assert.equal(h.timers.size, 1);
        assert.deepEqual(h.removed, []);
    }
});

test('refresh removes the pending timer before running the feed', async () => {
    const h = harness();
    h.widget._scheduleNextRefresh(123);
    const oldId = h.widget._refreshSourceId;
    await h.widget._refresh();
    assert.deepEqual(h.removed, [oldId]);
    assert.equal(h.timers.size, 1);
    assert.notEqual(h.widget._refreshSourceId, oldId);
});

for (const [name, stdout, successful, stderr, message] of [
    ['invalid JSON', '{', true, '', /JSON/],
    ['failed process with invalid JSON', '{', false, ' process error ', /process error/],
    ['null JSON', 'null', true, '', /object JSON/],
    ['array JSON', '[]', true, '', /object JSON/],
    ['scalar JSON', '12', true, '', /object JSON/],
    ['feed error', '{"error":"feed error"}', true, '', /feed error/],
    ['unsuccessful process', '{"buy":100,"sell":110}', false, 'exit error', /exit error/],
    ['unsuccessful process without stderr', '{"buy":100,"sell":110}', false, '', /thất bại/],
    ['missing buy', '{"sell":110}', true, '', /buy/],
    ['string sell', '{"buy":100,"sell":"110"}', true, '', /sell/],
    ...['spot_usd_oz', 'usd_vnd_sell', 'international_vnd_luong', 'premium_sell']
        .map(key => [key, JSON.stringify({buy: 100, sell: 110, [key]: 'bad'}),
            true, '', new RegExp(key)]),
]) {
    test(`refresh rejects ${name}, retains displayed prices and reports failure`, async () => {
        const h = harness();
        Object.assign(h.result, {stdout, successful, stderr});
        h.widget._buyPrice = {text: 'last valid buy'};
        h.widget._sellPrice = {text: 'last valid sell'};
        await h.widget._refresh();
        assert.equal(h.rendered.length, 0);
        assert.equal(h.widget._buyPrice.text, 'last valid buy');
        assert.equal(h.widget._sellPrice.text, 'last valid sell');
        assert.match(h.widget._errorText.text, message);
        assert.equal(h.widget._errorText.style_class, 'sjc-error-text');
        assert.equal(h.widget._errorText.visible, true);
        assert.equal(h.widget._failureCount, 1);
        assert.equal(h.timers.get(h.widget._refreshSourceId).delay, 300000);
        assert.equal(h.logs.length, 1);
        assert.match(h.logs[0], /SJC Gold: refresh failed:/);
    });
}

test('numeric optional values and absent or null values pass validation', async () => {
    for (const value of [undefined, null, 0, -12, 120.5]) {
        const h = harness();
        h.result.stdout = JSON.stringify({
            buy: 0, sell: 1, spot_usd_oz: value, usd_vnd_sell: value,
            international_vnd_luong: value, premium_sell: value,
        });
        await h.widget._refresh();
        assert.equal(h.rendered.length, 1);
        assert.deepEqual(h.logs, []);
    }
});

test('runner rejection surfaces an error and schedules retry', async () => {
    const h = harness();
    h.widget._runner.run = async () => { throw new Error('spawn failed'); };
    await h.widget._refresh();
    assert.match(h.widget._errorText.text, /spawn failed/);
    assert.equal(h.widget._failureCount, 1);
    assert.equal(h.logs.length, 1);
    assert.equal(h.timers.size, 1);
});

test('runner cancellation does not log, display an error or schedule retry', async () => {
    for (const error of [
        new Error('__SJC_CANCELLED__'),
        {message: 'cancelled', matches: (domain, code) =>
            Boolean(domain) && code === 'cancelled'},
    ]) {
        const h = harness();
        h.widget._runner.run = async () => { throw error; };
        await h.widget._refresh();
        assert.equal(h.widget._errorText.visible, false);
        assert.equal(h.widget._failureCount, 0);
        assert.equal(h.timers.size, 0);
        assert.deepEqual(h.logs, []);
    }
});

test('destroy during an outstanding refresh suppresses late success and failure', async () => {
    for (const reject of [false, true]) {
        const h = harness();
        let finish;
        h.widget._runner.run = () => new Promise((resolve, rejectPromise) => {
            finish = reject ? () => rejectPromise(new Error('late failure'))
                : () => resolve(h.result);
        });
        const refresh = h.widget._refresh();
        h.widget.destroy();
        finish();
        await refresh;
        assert.equal(h.rendered.length, 0);
        assert.equal(h.timers.size, 0);
        assert.equal(h.widget._errorText.visible, false);
        assert.deepEqual(h.logs, []);
    }
});

test('failure backoff doubles then caps, including long user intervals', () => {
    for (const [duration, expected] of [
        [5, [300000, 600000, 1200000, 1800000]],
        [60, [3600000, 3600000, 3600000, 3600000]],
    ]) {
        const h = harness();
        h.setDuration(duration);
        for (const delay of expected) {
            h.widget._scheduleAfterFailure();
            assert.equal(h.timers.size, 1);
            assert.equal(h.timers.get(h.widget._refreshSourceId).delay, delay);
        }
        for (let i = 0; i < 20; i++)
            h.widget._scheduleAfterFailure();
        assert.equal(h.widget._failureCount, 10);
        assert.equal(h.timers.get(h.widget._refreshSourceId).delay, expected.at(-1));
    }
});

test('one-shot timer replacement clears ownership before refreshing', () => {
    const h = harness();
    h.widget._scheduleNextRefresh(123);
    const first = h.widget._refreshSourceId;
    h.widget._scheduleNextRefresh(456);
    const second = h.widget._refreshSourceId;
    assert.deepEqual(h.removed, [first]);
    assert.equal(h.timers.get(second).delay, 456);
    let calls = 0;
    h.widget._refresh = () => {
        assert.equal(h.widget._refreshSourceId, 0);
        calls++;
    };
    assert.equal(h.fire(second), false);
    assert.equal(calls, 1);
    assert.equal(h.timers.size, 0);
});

test('destroy disconnects owned signals, removes timer and destroys resources once', () => {
    const h = harness();
    h.widget._scheduleNextRefresh(123);
    const id = h.widget._refreshSourceId;
    h.widget.destroy();
    h.widget.destroy();
    h.widget._scheduleNextRefresh(456);
    assert.equal(h.widget._destroyed, true);
    assert.deepEqual(h.disconnected, [
        ['settings', 11], ['settings', 12], ['monitor', 13],
    ]);
    assert.deepEqual(h.removed, [id]);
    assert.deepEqual(h.counts(), {actorDestroyed: 1, runnerDestroyed: 1});
    assert.equal(h.widget._settings, null);
    assert.equal(h.widget._runner, null);
    assert.equal(h.widget._refreshSourceId, 0);
    assert.equal(h.timers.size, 0);
});

test('error text normalizes whitespace, caps length and switches warning style', () => {
    const h = harness();
    h.widget._showError('  first\n\tsecond  ', true);
    assert.equal(h.widget._errorText.text, 'first second');
    assert.equal(h.widget._errorText.style_class, 'sjc-warning-text');
    h.widget._showError('x'.repeat(240));
    assert.equal(h.widget._errorText.text.length, 240);
    h.widget._showError('x'.repeat(241));
    assert.equal(h.widget._errorText.text, `${'x'.repeat(240)}…`);
    assert.equal(h.widget._errorText.style_class, 'sjc-error-text');
    h.widget._showError(null);
    assert.equal(h.widget._errorText.visible, false);
    assert.equal(h.widget._errorText.text, '');
});
