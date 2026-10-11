const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;\r?$/gm, line => ' '.repeat(line.length))
    .replace('export default ', ' '.repeat('export default '.length));

function formatters() {
    const context = vm.createContext({
        Gio: {_promisify() {}, Subprocess: {prototype: {}}},
        GObject: {registerClass: cls => cls},
        St: {Widget: class {}},
        Extension: class {},
    });
    vm.runInContext(source, context, {filename});
    return vm.runInContext('({formatPrice, formatSignedPrice})', context);
}

test('price formatting uses Vietnamese grouping and decimal separators', () => {
    const {formatPrice} = formatters();
    for (const [value, expected] of [
        [0, '0'],
        [12, '12'],
        [999, '999'],
        [1000, '1.000'],
        [123456789, '123.456.789'],
        [1234.5, '1.234,5'],
        [1234.567, '1.234,567'],
        [-1234.5, '-1.234,5'],
    ])
        assert.equal(formatPrice(value), expected, `price ${value}`);
});

test('price formatting preserves the Intl three-decimal rounding contract', () => {
    const {formatPrice} = formatters();
    assert.equal(formatPrice(1234.5678), '1.234,568');
    assert.equal(formatPrice(-1234.5678), '-1.234,568');
});

for (const [name, value] of [
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['undefined', undefined],
    ['null', null],
    ['numeric string', '1234.5'],
    ['empty string', ''],
    ['true', true],
    ['false', false],
    ['bigint', 1234n],
    ['boxed number', new Number(1234)],
    ['array', [1234]],
    ['object', {}],
    ['symbol', Symbol('price')],
]) {
    test(`both formatters reject ${name} without numeric coercion`, () => {
        const {formatPrice, formatSignedPrice} = formatters();
        assert.equal(formatPrice(value), '\u2014');
        assert.equal(formatSignedPrice(value), '\u2014');
    });
}

test('invalid objects are not coerced or inspected for a numeric value', () => {
    const {formatPrice, formatSignedPrice} = formatters();
    const value = {
        valueOf() { throw new Error('unexpected valueOf'); },
        toString() { throw new Error('unexpected toString'); },
        [Symbol.toPrimitive]() { throw new Error('unexpected coercion'); },
    };
    assert.equal(formatPrice(value), '\u2014');
    assert.equal(formatSignedPrice(value), '\u2014');
});

test('signed prices round to whole VND before adding a positive prefix', () => {
    const {formatSignedPrice} = formatters();
    for (const [value, expected] of [
        [1, '+1'],
        [1000, '+1.000'],
        [1234567.6, '+1.234.568'],
        [0.49, '0'],
        [0.5, '+1'],
        [1.49, '+1'],
        [1.5, '+2'],
    ])
        assert.equal(formatSignedPrice(value), expected, `premium ${value}`);
});

test('negative premiums retain their sign and Math.round tie behavior', () => {
    const {formatSignedPrice} = formatters();
    for (const [value, expected] of [
        [-1, '-1'],
        [-1000, '-1.000'],
        [-1234567.6, '-1.234.568'],
        [-0.51, '-1'],
        [-1.49, '-1'],
        [-1.5, '-1'],
        [-1.51, '-2'],
    ])
        assert.equal(formatSignedPrice(value), expected, `premium ${value}`);
});

test('signed prices normalize negative zero and rounded zero without a prefix', () => {
    const {formatSignedPrice} = formatters();
    for (const value of [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, -0.49, -0.5])
        assert.equal(formatSignedPrice(value), '0', `zero premium ${value}`);
});

test('plain prices retain negative zero while signed prices normalize it', () => {
    const {formatPrice, formatSignedPrice} = formatters();
    assert.equal(formatPrice(-0), '-0');
    assert.equal(formatPrice(0), '0');
    assert.equal(formatSignedPrice(-0), '0');
});

test('both formatters accept finite extreme values without treating them as missing', () => {
    const {formatPrice, formatSignedPrice} = formatters();
    for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE,
        Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
        const price = formatPrice(value);
        const signed = formatSignedPrice(value);
        assert.notEqual(price, '\u2014');
        assert.notEqual(signed, '\u2014');
        assert.match(price, /^-?\d[\d.]*$/);
        assert.equal(signed, value > 0 ? `+${price}` : price);
    }
});

test('signed and plain calls do not change each other or share state between contexts', () => {
    const first = formatters();
    const second = formatters();
    for (const current of [first, second, first]) {
        assert.equal(current.formatPrice(1234.5), '1.234,5');
        assert.equal(current.formatSignedPrice(1234.5), '+1.235');
        assert.equal(current.formatSignedPrice(-0.5), '0');
        assert.equal(current.formatPrice(1234.5), '1.234,5');
    }
});
