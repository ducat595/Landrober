const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'scriptable', 'Defender.js'), 'utf8');
// Scriptable permits top-level await; wrapping gives Node the same async context.
new vm.Script('(async () => {\n' + source + '\n})()');
const ctx = vm.createContext({});
vm.runInContext(source.replace(/await main\(\);\s*$/, ''), ctx);
function run(s) { return vm.runInContext(s, ctx); }
assert.equal(run('numberInput("", 100)'), null);
assert.equal(run('numberInput("0", 100)'), 0);
assert.equal(run('numberInput("78.5", 100)'), 78.5);
for (const v of ['-1', '101', 'NaN', '1e2', '12km', '1,234']) {
  assert.throws(() => run(`numberInput(${JSON.stringify(v)}, 100)`));
}
assert.equal(run('clean({version:1, fuel:"0"}).fuel'), null);
assert.equal(run('clean({version:1, fuel:0}).fuel'), 0);
assert.equal(run('clean({version:1, fuel:101}).fuel'), null);
assert.equal(run('clean({version:1, lock:"something"}).lock'), 'unknown');
assert.equal(run('lockText(blank())'), '不明');
assert.equal(run('lockText({...blank(),lock:"locked",confirmedAt:"2026-10-22T12:00:00Z"}, Date.parse("2026-10-22T12:59:00Z"))'), '施錠（確認時）');
assert.equal(run('lockText({...blank(),lock:"locked",confirmedAt:"2026-10-22T12:00:00Z"}, Date.parse("2026-10-22T13:00:00Z"))'), '施錠（過去）');
assert.equal(run('lockText({...blank(),lock:"unlocked",confirmedAt:"2026-10-22T12:00:00Z"}, Date.parse("2026-10-22T13:00:00Z"))'), '解錠（過去）');
assert.equal(run('ageState({...blank(),confirmedAt:"2026-10-22T14:00:00Z"}, Date.parse("2026-10-22T13:00:00Z"))'), 'old');
assert.equal(run('clean({version:1,confirmedAt:"bad"}).confirmedAt'), null);

// Exercise rendering and the edit/save/cancel flows with only documented APIs.
const store = new Map();
const queue = [];
const texts = [];
const images = new Map();
const drawOps = [];
class Stack {
  addStack() { return new Stack(); }
  addText(t) { texts.push(t); return {}; }
  addSpacer() {} layoutVertically() {} centerAlignContent() {} setPadding() {}
  async presentMedium() {}
}
class Alert {
  constructor() { this.values = []; }
  addTextField(_, value) { this.values.push(value); return { setDecimalPadKeyboard() {} }; }
  textFieldValue(i) { return this.values[i]; }
  addAction() {} addCancelAction() {} addDestructiveAction() {}
  async presentAlert() {
    const response = queue.shift();
    assert.ok(response, 'Unexpected alert');
    if (response.values) this.values = response.values;
    return response.result;
  }
  async presentSheet() { return this.presentAlert(); }
}
Object.assign(ctx, {
  Alert, ListWidget: Stack, LinearGradient: class {}, Color: class {}, Size: class {},
  Font: { systemFont() {}, boldSystemFont() {} },
  DateFormatter: class { string() { return '10/22 12:00'; } },
  Keychain: { contains: k => store.has(k), get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
  config: { runsInWidget: true }, Script: { setWidget() {}, complete() {} }
});
Object.assign(ctx, {
  FileManager: { local: () => ({
    libraryDirectory: () => '/local', joinPath: (a,b) => a + '/' + b,
    fileExists: p => images.has(p), readImage: p => images.get(p),
    writeImage: (p,i) => images.set(p,i), remove: p => images.delete(p)
  }) },
  Photos: { fromLibrary: async () => ({size: {width: 1200, height: 900}}) },
  Size: class { constructor(width,height) { this.width = width; this.height = height; } },
  Rect: class { constructor(x,y,width,height) { Object.assign(this,{x,y,width,height}); } },
  DrawContext: class {
    drawImageInRect(image,rect) { drawOps.push(rect); }
    setFillColor() {} fillRect() {}
    getImage() { return {size: this.size}; }
  }
});
(async () => {
  await run('main()');
  assert.ok(texts.includes('手入力'));
  assert.ok(texts.includes('不明'));
  assert.ok(!texts.includes('施錠（確認時）'));
  const widget = run('buildWidget(blank())');
  assert.equal(widget.url, 'shortcuts://run-shortcut?name=' + encodeURIComponent('Remoteを開く'));
  queue.push({result: 0, values: ['0', '640', '12345.6']}, {result: 0});
  const saved = await run('editReadings(blank())');
  assert.equal(saved.fuel, 0); assert.equal(saved.range, 640);
  assert.equal(saved.odometer, 12345.6); assert.equal(saved.lock, 'locked');
  assert.ok(saved.confirmedAt); assert.equal(store.size, 1);
  const before = [...store.values()][0];
  queue.push({result: 0, values: ['80', '600', '12400']}, {result: -1});
  await run('editReadings(readData())');
  assert.equal([...store.values()][0], before, 'Cancellation must not change readings or timestamp');
  queue.push({result: 0, values: ['101', '600', '12400']}, {result: 0});
  await run('editReadings(readData())');
  assert.equal([...store.values()][0], before, 'Invalid readings must not be stored');
  queue.push({result: 0, values: ['品川 300 あ 12-34', 'Remoteを開く']});
  const settings = await run('editSettings(readData())');
  assert.equal(settings.plate, '品川 300 あ 12-34');
  assert.equal(settings.confirmedAt, saved.confirmedAt, 'Settings must not make old readings look fresh');
  const beforePhoto = [...store.values()][0];
  queue.push({result: 0});
  await run('editPhoto()');
  assert.equal(images.size, 1);
  assert.equal(drawOps[0].width, 720);
  assert.equal(drawOps[0].height, 540);
  assert.equal(drawOps[0].y, -102, 'Photo must be center-cropped');
  assert.ok(run('buildWidget(readData())').backgroundImage);
  assert.equal([...store.values()][0], beforePhoto, 'Photo must not change readings or timestamp');
  queue.push({result: -1});
  await run('editPhoto()');
  assert.equal(images.size, 1, 'Cancel must keep the photo');
  queue.push({result: 1});
  await run('editPhoto()');
  assert.equal(images.size, 0);
  assert.equal(run('buildWidget(readData())').backgroundImage, undefined);
  assert.equal(queue.length, 0);
  console.log('PASS: syntax, numeric validation, stale lock state, widget rendering, manual save/cancel, photo crop/save/cancel/remove, and unchanged confirmation timestamps.');
})().catch(e => { console.error(e); process.exitCode = 1; });
