const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const filename = path.resolve(__dirname, '../extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;$/gm, match => ' '.repeat(match.length))
    .replace(/^export default /gm, match => ' '.repeat(match.length));
const fields = [
    '_productName', '_updated', '_buyPrice', '_sellPrice', '_spreadValue',
    '_internationalValue', '_premiumValue', '_spotValue', '_usdValue',
];
const missing = '\u2014';

function setup() {
    const calls = [];
    let time = '09:17';
    const context = vm.createContext({
        Gio: {Subprocess: class {}, _promisify() {}},
        GLib: {
            DateTime: {
                new_now_local() {
                    calls.push(['now']);
                    return {
                        format(pattern) {
                            calls.push(['format', pattern]);
                            return time;
                        },
                    };
                },
            },
        },
        GObject: {registerClass: klass => klass},
        St: {Widget: class {}},
        Extension: class {},
        // The production module has no formatDecimal definition.
        formatDecimal(value) {
            calls.push(['spot', value]);
            return `spot:${value}`;
        },
    });
    vm.runInContext(source, context, {filename});
    const prototype = vm.runInContext('SjcGoldWidget.prototype', context);
    const widget = Object.create(prototype);
    for (const field of fields)
        widget[field] = {text: 'previous'};
    const data = {
        name: 'SJC 1L',
        buy: 90000000,
        sell: 92000000,
        international_vnd_luong: 81000000.6,
        premium_sell: 10999999.4,
        spot_usd_oz: 2650.25,
        usd_vnd_sell: 25400,
    };
    return {widget, data, calls, setTime: value => { time = value; }};
}

test('routes a complete response into every retained label', () => {
    const {widget, data, calls} = setup();
    widget._renderData(data);
    assert.equal(widget._productName.text, 'SJC 1L (VND/l\u01b0\u1ee3ng)');
    assert.equal(widget._updated.text, 'C\u1eadp nh\u1eadt: 09:17');
    assert.equal(widget._buyPrice.text, '90.000.000');
    assert.equal(widget._sellPrice.text, '92.000.000');
    assert.equal(widget._spreadValue.text, '2.000.000');
    assert.equal(widget._internationalValue.text, '81.000.001');
    assert.equal(widget._premiumValue.text, '+10.999.999');
    assert.equal(widget._spotValue.text, 'XAU/USD: spot:2650.25');
    assert.equal(widget._usdValue.text, 'USD/VND: 25.400');
    assert.deepEqual(calls, [['now'], ['format', '%H:%M'], ['spot', 2650.25]]);
});

for (const name of [undefined, null, '', false]) {
    test(`uses the default product caption for ${String(name)}`, () => {
        const {widget, data} = setup();
        widget._renderData({...data, name});
        assert.equal(widget._productName.text,
            'V\u00e0ng mi\u1ebfng SJC (VND/l\u01b0\u1ee3ng)');
    });
}

test('computes spread from current buy and sell without rounding either price', () => {
    const {widget, data} = setup();
    widget._renderData({...data, buy: 1000.25, sell: 900.75});
    assert.equal(widget._buyPrice.text, '1.000,25');
    assert.equal(widget._sellPrice.text, '900,75');
    assert.equal(widget._spreadValue.text, '-99,5');
});

test('keeps zero prices and conversion instead of treating them as missing', () => {
    const {widget, data} = setup();
    widget._renderData({
        ...data, buy: 0, sell: 0, international_vnd_luong: 0,
        premium_sell: 0, usd_vnd_sell: 0,
    });
    for (const field of [
        '_buyPrice', '_sellPrice', '_spreadValue',
        '_internationalValue', '_premiumValue',
    ])
        assert.equal(widget[field].text, '0', field);
    assert.equal(widget._usdValue.text, 'USD/VND: 0');
});

for (const international of [undefined, null, NaN, Infinity, -Infinity, '81000000']) {
    test(`uses a placeholder for non-finite conversion ${String(international)}`, () => {
        const {widget, data} = setup();
        widget._renderData({...data, international_vnd_luong: international});
        assert.equal(widget._internationalValue.text, missing);
        assert.equal(widget._buyPrice.text, '90.000.000');
    });
}

test('rounds conversion to whole VND independently of signed premium', () => {
    const {widget, data} = setup();
    widget._renderData({
        ...data, international_vnd_luong: 1234.49, premium_sell: -1234.6,
    });
    assert.equal(widget._internationalValue.text, '1.234');
    assert.equal(widget._premiumValue.text, '-1.235');
});

test('passes the original spot value to the explicit decimal dependency', () => {
    const {widget, data, calls} = setup();
    widget._renderData({...data, spot_usd_oz: null});
    assert.deepEqual(calls.at(-1), ['spot', null]);
    assert.equal(widget._spotValue.text, 'XAU/USD: spot:null');
});

test('clears previously populated optional values on the next response', () => {
    const {widget, data, setTime} = setup();
    widget._renderData(data);
    setTime('10:42');
    widget._renderData({buy: 100, sell: 200});
    assert.equal(widget._updated.text, 'C\u1eadp nh\u1eadt: 10:42');
    assert.equal(widget._buyPrice.text, '100');
    assert.equal(widget._sellPrice.text, '200');
    assert.equal(widget._spreadValue.text, '100');
    assert.equal(widget._internationalValue.text, missing);
    assert.equal(widget._premiumValue.text, missing);
    assert.equal(widget._spotValue.text, 'XAU/USD: spot:undefined');
    assert.equal(widget._usdValue.text, `USD/VND: ${missing}`);
});

test('retains label identities and leaves unrelated error state untouched', () => {
    const {widget, data} = setup();
    const labels = fields.map(field => widget[field]);
    const error = {text: 'existing warning', visible: true};
    widget._errorText = error;
    widget._renderData(data);
    fields.forEach((field, index) => assert.equal(widget[field], labels[index]));
    assert.equal(widget._errorText, error);
    assert.deepEqual(error, {text: 'existing warning', visible: true});
});

test('does not mutate its response or share labels between widget instances', () => {
    const first = setup();
    const second = setup();
    const data = Object.freeze({...first.data});
    first.widget._renderData(data);
    second.widget._renderData({...second.data, buy: 10, sell: 20});
    assert.deepEqual(data, first.data);
    assert.equal(first.widget._buyPrice.text, '90.000.000');
    assert.equal(second.widget._buyPrice.text, '10');
    fields.forEach(field => assert.notEqual(first.widget[field], second.widget[field]));
});
