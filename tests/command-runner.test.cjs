const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../extension.js');
const source = readFileSync(filename, 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replace('export default class SjcGoldExtension', 'class SjcGoldExtension');

function fixture() {
    const processes = [];
    const timers = new Map();
    const removed = [];
    let nextTimer = 1;
    let spawnError;

    class Cancellable {
        cancellations = 0;

        cancel() {
            ++this.cancellations;
        }
    }

    class Subprocess {
        constructor(argv, flags) {
            this.argv = argv;
            this.flags = flags;
            this.exits = 0;
            this.successful = true;
            this.promise = new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }

        static new(argv, flags) {
            if (spawnError)
                throw spawnError;
            const proc = new Subprocess(argv, flags);
            processes.push(proc);
            return proc;
        }

        communicate_utf8_async(input, cancellable) {
            this.input = input;
            this.cancellable = cancellable;
            return this.promise;
        }

        force_exit() {
            ++this.exits;
        }

        get_successful() {
            return this.successful;
        }
    }

    const context = vm.createContext({
        Gio: {
            Cancellable,
            Subprocess,
            SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
            _promisify(prototype, method) {
                assert.equal(prototype, Subprocess.prototype);
                assert.equal(method, 'communicate_utf8_async');
            },
        },
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add(priority, delay, callback) {
                const id = nextTimer++;
                timers.set(id, {priority, delay, callback});
                return id;
            },
            source_remove(id) {
                assert.ok(timers.delete(id), `Timer ${id} must exist`);
                removed.push(id);
            },
        },
        GObject: {registerClass: klass => klass},
        St: {Widget: class {}},
        Extension: class {},
    });
    vm.runInContext(source, context, {filename});
    const Runner = vm.runInContext('SafeCommandRunner', context);
    const limit = vm.runInContext('MAX_OUTPUT_CHARS', context);

    return {
        runner: new Runner(),
        processes,
        timers,
        removed,
        limit,
        failSpawn(error) {
            spawnError = error;
        },
        fireTimeout() {
            assert.equal(timers.size, 1);
            const [id, timer] = timers.entries().next().value;
            timers.delete(id);
            assert.equal(timer.priority, 0);
            assert.equal(timer.delay, 35000);
            assert.equal(timer.callback(), false);
        },
    };
}

function assertIdle(f) {
    assert.equal(f.runner.running, false);
    assert.equal(f.runner._cancellable, null);
    assert.equal(f.runner._timeoutId, 0);
    assert.equal(f.timers.size, 0);
}

test('run forwards argv and pipe flags, returns output, and removes its timer', async () => {
    const f = fixture();
    assertIdle(f);
    const argv = ['python3', '-B', '/extension/sjc_price.py'];
    const pending = f.runner.run(argv);
    const proc = f.processes[0];
    assert.equal(f.runner.running, true);
    assert.equal(proc.argv, argv);
    assert.equal(proc.flags, 3);
    assert.equal(proc.input, null);
    assert.equal(proc.cancellable, f.runner._cancellable);
    proc.resolve(['{"buy":1}', 'warning']);
    const result = await pending;
    assert.equal(result.stdout, '{"buy":1}');
    assert.equal(result.stderr, 'warning');
    assert.equal(result.successful, true);
    assert.equal(proc.exits, 0);
    assert.deepEqual(f.removed, [1]);
    assertIdle(f);
});

test('unsuccessful processes return their status and normalize null output', async () => {
    const f = fixture();
    const pending = f.runner.run([]);
    f.processes[0].successful = false;
    f.processes[0].resolve([null, undefined]);
    const result = await pending;
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(result.successful, false);
    assertIdle(f);
});

for (const stream of [0, 1]) {
    test(`stream ${stream} accepts exactly the output limit`, async () => {
        const f = fixture();
        const pending = f.runner.run([]);
        const output = ['', ''];
        output[stream] = 'x'.repeat(f.limit);
        f.processes[0].resolve(output);
        const result = await pending;
        assert.equal((stream === 0 ? result.stdout : result.stderr).length, f.limit);
        assertIdle(f);
    });

    test(`stream ${stream} rejects output exceeding the limit`, async () => {
        const f = fixture();
        const pending = f.runner.run([]);
        const rejected = assert.rejects(pending, /Output/);
        const output = ['', ''];
        output[stream] = 'x'.repeat(f.limit + 1);
        f.processes[0].resolve(output);
        await rejected;
        assertIdle(f);
    });
}

test('communication failure preserves the original error and cleans up', async () => {
    const f = fixture();
    const pending = f.runner.run([]);
    const error = new Error('pipe failed');
    const rejected = assert.rejects(pending, actual => actual === error);
    f.processes[0].reject(error);
    await rejected;
    assertIdle(f);
});

test('spawn failure leaves no process or timer', async () => {
    const f = fixture();
    const error = new Error('python missing');
    f.failSpawn(error);
    await assert.rejects(f.runner.run([]), actual => actual === error);
    assert.equal(f.processes.length, 0);
    assertIdle(f);
});

for (const outcome of ['resolve', 'reject']) {
    test(`timeout cancels and kills the process when communication will ${outcome}`, async () => {
        const f = fixture();
        const pending = f.runner.run([]);
        const rejected = assert.rejects(pending, /35/);
        const proc = f.processes[0];
        f.fireTimeout();
        assert.equal(proc.cancellable.cancellations, 1);
        assert.equal(proc.exits, 1);
        if (outcome === 'resolve')
            proc.resolve(['late output', '']);
        else
            proc.reject(new Error('cancelled I/O'));
        await rejected;
        assert.deepEqual(f.removed, []);
        assertIdle(f);
    });
}

test('cancel clears resources and rejects a late successful response', async () => {
    const f = fixture();
    const pending = f.runner.run([]);
    const rejected = assert.rejects(pending, /__SJC_CANCELLED__/);
    const proc = f.processes[0];
    f.runner.cancel();
    assert.equal(proc.cancellable.cancellations, 1);
    assert.equal(proc.exits, 1);
    assertIdle(f);
    f.runner.cancel();
    assert.equal(proc.exits, 1);
    assert.equal(proc.cancellable.cancellations, 1);
    proc.resolve(['stale', '']);
    await rejected;
    assertIdle(f);
});

for (const outcome of ['resolve', 'reject']) {
    test(`replacement run survives stale ${outcome} cleanup`, async () => {
        const f = fixture();
        const old = f.runner.run(['old']);
        const oldRejected = assert.rejects(
            old, outcome === 'resolve' ? /__SJC_CANCELLED__/ : /old I\/O/);
        const oldProc = f.processes[0];
        const current = f.runner.run(['new']);
        const proc = f.processes[1];
        assert.equal(oldProc.exits, 1);
        assert.equal(oldProc.cancellable.cancellations, 1);
        assert.equal(f.timers.has(1), false);
        assert.equal(proc.exits, 0);
        assert.equal(proc.cancellable.cancellations, 0);
        if (outcome === 'resolve')
            oldProc.resolve(['stale', '']);
        else
            oldProc.reject(new Error('old I/O'));
        await oldRejected;
        assert.equal(f.runner._proc, proc);
        assert.equal(f.runner._cancellable, proc.cancellable);
        assert.equal(f.runner.running, true);
        assert.equal(f.timers.size, 1);
        proc.resolve(['fresh', '']);
        assert.equal((await current).stdout, 'fresh');
        assert.deepEqual(f.removed, [1, 2]);
        assertIdle(f);
    });
}

test('destroy cancels pending work, is idempotent, and prevents future runs', async () => {
    const f = fixture();
    const pending = f.runner.run([]);
    const rejected = assert.rejects(pending, /__SJC_CANCELLED__/);
    const proc = f.processes[0];
    f.runner.destroy();
    f.runner.destroy();
    assert.equal(proc.exits, 1);
    assert.equal(proc.cancellable.cancellations, 1);
    assertIdle(f);
    proc.resolve(['late', '']);
    await rejected;
    await assert.rejects(f.runner.run([]));
    assert.equal(f.processes.length, 1);
    assertIdle(f);
});

test('runner can be reused after a completed process', async () => {
    const f = fixture();
    for (const value of ['first', 'second']) {
        const pending = f.runner.run([value]);
        f.processes.at(-1).resolve([value, '']);
        assert.equal((await pending).stdout, value);
        assertIdle(f);
    }
    assert.equal(f.processes.length, 2);
    assert.deepEqual(f.removed, [1, 2]);
});
