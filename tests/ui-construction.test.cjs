const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../extension.js');
const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace('export default class SjcGoldExtension', 'class SjcGoldExtension');

function loadUi() {
    class Actor {
        constructor(params = {}) {
            Object.assign(this, params);
            this.children = [];
        }

        add_child(child) {
            this.children.push(child);
        }
    }

    class Label extends Actor {
        constructor(params) {
            super(params);
            this.clutter_text = {
                set_line_alignment(alignment) {
                    this.alignment = alignment;
                },
            };
        }
    }

    class BoxLayout extends Actor {}
    class Widget extends Actor {}

    const context = vm.createContext({
        Clutter: {ActorAlign: {CENTER: 'center', END: 'end'}},
        Gio: {_promisify() {}, Subprocess: {prototype: {}}},
        GLib: {},
        GObject: {registerClass: klass => klass},
        Pango: {
            EllipsizeMode: {NONE: 'none'},
            Alignment: {LEFT: 'left', RIGHT: 'right'},
        },
        St: {Label, BoxLayout, Widget},
        Main: {},
        Extension: class {},
    });
    vm.runInContext(
        `${source}\nglobalThis.ui = {SjcGoldWidget, makeLabel};`,
        context,
        {filename}
    );
    const widget = new context.ui.SjcGoldWidget();
    widget._buildUi();
    return {widget, makeLabel: context.ui.makeLabel, Actor, Label, BoxLayout, Widget};
}

function parts(widget) {
    const [card] = widget.children;
    const [header, product, prices, footer, error] = card.children;
    return {card, header, product, prices, footer, error};
}

test('makeLabel preserves defaults and supports explicit parameter overrides', () => {
    const {makeLabel, Label} = loadUi();
    const label = makeLabel('example', 'custom');
    assert.ok(label instanceof Label);
    assert.equal(label.text, 'example');
    assert.equal(label.style_class, 'custom');
    assert.equal(label.y_align, 'center');
    const overridden = makeLabel('original', 'original', {
        text: 'replacement',
        style_class: 'replacement',
        y_align: 'end',
        x_expand: true,
    });
    assert.equal(overridden.text, 'replacement');
    assert.equal(overridden.style_class, 'replacement');
    assert.equal(overridden.y_align, 'end');
    assert.equal(overridden.x_expand, true);
});

test('buildUi attaches one card with the ordered header, product, prices, footer and error', () => {
    const {widget, BoxLayout, Label} = loadUi();
    const {card, header, product, prices, footer, error} = parts(widget);
    assert.equal(widget.children.length, 1);
    assert.ok(card instanceof BoxLayout);
    assert.equal(card.style_class, 'sjc-card');
    assert.equal(card.vertical, true);
    assert.equal(card.children.length, 5);
    assert.deepEqual(
        [header, product, prices, footer, error].map(actor => actor.style_class),
        ['sjc-header', 'sjc-product-row', 'sjc-price-row', 'sjc-footer', 'sjc-error-text']
    );
    for (const actor of [header, product, prices, footer]) {
        assert.ok(actor instanceof BoxLayout);
        assert.equal(actor.x_expand, true);
    }
    assert.ok(error instanceof Label);
    assert.equal(prices.vertical, true);
    assert.equal(footer.vertical, true);
});

test('header contains the expanding SJC title', () => {
    const {widget, Label} = loadUi();
    const {header} = parts(widget);
    assert.equal(header.children.length, 1);
    const [title] = header.children;
    assert.ok(title instanceof Label);
    assert.equal(title.text, 'GIÁ VÀNG SJC');
    assert.equal(title.style_class, 'sjc-title');
    assert.equal(title.x_expand, true);
});

test('product and update references point to the visible labels in display order', () => {
    const {widget} = loadUi();
    const {product} = parts(widget);
    assert.deepEqual(product.children, [widget._productName, widget._updated]);
    assert.equal(widget._productName.text, 'Vàng miếng SJC (VND/lượng)');
    assert.equal(widget._productName.style_class, 'sjc-product');
    assert.equal(widget._productName.x_expand, true);
    assert.equal(widget._updated.text, 'Cập nhật: --:--');
    assert.equal(widget._updated.style_class, 'sjc-product');
    assert.equal(widget._updated.x_align, 'end');
});

test('buy and sell headings preserve their alignment and disable ellipsizing', () => {
    const {widget, BoxLayout} = loadUi();
    const {prices} = parts(widget);
    assert.equal(prices.children.length, 2);
    const [headings, values] = prices.children;
    for (const row of [headings, values]) {
        assert.ok(row instanceof BoxLayout);
        assert.equal(row.x_expand, true);
        assert.equal(row.children.length, 2);
    }
    const [buy, sell] = headings.children;
    assert.equal(buy.text, 'MUA VÀO');
    assert.equal(sell.text, 'BÁN RA');
    assert.equal(buy.style_class, 'sjc-label');
    assert.equal(sell.style_class, 'sjc-label');
    assert.equal(buy.x_expand, true);
    assert.equal(sell.x_align, 'end');
    assert.equal(buy.clutter_text.ellipsize, 'none');
    assert.equal(sell.clutter_text.ellipsize, 'none');
    assert.equal(buy.clutter_text.alignment, 'left');
    assert.equal(sell.clutter_text.alignment, 'right');
});

test('price references point to distinct placeholder labels aligned under their headings', () => {
    const {widget} = loadUi();
    const [, values] = parts(widget).prices.children;
    assert.deepEqual(values.children, [widget._buyPrice, widget._sellPrice]);
    assert.notEqual(widget._buyPrice, widget._sellPrice);
    for (const label of values.children) {
        assert.equal(label.text, '—');
        assert.equal(label.style_class, 'sjc-price');
        assert.equal(label.clutter_text.ellipsize, 'none');
    }
    assert.equal(widget._buyPrice.x_expand, true);
    assert.equal(widget._sellPrice.x_align, 'end');
    assert.equal(widget._buyPrice.clutter_text.alignment, 'left');
    assert.equal(widget._sellPrice.clutter_text.alignment, 'right');
});

test('footer preserves caption ordering and returns the attached value labels', () => {
    const {widget} = loadUi();
    const {footer} = parts(widget);
    assert.equal(footer.children.length, 5);
    const captions = [
        'Chênh lệch bán - mua:',
        'Giá quốc tế quy đổi (chưa thuế phí):',
        'Chênh lệch giá bán SJC - giá quốc tế:',
    ];
    const values = [widget._spreadValue, widget._internationalValue, widget._premiumValue];
    assert.equal(new Set(values).size, 3);
    for (const [index, caption] of captions.entries()) {
        const row = footer.children[index];
        assert.equal(row.style_class, 'sjc-footer-row');
        assert.equal(row.x_expand, true);
        assert.equal(row.children.length, 2);
        const [label, value] = row.children;
        assert.equal(label.text, caption);
        assert.equal(label.style_class, 'sjc-footer-text');
        assert.equal(label.x_expand, true);
        assert.equal(value, values[index]);
        assert.equal(value.text, '—');
        assert.equal(value.style_class, 'sjc-footer-text');
        assert.equal(value.x_align, 'end');
    }
});

test('footer spacer separates conversion values from the market row', () => {
    const {widget, Widget, BoxLayout} = loadUi();
    const {footer} = parts(widget);
    const [, , , spacer, market] = footer.children;
    assert.ok(spacer instanceof Widget);
    assert.equal(spacer.height, 3);
    assert.equal(spacer.children.length, 0);
    assert.ok(market instanceof BoxLayout);
    assert.equal(market.style_class, 'sjc-footer-row sjc-market-row');
    assert.equal(market.x_expand, true);
});

test('market references point to visible spot and currency placeholders', () => {
    const {widget} = loadUi();
    const market = parts(widget).footer.children[4];
    assert.deepEqual(market.children, [widget._spotValue, widget._usdValue]);
    assert.equal(widget._spotValue.text, 'XAU/USD: —');
    assert.equal(widget._usdValue.text, 'USD/VND: —');
    for (const label of market.children)
        assert.equal(label.style_class, 'sjc-footer-text');
    assert.equal(widget._spotValue.x_expand, true);
    assert.equal(widget._usdValue.x_align, 'end');
});

test('error reference is attached but hidden and empty before any refresh', () => {
    const {widget} = loadUi();
    const {error} = parts(widget);
    assert.equal(error, widget._errorText);
    assert.equal(error.visible, false);
    assert.equal(error.text, '');
    assert.equal(error.style_class, 'sjc-error-text');
});

test('makeFooterRow appends without replacing existing children and returns its value', () => {
    const {widget, Actor, Label, BoxLayout} = loadUi();
    const parent = new Actor();
    const existing = new Actor();
    parent.add_child(existing);
    const value = widget._makeFooterRow(parent, 'custom caption');
    assert.equal(parent.children.length, 2);
    assert.equal(parent.children[0], existing);
    const row = parent.children[1];
    assert.ok(row instanceof BoxLayout);
    assert.equal(row.children.length, 2);
    assert.equal(row.children[0].text, 'custom caption');
    assert.equal(row.children[1], value);
    assert.ok(value instanceof Label);
    assert.equal(value.text, '—');
    assert.equal(value.x_align, 'end');
});

test('separate widget builds do not share actors or label references', () => {
    const first = loadUi().widget;
    const second = loadUi().widget;
    for (const key of [
        '_productName', '_updated', '_buyPrice', '_sellPrice', '_spreadValue',
        '_internationalValue', '_premiumValue', '_spotValue', '_usdValue', '_errorText',
    ]) {
        assert.notEqual(first[key], second[key]);
    }
    first._buyPrice.text = 'changed';
    assert.equal(second._buyPrice.text, '—');
    assert.notEqual(first.children[0], second.children[0]);
});
