// Defender 2025 — Scriptable / iPhone home screen, medium widget.
// Vehicle values are MANUAL, never fetched from Remote.
// Run inside Scriptable to edit. Tap widget to run your "Remoteを開く" shortcut.

const KEY = "defender2025.manual.v1";
const MAX_AGE_MS = 60 * 60 * 1000;

function photoPath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.libraryDirectory(), "defender2025-background.png");
}

function loadPhoto() {
  try {
    const fm = FileManager.local();
    return fm.fileExists(photoPath()) ? fm.readImage(photoPath()) : null;
  } catch (_) { return null; }
}

function removePhoto() {
  const fm = FileManager.local();
  if (fm.fileExists(photoPath())) fm.remove(photoPath());
}

async function editPhoto() {
  const a = new Alert(); a.title = "ディフェンダーの画像";
  a.message = "写真を背景に表示します。車全体が中央に写った横長の写真がおすすめです。";
  a.addAction("写真から選ぶ"); a.addDestructiveAction("画像を外す"); a.addCancelAction("キャンセル");
  const action = await a.presentSheet();
  if (action === 1) { removePhoto(); return; }
  if (action !== 0) return;
  try {
    const image = await Photos.fromLibrary();
    if (!image) return;
    // Save only a widget-sized copy to keep widget memory usage small.
    const width = 720, height = 336;
    const scale = Math.max(width / image.size.width, height / image.size.height);
    const dw = image.size.width * scale, dh = image.size.height * scale;
    const draw = new DrawContext(); draw.size = new Size(width, height);
    draw.respectScreenScale = false; draw.opaque = true;
    draw.drawImageInRect(image, new Rect((width - dw) / 2, (height - dh) / 2, dw, dh));
    FileManager.local().writeImage(photoPath(), draw.getImage());
  } catch (_) {
    await notice("画像は変更していません", "写真の選択がキャンセルされたか、読み込めませんでした。必要ならiPhoneの設定でScriptableの写真へのアクセスを確認してください。");
  }
}

function photoBackground(image) {
  const draw = new DrawContext(); draw.size = new Size(720, 336);
  draw.respectScreenScale = false; draw.opaque = true;
  draw.drawImageInRect(image, new Rect(0, 0, 720, 336));
  // Darken the chosen photo so all vehicle readings remain legible.
  draw.setFillColor(new Color("08130D", 0.60));
  draw.fillRect(new Rect(0, 0, 720, 336));
  return draw.getImage();
}

function blank() {
  return { version: 1, plate: "", fuel: null, range: null, odometer: null,
    lock: "unknown", confirmedAt: null, shortcut: "Remoteを開く" };
}

function numberInput(value, maximum) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;
  // Do not interpret empty, malformed, or negative values as zero.
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("数値は半角の数字で入力してください。");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > maximum) throw new Error("数値が範囲外です。");
  return n;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function clean(raw) {
  const d = blank();
  if (!raw || raw.version !== 1) return d;
  d.plate = typeof raw.plate === "string" ? raw.plate.slice(0, 40) : "";
  d.shortcut = typeof raw.shortcut === "string" && raw.shortcut.trim()
    ? raw.shortcut.trim().slice(0, 80) : d.shortcut;
  for (const [key, max] of [["fuel", 100], ["range", 10000], ["odometer", 10000000]]) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key]) && raw[key] >= 0 && raw[key] <= max) d[key] = raw[key];
  }
  d.lock = ["locked", "unlocked", "unknown"].includes(raw.lock) ? raw.lock : "unknown";
  d.confirmedAt = validDate(raw.confirmedAt) ? raw.confirmedAt : null;
  return d;
}

function ageState(d, now = Date.now()) {
  if (!d.confirmedAt) return "missing";
  const age = now - Date.parse(d.confirmedAt);
  return age < -60000 || age >= MAX_AGE_MS ? "old" : "recent";
}

function lockText(d, now = Date.now()) {
  if (d.lock === "unknown" || ageState(d, now) === "missing") return "不明";
  const label = d.lock === "locked" ? "施錠" : "解錠";
  return ageState(d, now) === "old" ? label + "（過去）" : label + "（確認時）";
}

function formatted(n) {
  return n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function readData() {
  try {
    return Keychain.contains(KEY) ? clean(JSON.parse(Keychain.get(KEY))) : blank();
  } catch (_) {
    return blank();
  }
}

function saveData(d) { Keychain.set(KEY, JSON.stringify(d)); }

async function notice(title, message) {
  const a = new Alert(); a.title = title; a.message = message;
  a.addAction("OK"); await a.presentAlert();
}

async function editReadings(d) {
  const a = new Alert();
  a.title = "車両情報を手入力";
  a.message = "Remoteで確認した値を入力してください。空欄は未取得です。保存時刻を最終確認として記録します。";
  for (const [key, title] of [["fuel", "燃料残量（0〜100 %）"], ["range", "航続距離（km）"], ["odometer", "オドメーター（km）"]]) {
    const field = a.addTextField(title, d[key] === null ? "" : String(d[key]));
    field.setDecimalPadKeyboard();
  }
  a.addAction("次へ"); a.addCancelAction("キャンセル");
  if (await a.presentAlert() < 0) return d;
  let next;
  try {
    next = { ...d, fuel: numberInput(a.textFieldValue(0), 100),
      range: numberInput(a.textFieldValue(1), 10000),
      odometer: numberInput(a.textFieldValue(2), 10000000) };
  } catch (e) { await notice("入力を確認", e.message); return d; }
  const l = new Alert(); l.title = "確認したロック状態";
  l.message = "今Remoteで確認した状態を選んでください。確認していない場合は「不明」を選びます。";
  l.addAction("施錠を確認"); l.addAction("解錠を確認"); l.addAction("不明／未確認"); l.addCancelAction("キャンセル");
  const result = await l.presentAlert();
  if (result < 0) return d;
  next.lock = ["locked", "unlocked", "unknown"][result];
  next.confirmedAt = new Date().toISOString();
  saveData(next); return next;
}

async function editSettings(d) {
  const a = new Alert(); a.title = "表示設定";
  a.message = "ナンバーはこのiPhone上で設定します。ショートカットには「Appを開く → Remote」を設定してください。";
  a.addTextField("ナンバー（任意）", d.plate);
  a.addTextField("ショートカット名", d.shortcut);
  a.addAction("保存"); a.addCancelAction("キャンセル");
  if (await a.presentAlert() < 0) return d;
  const next = { ...d, plate: a.textFieldValue(0).trim().slice(0, 40),
    shortcut: a.textFieldValue(1).trim().slice(0, 80) || "Remoteを開く" };
  saveData(next); return next;
}

async function menu(d) {
  const a = new Alert(); a.title = "DEFENDER 2025";
  a.message = "手入力版です。Remoteとの自動連携はありません。";
  a.addAction("車両情報を入力・更新"); a.addAction("ナンバー・起動設定");
  a.addAction("ウィジェットをプレビュー"); a.addAction("ディフェンダーの画像を設定");
  a.addDestructiveAction("保存データを削除");
  a.addCancelAction("閉じる");
  const index = await a.presentSheet();
  if (index === 0) return await editReadings(d);
  if (index === 1) return await editSettings(d);
  if (index === 3) {
    await editPhoto(); return d;
  }
  if (index === 4) {
    const confirm = new Alert(); confirm.title = "保存データを削除しますか？";
    confirm.message = "車両情報・ナンバー・起動設定・ウィジェット用の画像を削除します。写真アプリの元画像は残ります。";
    confirm.addDestructiveAction("削除"); confirm.addCancelAction("キャンセル");
    if (await confirm.presentAlert() === 0) {
      if (Keychain.contains(KEY)) Keychain.remove(KEY);
      removePhoto();
      return blank();
    }
  }
  return d;
}

function textIn(parent, value, size, color, bold = false) {
  const t = parent.addText(value); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = new Color(color); t.lineLimit = 1; t.minimumScaleFactor = 0.65;
  return t;
}

function cell(row, label, value, unit, color = "F3F5EF") {
  const c = row.addStack(); c.layoutVertically(); c.size = new Size(124, 0);
  textIn(c, label, 10, "A9B4A8"); c.addSpacer(2);
  const v = c.addStack(); v.centerAlignContent();
  textIn(v, value, 19, color, true);
  if (unit) { v.addSpacer(3); textIn(v, unit, 10, "BBC5B8"); }
}

function buildWidget(d) {
  const w = new ListWidget();
  const bg = new LinearGradient(); bg.colors = [new Color("263B32"), new Color("101B17")];
  bg.locations = [0, 1]; w.backgroundGradient = bg; w.setPadding(12, 14, 10, 14);
  const photo = loadPhoto();
  if (photo) w.backgroundImage = photoBackground(photo);
  w.url = "shortcuts://run-shortcut?name=" + encodeURIComponent(d.shortcut);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const top = w.addStack(); top.centerAlignContent();
  textIn(top, "DEFENDER", 15, "F3F5EF", true); top.addSpacer(7);
  textIn(top, "2025", 10, "A9B4A8"); top.addSpacer();
  textIn(top, "手入力", 9, "DEC991");
  textIn(w, d.plate || "ナンバー未設定", 10, "C8D0C4"); w.addSpacer(7);
  let row = w.addStack(); row.addSpacer();
  cell(row, "燃料残量", formatted(d.fuel), "%");
  cell(row, "航続距離", formatted(d.range), "km"); row.addSpacer();
  w.addSpacer(5); row = w.addStack(); row.addSpacer();
  cell(row, "オドメーター", formatted(d.odometer), "km");
  cell(row, "ロック・最終確認", lockText(d), "", "DEC991"); row.addSpacer();
  w.addSpacer();
  const foot = w.addStack(); foot.centerAlignContent();
  let stamp = "未入力：Scriptableで設定";
  if (d.confirmedAt) {
    const df = new DateFormatter(); df.locale = "ja_JP"; df.dateFormat = "M/d HH:mm";
    stamp = "確認 " + df.string(new Date(d.confirmedAt));
    if (ageState(d) === "old") stamp += "・古い情報";
  }
  textIn(foot, stamp, 9, "A9B4A8"); foot.addSpacer();
  textIn(foot, "Remoteを開く ↗", 10, "E4EADC", true);
  return w;
}

async function main() {
  let d = readData();
  if (!config.runsInWidget) d = await menu(d);
  const w = buildWidget(d); Script.setWidget(w);
  if (!config.runsInWidget) await w.presentMedium();
  Script.complete();
}

await main();
