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
    const events = [];
    const settingsSignals = new Map();
    const monitorSignals = new Map();
    const values = {left: 15, top: 15, duration: 5};
    const scheduled = [];
    let nextId = 1;
    const settings = {
        connect(signal, callback) {
            const id = nextId++;
            settingsSignals.set(id, {signal, callback});
            events.push(signal);
            return id;
        },
        get_int(key) {
            assert.ok(Object.hasOwn(values, key), `unexpected setting: ${key}`);
            return values[key];
        },
    };
    const extension = {
        path: '/extension path',
        getSettings() {
            events.push('get-settings');
            return settings;
        },
    };
    class Widget {
        constructor(...args) {
            this._init(...args);
        }

        _init(params) {
            this.actorParams = params;
            events.push('actor-init');
        }

        queue_relayout() {
            events.push('relayout');
        }

        vfunc_allocate(box) {
            events.push('allocate');
            this.allocatedBox = box;
            this.allocatedOrigin = [...box.origin];
        }
    }
    const layoutManager = {
        primaryMonitor: {x: 1920, y: -200, width: 1280, height: 720},
        connect(signal, callback) {
            const id = nextId++;
            monitorSignals.set(id, {signal, callback});
            events.push(signal);
            return id;
        },
        _backgroundGroup: {
            add_child(child) {
                events.push('attach');
                this.child = child;
            },
        },
    };
    const context = vm.createContext({
        Gio: {_promisify() {}, Subprocess: {prototype: {}}},
        GLib: {build_filenamev: parts => Array.from(parts).join('/')},
        GObject: {registerClass: cls => cls},
        Clutter: {BinLayout: class {}},
        St: {Widget},
        Main: {layoutManager},
        Extension: class {},
    });
    vm.runInContext(source, context, {filename});
    const {SjcGoldWidget, SjcGoldExtension, SafeCommandRunner} =
        vm.runInContext('({SjcGoldWidget, SjcGoldExtension, SafeCommandRunner})', context);

    // These boundaries belong to separate suites, not initialization tests.
    SjcGoldWidget.prototype._buildUi = function () {
        events.push('build-ui');
        assert.equal(this._settings, settings);
        assert.ok(this._runner instanceof SafeCommandRunner);
    };
    SjcGoldWidget.prototype._refresh = function () {
        events.push('refresh');
        assert.equal(layoutManager._backgroundGroup.child, this);
    };
    SjcGoldWidget.prototype._scheduleNextRefresh = delay => scheduled.push(delay);

    return {
        events, settings, settingsSignals, monitorSignals, values, scheduled,
        layoutManager, extension, SjcGoldWidget, SjcGoldExtension, SafeCommandRunner,
        createWidget: () => new SjcGoldWidget(extension),
        emitSettings(signal, key) {
            const entry = [...settingsSignals.values()].find(item => item.signal === signal);
            assert.ok(entry, `missing signal: ${signal}`);
            entry.callback(settings, key);
        },
        emitMonitor() {
            const entry = [...monitorSignals.values()]
                .find(item => item.signal === 'monitors-changed');
            assert.ok(entry);
            entry.callback();
        },
    };
}

function actorBox(width, height, origin = [7, 9]) {
    return {
        origin: [...origin],
        get_width: () => width,
        get_height: () => height,
        set_origin(x, y) { this.origin = [x, y]; },
    };
}

test('initialization creates actor, runner and settings before attachment and refresh', () => {
    const h = harness();
    const widget = h.createWidget();
    assert.equal(widget.actorParams.reactive, false);
    assert.equal(widget.actorParams.can_focus, false);
    assert.ok(widget.actorParams.layout_manager);
    assert.equal(widget._scriptPath, '/extension path/sjc_price.py');
    assert.equal(widget._refreshSourceId, 0);
    assert.equal(widget._failureCount, 0);
    assert.equal(widget._destroyed, false);
    assert.ok(widget._runner instanceof h.SafeCommandRunner);
    assert.equal(widget._runner.running, false);
    assert.equal(widget._settings, h.settings);
    assert.equal(h.layoutManager._backgroundGroup.child, widget);
    assert.deepEqual(h.events, [
        'actor-init', 'get-settings', 'build-ui', 'changed',
        'monitors-changed', 'changed::duration', 'attach', 'refresh',
    ]);
    assert.deepEqual(h.scheduled, []);
});

test('initialization retains signal IDs for the corresponding settings and monitor owners', () => {
    const h = harness();
    const widget = h.createWidget();
    assert.equal(h.settingsSignals.size, 2);
    assert.equal(h.monitorSignals.size, 1);
    assert.equal(h.settingsSignals.get(widget._positionChangedId).signal, 'changed');
    assert.equal(h.settingsSignals.get(widget._durationChangedId).signal, 'changed::duration');
    assert.equal(h.monitorSignals.get(widget._monitorsChangedId).signal, 'monitors-changed');
    assert.equal(new Set([
        widget._positionChangedId, widget._durationChangedId, widget._monitorsChangedId,
    ]).size, 3);
});

for (const key of ['left', 'top']) {
    test(`${key} setting changes request relayout without scheduling a fetch`, () => {
        const h = harness();
        h.createWidget();
        h.events.length = 0;
        h.emitSettings('changed', key);
        assert.deepEqual(h.events, ['relayout']);
        assert.deepEqual(h.scheduled, []);
    });
}

test('unrelated setting changes do not request relayout or refresh', () => {
    const h = harness();
    h.createWidget();
    h.events.length = 0;
    for (const key of ['duration', 'other'])
        h.emitSettings('changed', key);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.scheduled, []);
});

test('monitor changes request relayout without scheduling a fetch', () => {
    const h = harness();
    h.createWidget();
    h.events.length = 0;
    h.emitMonitor();
    assert.deepEqual(h.events, ['relayout']);
    assert.deepEqual(h.scheduled, []);
});

test('duration changes reset failures and schedule the current interval when idle', () => {
    const h = harness();
    const widget = h.createWidget();
    h.events.length = 0;
    for (const duration of [5, 17, 300]) {
        h.values.duration = duration;
        widget._failureCount = 8;
        h.emitSettings('changed::duration');
        assert.equal(widget._failureCount, 0);
    }
    assert.deepEqual(h.scheduled, [300000, 1020000, 18000000]);
    assert.deepEqual(h.events, []);
});

test('duration changes reset failures but do not reschedule during a running fetch', () => {
    const h = harness();
    const widget = h.createWidget();
    widget._runner = {running: true};
    widget._failureCount = 8;
    h.values.duration = 17;
    h.events.length = 0;
    h.emitSettings('changed::duration');
    assert.equal(widget._failureCount, 0);
    assert.deepEqual(h.scheduled, []);
    assert.deepEqual(h.events, []);
});

for (const [name, left, top, width, height, expected] of [
    ['inside monitor', 150, 75, 300, 200, [2070, -125]],
    ['negative settings', -30, -40, 300, 200, [1920, -200]],
    ['past monitor edges', 10000, 10000, 300, 200, [2900, 320]],
    ['exact available edges', 980, 520, 300, 200, [2900, 320]],
    ['widget larger than monitor', 15, 15, 1400, 800, [1920, -200]],
    ['widget equal to monitor', 15, 15, 1280, 720, [1920, -200]],
    ['zero-sized widget', 1280, 720, 0, 0, [3200, 520]],
]) {
    test(`allocation clamps ${name} and delegates the positioned box to the actor`, () => {
        const h = harness();
        const widget = h.createWidget();
        Object.assign(h.values, {left, top});
        const box = actorBox(width, height);
        widget.vfunc_allocate(box);
        assert.deepEqual(box.origin, expected);
        assert.equal(widget.allocatedBox, box);
        assert.deepEqual(widget.allocatedOrigin, expected);
        assert.equal(h.events.at(-1), 'allocate');
    });
}

test('allocation reads changed settings and the current primary monitor each time', () => {
    const h = harness();
    const widget = h.createWidget();
    const box = actorBox(300, 200);
    widget.vfunc_allocate(box);
    assert.deepEqual(box.origin, [1935, -185]);
    h.layoutManager.primaryMonitor = {x: -1600, y: 300, width: 1600, height: 900};
    Object.assign(h.values, {left: 25, top: 45});
    widget.vfunc_allocate(box);
    assert.deepEqual(widget.allocatedOrigin, [-1575, 345]);
});

test('allocation without a primary monitor preserves origin and still delegates', () => {
    const h = harness();
    const widget = h.createWidget();
    h.layoutManager.primaryMonitor = null;
    const box = actorBox(300, 200);
    widget.vfunc_allocate(box);
    assert.equal(widget.allocatedBox, box);
    assert.deepEqual(widget.allocatedOrigin, [7, 9]);
});

test('enable constructs and retains a widget using this extension settings and path', () => {
    const h = harness();
    const extension = new h.SjcGoldExtension();
    Object.assign(extension, h.extension);
    extension.enable();
    assert.ok(extension._widget instanceof h.SjcGoldWidget);
    assert.equal(extension._widget._settings, h.settings);
    assert.equal(extension._widget._scriptPath, '/extension path/sjc_price.py');
    assert.equal(h.layoutManager._backgroundGroup.child, extension._widget);
    assert.equal(h.events.filter(event => event === 'refresh').length, 1);
});

test('disable without an enabled widget is safe and leaves a null reference', () => {
    const h = harness();
    const extension = new h.SjcGoldExtension();
    extension.disable();
    extension.disable();
    assert.equal(extension._widget, null);
});

test('disable delegates destruction once and clears the reference before another disable', () => {
    const h = harness();
    const extension = new h.SjcGoldExtension();
    let calls = 0;
    extension._widget = {destroy() { calls++; }};
    extension.disable();
    extension.disable();
    assert.equal(calls, 1);
    assert.equal(extension._widget, null);
});

test('disable clears the widget reference even when destruction throws and preserves the error', () => {
    const h = harness();
    const extension = new h.SjcGoldExtension();
    const error = new Error('actor destruction failed');
    extension._widget = {destroy() { throw error; }};
    assert.throws(() => extension.disable(), thrown => thrown === error);
    assert.equal(extension._widget, null);
    extension.disable();
});

test('enable after disable constructs a new widget and runner', () => {
    const h = harness();
    const extension = new h.SjcGoldExtension();
    Object.assign(extension, h.extension);
    extension.enable();
    const first = extension._widget;
    // The widget destruction implementation is claimed by the refresh suite.
    first.destroy = () => {};
    extension.disable();
    extension.enable();
    assert.notEqual(extension._widget, first);
    assert.notEqual(extension._widget._runner, first._runner);
    assert.equal(h.layoutManager._backgroundGroup.child, extension._widget);
    assert.equal(h.events.filter(event => event === 'refresh').length, 2);
});
