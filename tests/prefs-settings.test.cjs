const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'prefs.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace('export default class SjcGoldPreferences', 'class SjcGoldPreferences');
const schema = fs.readFileSync(path.join(root,
    'schemas/org.gnome.shell.extensions.sjc-gold-binhnguyensoft-com.gschema.xml'), 'utf8');

function schemaKey(name) {
    const body = schema.match(new RegExp(`<key name="${name}" type="i">([\\s\\S]*?)</key>`))?.[1];
    assert.ok(body, `Missing integer schema key ${name}`);
    const range = body.match(/<range min="(\d+)" max="(\d+)"\/>/);
    assert.ok(range, `Missing schema range for ${name}`);
    return {
        lower: Number(range[1]),
        upper: Number(range[2]),
        value: Number(body.match(/<default>(\d+)<\/default>/)[1]),
        summary: body.match(/<summary>([\s\S]*?)<\/summary>/)[1],
        description: body.match(/<description>([\s\S]*?)<\/description>/)[1],
    };
}

function harness(durationValue = schemaKey('duration').value) {
    class Widget {
        constructor(properties = {}) {
            Object.assign(this, properties);
            this.children = [];
            this.handlers = new Map();
        }
        add(child) {
            this.children.push(child);
        }
        add_suffix(child) {
            this.children.push(child);
        }
        connect(signal, callback) {
            assert.ok(!this.handlers.has(signal), `Duplicate handler for ${signal}`);
            this.handlers.set(signal, callback);
            return this.handlers.size;
        }
    }
    class Adjustment extends Widget {}
    class SpinRow extends Widget {
        get_value_as_int() {
            return Math.round(this.adjustment.value);
        }
    }
    const bindings = [];
    const writes = [];
    const reads = [];
    const settings = {
        settings_schema: {
            get_key(name) {
                const key = schemaKey(name);
                return {
                    get_summary: () => key.summary,
                    get_description: () => key.description,
                };
            },
        },
        get_int(name) {
            reads.push(name);
            assert.equal(name, 'duration');
            return durationValue;
        },
        set_int(name, value) {
            assert.equal(name, 'duration');
            assert.ok(Number.isInteger(value));
            writes.push({name, value});
        },
        bind(name, target, property, flags) {
            bindings.push({name, target, property, flags});
        },
    };
    let settingsRequests = 0;
    const defaultFlags = Symbol('default settings binding');
    const context = vm.createContext({
        Adw: {
            PreferencesPage: Widget,
            PreferencesGroup: Widget,
            SpinRow,
            ActionRow: Widget,
        },
        Gtk: {Adjustment, Image: Widget},
        Gio: {SettingsBindFlags: {DEFAULT: defaultFlags}},
        ExtensionPreferences: class {
            getSettings() {
                settingsRequests++;
                return settings;
            }
        },
    });
    const Preferences = vm.runInContext(`${source}\nSjcGoldPreferences;`, context, {filename});
    const preferences = new Preferences();
    const window = new Widget();
    const sizes = [];
    window.set_default_size = (...args) => sizes.push(args);
    preferences.fillPreferencesWindow(window);
    assert.equal(window.children.length, 1);
    const page = window.children[0];
    const [position, duration] = page.children;
    const [leftRow, topRow] = position.children;
    const [durationRow] = duration.children;
    return {
        settings, settingsRequests, preferences, window, sizes, page, position,
        duration, leftRow, topRow, durationRow, bindings, writes, reads, defaultFlags,
    };
}

test('window has one page with separate position and duration groups', () => {
    const h = harness();
    assert.deepEqual(h.sizes, [[600, -1]]);
    assert.equal(h.settingsRequests, 1);
    assert.equal(h.preferences._settings, h.settings);
    assert.equal(h.position.children.length, 2);
    assert.equal(h.duration.children.length, 1);
    assert.equal(h.page.children.length, 3);
    assert.notEqual(h.position, h.duration);
});

for (const name of ['left', 'top', 'duration']) {
    test(`${name} row uses schema labels and integer spin controls`, () => {
        const h = harness();
        const row = h[`${name}Row`];
        const key = schemaKey(name);
        assert.equal(row.title, key.summary);
        assert.equal(row.subtitle, key.description);
        assert.equal(row.digits, 0);
        assert.equal(row.numeric, true);
        assert.equal(row.snap_to_ticks, true);
        assert.equal(row.adjustment.lower, key.lower);
        assert.equal(row.adjustment.upper, key.upper);
        assert.equal(row.adjustment.step_increment, 5);
    });
}

test('position adjustments bind matching settings keys with default flags', () => {
    const h = harness();
    assert.equal(h.bindings.length, 2);
    for (const [index, name] of ['left', 'top'].entries()) {
        const binding = h.bindings[index];
        assert.equal(binding.name, name);
        assert.equal(binding.target, h[`${name}Row`].adjustment);
        assert.equal(binding.property, 'value');
        assert.equal(binding.flags, h.defaultFlags);
    }
    assert.notEqual(h.leftRow.adjustment, h.topRow.adjustment);
    assert.deepEqual(h.writes, []);
});

for (const initial of [5, 75, 300]) {
    test(`duration initializes from saved value ${initial} without writing it back`, () => {
        const h = harness(initial);
        assert.deepEqual(h.reads, ['duration']);
        assert.equal(h.durationRow.adjustment.value, initial);
        assert.deepEqual(h.writes, []);
        assert.deepEqual([...h.durationRow.handlers.keys()], ['notify::value']);
    });
}

test('duration notification persists the emitting row integer value', () => {
    const h = harness(75);
    const handler = h.durationRow.handlers.get('notify::value');
    for (const value of [5, 125, 300]) {
        h.durationRow.adjustment.value = value;
        handler(h.durationRow);
    }
    let integerReads = 0;
    handler({
        get_value_as_int() {
            integerReads++;
            return 85;
        },
    });
    assert.equal(integerReads, 1);
    assert.deepEqual(h.writes, [5, 125, 300, 85].map(value => ({name: 'duration', value})));
});

test('separate preferences instances keep adjustments and writes independent', () => {
    const first = harness(10);
    const second = harness(25);
    first.durationRow.adjustment.value = 40;
    first.durationRow.handlers.get('notify::value')(first.durationRow);
    assert.deepEqual(first.writes, [{name: 'duration', value: 40}]);
    assert.deepEqual(second.writes, []);
    assert.equal(second.durationRow.adjustment.value, 25);
    assert.notEqual(first.settings, second.settings);
    assert.notEqual(first.leftRow.adjustment, second.leftRow.adjustment);
});
