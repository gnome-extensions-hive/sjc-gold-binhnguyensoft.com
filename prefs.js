/*
 * Widget giá vàng SJC
 *
 * Copyright (C) 2026 Binh Nguyen (binhnguyensoft.com)
 *
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SjcGoldPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(600, -1);
        this._settings = this.getSettings();

        const page = new Adw.PreferencesPage();

        // Vị trí
        const positionGroup = new Adw.PreferencesGroup({
            title: 'Vị trí',
            description: 'Thay đổi vị trí xuất hiện của widget.'
        });

        // Trái
        const leftKey = this._settings.settings_schema.get_key('left');
        
        const left = new Gtk.Adjustment({
            lower: 0,
            upper: 10000,
            step_increment: 5
        });

        const leftRow = new Adw.SpinRow({
            title: leftKey.get_summary(),
            subtitle: leftKey.get_description(),
            adjustment: left,
            digits: 0,
            numeric: true,
            snap_to_ticks: true
        });

        this._settings.bind('left', left, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Trên
        const topKey = this._settings.settings_schema.get_key('top');
        
        const top = new Gtk.Adjustment({
            lower: 0,
            upper: 10000,
            step_increment: 5
        });

        const topRow = new Adw.SpinRow({
            title: topKey.get_summary(),
            subtitle: topKey.get_description(),
            adjustment: top,
            digits: 0,
            numeric: true,
            snap_to_ticks: true
        });

        this._settings.bind('top', top, 'value', Gio.SettingsBindFlags.DEFAULT);
        
        // Chu kỳ cập nhật
        const durationGroup = new Adw.PreferencesGroup({
            title: 'Cập nhật',
            description: 'Thay đổi chu kỳ cập nhật giá.',
        });
        
        const durationKey = this._settings.settings_schema.get_key('duration');

        const duration = new Gtk.Adjustment({
            lower: 5,
            upper: 300,
            step_increment: 5,
            value: this._settings.get_int('duration'),
        });

        const durationRow = new Adw.SpinRow({
            title: durationKey.get_summary(),
            subtitle: durationKey.get_description(),
            adjustment: duration,
            digits: 0,
            numeric: true,
            snap_to_ticks: true,
        });

        durationRow.connect('notify::value', row => {
            this._settings.set_int('duration', row.get_value_as_int());
        });

        positionGroup.add(leftRow);
        positionGroup.add(topRow);
        durationGroup.add(durationRow);
        page.add(positionGroup);
        page.add(durationGroup);
        window.add(page);
        
        // About
        const aboutGroup = new Adw.PreferencesGroup();
        const aboutRow = new Adw.ActionRow({title: 'Giới thiệu', activatable: true});
        aboutRow.add_suffix(new Gtk.Image({icon_name: 'help-about-symbolic'}));
        aboutRow.connect('activated', () => this._showAbout(window));
        aboutGroup.add(aboutRow);
        page.add(aboutGroup);

    }

    _showAbout(window) {
        const about = new Adw.AboutWindow({
            application_name: this.metadata.name,
            developer_name: 'Bình Nguyễn',
            version: this.metadata['version-name'],
            website: 'https://www.binhnguyensoft.com',
            issue_url: `${this.metadata.url.replace(/\/+$/, '')}/issues`,
            issue_url: `${this.metadata.url}/issues`,
            transient_for: window,
            modal: true,
        });
        about.present();
    }

}
