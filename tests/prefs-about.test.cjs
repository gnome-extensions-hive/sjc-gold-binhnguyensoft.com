const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'prefs.js');
const original = fs.readFileSync(filename, 'utf8');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));
const source = original
    .replace(/^import .*;\r?$/gm, match => ' '.repeat(match.length))
    .replace('export default ', ' '.repeat('export default '.length));

function harness(extensionMetadata = metadata, failures = {}) {
    const windows = [];
    const events = [];
    class AboutWindow {
        constructor(properties) {
            events.push('construct');
            if (failures.construct)
                throw failures.construct;
            this.properties = properties;
            this.presentations = 0;
            windows.push(this);
        }

        present() {
            events.push('present');
            if (failures.present)
                throw failures.present;
            this.presentations++;
        }
    }
    const context = vm.createContext({
        Adw: {AboutWindow},
        ExtensionPreferences: class {},
    });
    const Preferences = vm.runInContext(
        `${source}\nSjcGoldPreferences;`, context, {filename});
    const preferences = new Preferences();
    preferences.metadata = extensionMetadata;
    return {preferences, windows, events};
}

test('About window uses the extension metadata and project attribution', () => {
    const h = harness();
    h.preferences._showAbout({});
    const properties = h.windows[0].properties;
    assert.equal(properties.application_name, metadata.name);
    assert.equal(properties.version, metadata['version-name']);
    assert.equal(properties.developer_name, 'Bình Nguyễn');
    assert.equal(properties.website, 'https://www.binhnguyensoft.com');
    assert.equal(properties.issue_url, `${metadata.url}/issues`);
});

test('About window is modal and retains the exact preferences parent', () => {
    const h = harness();
    const parent = {identity: Symbol('preferences parent')};
    h.preferences._showAbout(parent);
    assert.equal(h.windows[0].properties.transient_for, parent);
    assert.equal(h.windows[0].properties.modal, true);
});

test('each activation constructs then presents exactly one window', () => {
    const h = harness();
    h.preferences._showAbout({});
    assert.equal(h.windows.length, 1);
    assert.equal(h.windows[0].presentations, 1);
    assert.deepEqual(h.events, ['construct', 'present']);
});

test('metadata is read at activation rather than hard-coded or cached', () => {
    const h = harness({
        name: 'Alternate extension',
        'version-name': '3.2-preview',
        url: 'https://example.invalid/project',
    });
    h.preferences._showAbout({});
    const first = h.windows[0].properties;
    assert.equal(first.application_name, 'Alternate extension');
    assert.equal(first.version, '3.2-preview');
    assert.equal(first.issue_url, 'https://example.invalid/project/issues');

    h.preferences.metadata = {
        name: 'Updated extension',
        'version-name': '4.0',
        url: 'https://example.invalid/updated',
    };
    h.preferences._showAbout({});
    const second = h.windows[1].properties;
    assert.equal(second.application_name, 'Updated extension');
    assert.equal(second.version, '4.0');
    assert.equal(second.issue_url, 'https://example.invalid/updated/issues');
    assert.equal(first.application_name, 'Alternate extension');
});

test('repeated activation creates independent windows for each parent', () => {
    const h = harness();
    const firstParent = {};
    const secondParent = {};
    h.preferences._showAbout(firstParent);
    h.preferences._showAbout(secondParent);
    assert.equal(h.windows.length, 2);
    assert.notEqual(h.windows[0], h.windows[1]);
    assert.notEqual(h.windows[0].properties, h.windows[1].properties);
    assert.equal(h.windows[0].properties.transient_for, firstParent);
    assert.equal(h.windows[1].properties.transient_for, secondParent);
    assert.deepEqual(h.windows.map(window => window.presentations), [1, 1]);
});

test('separate preferences instances keep their metadata and windows independent', () => {
    const first = harness({...metadata, name: 'First'});
    const second = harness({...metadata, name: 'Second'});
    first.preferences._showAbout({});
    second.preferences._showAbout({});
    assert.equal(first.windows[0].properties.application_name, 'First');
    assert.equal(second.windows[0].properties.application_name, 'Second');
    assert.notEqual(first.windows[0], second.windows[0]);
    assert.deepEqual(first.events, ['construct', 'present']);
    assert.deepEqual(second.events, ['construct', 'present']);
});

test('construction failure propagates without attempting presentation', () => {
    const failure = new Error('About window construction failed');
    const h = harness(metadata, {construct: failure});
    assert.throws(() => h.preferences._showAbout({}), error => error === failure);
    assert.deepEqual(h.events, ['construct']);
    assert.equal(h.windows.length, 0);
});

test('presentation failure propagates without retrying or constructing another window', () => {
    const failure = new Error('About window presentation failed');
    const h = harness(metadata, {present: failure});
    assert.throws(() => h.preferences._showAbout({}), error => error === failure);
    assert.deepEqual(h.events, ['construct', 'present']);
    assert.equal(h.windows.length, 1);
    assert.equal(h.windows[0].presentations, 0);
});
