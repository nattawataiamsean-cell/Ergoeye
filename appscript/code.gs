/**
 * ErgoEye → Google Sheet + LINE แจ้งเตือน (เวอร์ชัน 3: แยกแท็บ RULA และ REBA)
 *
 * วิธีใช้: วางทับโค้ดเดิมทั้งหมดใน Apps Script → Ctrl+S
 * → เลือกฟังก์ชัน setupSheets แล้วกดเรียกใช้ 1 ครั้ง (สร้างและจัดรูปแบบแท็บ RULA และ REBA)
 * → การทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ดินสอ → เวอร์ชันใหม่ → ทำให้ใช้งานได้
 *
 * Script Properties ที่ต้องมี (สำหรับ LINE):
 *   LINE_CHANNEL_ACCESS_TOKEN = โทเคนจาก LINE Developers (Messaging API)
 *   LINE_TO                   = userId หรือ groupId ที่จะรับแจ้งเตือน
 *
 * รูปที่แอปส่งมา (field image) เก็บในโฟลเดอร์ Google Drive "ErgoEye รูปประเมิน"
 * ลิงก์อยู่คอลัมน์สุดท้ายของชีต และแนบไปกับข้อความ LINE
 */

const RULA_SHEET = 'RULA';
const REBA_SHEET = 'REBA';
const LINE_ALERT_LEVEL = 3;       // RULA: แจ้ง LINE เมื่อระดับการแก้ไขตั้งแต่ 3 (RULA 5 ขึ้นไป)
const REBA_LINE_ALERT_SCORE = 8;  // REBA: แจ้ง LINE เมื่อคะแนนตั้งแต่ 8 (ความเสี่ยงสูงขึ้นไป)
const IMAGE_FOLDER = 'ErgoEye รูปประเมิน';

// ---------- RULA (คอลัมน์และข้อความเหมือนเวอร์ชันเดิม) ----------
const LEVEL_TEXT = {
  1: '1 – ยอมรับได้',
  2: '2 – ควรศึกษาเพิ่มเติม',
  3: '3 – ควรปรับปรุงเร็ว ๆ นี้',
  4: '4 – ต้องปรับปรุงทันที'
};

const HEADERS = ['เวลา', 'จุดงาน', 'งาน', 'ผู้ประเมิน', 'คะแนน RULA', 'ระดับการแก้ไข', 'แขนที่ประเมิน',
  'ต้นแขน', 'ปลายแขน', 'ข้อมือ', 'คอ', 'ลำตัว', 'ขา', 'คะแนน C', 'คะแนน D',
  'มุมต้นแขน (°)', 'มุมศอก (°)', 'มุมข้อมือ (°)', 'มุมคอ (°)', 'มุมลำตัว (°)', 'น้ำหนัก/แรง', 'ค้างท่า/ทำซ้ำ', 'รูป'];

const LOAD_TEXT = {
  0: '< 2 กก. เป็นครั้งคราว',
  1: '2-10 กก. เป็นครั้งคราว',
  2: '2-10 กก. ค้าง/ทำซ้ำ',
  3: '> 10 กก. หรือมีแรงกระแทก'
};

// ---------- REBA ----------
// ระดับความเสี่ยงใช้ขีดธรรมดา (-) เท่านั้น
const REBA_LEVEL_TEXT = {
  1: '1 - ต่ำมาก ไม่ต้องแก้ไข',
  2: '2 - ต่ำ อาจต้องแก้ไข',
  3: '3 - ปานกลาง ควรแก้ไข',
  4: '4 - สูง ต้องแก้ไขโดยเร็ว',
  5: '5 - สูงมาก ต้องแก้ไขทันที'
};

const REBA_HEADERS = ['เวลา', 'จุดงาน', 'งาน', 'ผู้ประเมิน', 'คะแนน REBA', 'ระดับความเสี่ยง', 'แขนที่ประเมิน',
  'ลำตัว', 'คอ', 'ขา', 'ต้นแขน', 'ปลายแขน', 'ข้อมือ', 'คะแนน A', 'คะแนน B', 'คะแนน Table C',
  'มุมลำตัว (°, ติดลบ = แอ่นหลัง)', 'มุมคอ (°, ติดลบ = เงยหน้า)', 'มุมเข่า (°)', 'มุมต้นแขน (°)', 'มุมศอก (°)',
  'น้ำหนัก/แรง', 'การจับ', 'กิจกรรม', 'รูป'];

const REBA_LOAD_TEXT = {
  0: '< 5 กก.',
  1: '5-10 กก.',
  2: '> 10 กก.'
};

const COUPLING_TEXT = {
  0: 'ดี',
  1: 'พอใช้',
  2: 'ไม่ดี',
  3: 'ยอมรับไม่ได้'
};

/** รับข้อมูลจาก ErgoEye: method เป็น REBA ลงแท็บ REBA นอกนั้น (รวมถึงไม่มี method) ลงแท็บ RULA */
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const method = String(d.method || 'RULA').toUpperCase() === 'REBA' ? 'REBA' : 'RULA';

  const img = saveImage_(d, method);
  const imgCell = img ? '=HYPERLINK("' + img.url + '","ดูรูป")' : '';

  if (method === 'REBA') {
    getSheet_(REBA_SHEET, REBA_HEADERS).appendRow(rebaRow_(d).concat([imgCell]));
    if (Number(d.final) >= REBA_LINE_ALERT_SCORE) pushLine_(rebaMessage_(d), img);
  } else {
    getSheet_(RULA_SHEET, HEADERS).appendRow(rulaRow_(d).concat([imgCell]));
    if (d.level >= LINE_ALERT_LEVEL) pushLine_(rulaMessage_(d), img);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, method: method }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * เก็บรูปจากแอป (data URL แบบ base64) ลง Google Drive
 * คืน { url: ลิงก์เปิดดูใน Drive, direct: ลิงก์ไฟล์รูปตรงสำหรับ LINE, shared } หรือ null ถ้าไม่มีรูป
 */
function saveImage_(d, method) {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(d.image || ''));
  if (!m) return null;
  try {
    const when = Utilities.formatDate(new Date(d.time || Date.now()), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const station = String(d.station || '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
    const name = method + '_' + when + (station ? '_' + station : '') + (m[1] === 'image/png' ? '.png' : '.jpg');
    const file = imageFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name));
    let shared = true;
    // LINE ต้องเปิดรูปได้โดยไม่ล็อกอิน จึงแชร์แบบทุกคนที่มีลิงก์ดูได้ (บางองค์กรปิดสิทธิ์นี้ไว้)
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { shared = false; }
    return { url: file.getUrl(), direct: 'https://lh3.googleusercontent.com/d/' + file.getId(), shared: shared };
  } catch (err) {
    console.error('บันทึกรูปไม่สำเร็จ: ' + err);
    return null;
  }
}

/** โฟลเดอร์เก็บรูป สร้างครั้งแรกแล้วจำ id ไว้ใน Script Properties */
function imageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IMAGE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* โฟลเดอร์ถูกลบ สร้างใหม่ */ }
  }
  const folder = DriveApp.createFolder(IMAGE_FOLDER);
  props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

/** แถว RULA: ลำดับคอลัมน์เหมือนเวอร์ชันเดิม */
function rulaRow_(d) {
  const p = d.parts || {}, a = d.angles || {};
  return [
    new Date(d.time), d.station, d.task, d.assessor,
    d.final, LEVEL_TEXT[d.level] || d.level, d.side === 'left' ? 'ซ้าย' : 'ขวา',
    p.upper, p.lower, p.wrist, p.neck, p.trunk, p.legs,
    d.scoreC, d.scoreD,
    a.upperArm, a.elbow, a.wrist, a.neck, a.trunk,
    LOAD_TEXT[d.load] || d.load, d.muscle ? 'ใช่' : 'ไม่'
  ];
}

/** แถว REBA */
function rebaRow_(d) {
  const p = d.parts || {}, a = d.angles || {};
  return [
    new Date(d.time), d.station, d.task, d.assessor,
    d.final, rebaLevelText_(d), d.side === 'left' ? 'ซ้าย' : 'ขวา',
    p.trunk, p.neck, p.legs, p.upper, p.lower, p.wrist,
    d.scoreA, d.scoreB, d.tableC,
    a.trunk, a.neck, a.knee, a.upperArm, a.elbow,
    rebaLoadText_(d), COUPLING_TEXT[d.coupling] || d.coupling, activityText_(d.activity)
  ];
}

/** ระดับความเสี่ยง REBA 1-5 (ใช้ risk ที่ส่งมา ถ้าไม่มีคำนวณจากคะแนน) */
function rebaRisk_(d) {
  const r = Number(d.risk);
  if (r >= 1 && r <= 5) return r;
  const s = Number(d.final);
  return s <= 1 ? 1 : s <= 3 ? 2 : s <= 7 ? 3 : s <= 10 ? 4 : 5;
}

function rebaLevelText_(d) {
  return REBA_LEVEL_TEXT[rebaRisk_(d)];
}

function rebaLoadText_(d) {
  const t = REBA_LOAD_TEXT[d.load] || String(d.load == null ? '' : d.load);
  return d.shock ? t + ' + แรงกระแทก' : t;
}

function activityText_(act) {
  if (!act) return 'ไม่มี';
  const list = [];
  if (act.static) list.push('ค้างท่าเกิน 1 นาที');
  if (act.repeat) list.push('ทำซ้ำเกิน 4 ครั้งต่อนาที');
  if (act.rapid) list.push('เปลี่ยนท่ารวดเร็วหรือพื้นไม่มั่นคง');
  return list.length ? list.join(', ') : 'ไม่มี';
}

/** หาแท็บตามชื่อ ถ้ายังไม่มีให้สร้างพร้อมหัวตารางและสี */
function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    formatSheet_(sh, headers, name === REBA_SHEET ? REBA_LEVEL_TEXT : LEVEL_TEXT);
  }
  return sh;
}

/** จัดหัวตาราง รูปแบบวันที่ และสีตามระดับ (คอลัมน์ F ของทั้งสองแท็บ) */
function formatSheet_(sh, headers, levels) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#18263A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');

  const col = sh.getRange('F2:F');
  const colors = {
    1: ['#D4EDDF', '#1E6B3E'],
    2: ['#FFF3C4', '#6B5300'],
    3: ['#FBD9C4', '#8A3A0B'],
    4: ['#F6CACA', '#8B1A1A'],
    5: ['#8B1A1A', '#FFFFFF']
  };
  // เทียบด้วยข้อความต้นของระดับ เช่น "4 -" หรือ "4 –" จึงไม่สับสนกับตัวเลขอื่น
  const rules = Object.keys(levels).map(k => SpreadsheetApp.newConditionalFormatRule()
    .whenTextStartsWith(levels[k].slice(0, 3)).setBackground(colors[k][0]).setFontColor(colors[k][1])
    .setRanges([col]).build());
  sh.setConditionalFormatRules(rules);
  sh.autoResizeColumns(1, headers.length);
}

/** รันครั้งเดียว: สร้างและจัดรูปแบบแท็บ RULA และ REBA */
function setupSheets() {
  formatSheet_(getSheet_(RULA_SHEET, HEADERS), HEADERS, LEVEL_TEXT);
  formatSheet_(getSheet_(REBA_SHEET, REBA_HEADERS), REBA_HEADERS, REBA_LEVEL_TEXT);
}

/** ข้อความ LINE RULA: ขึ้นต้นด้วยจุดงาน บอกวิธีประเมิน ไม่ระบุตัวพนักงาน */
function rulaMessage_(d) {
  const a = d.angles || {};
  return 'จุดงาน: ' + (d.station || 'ไม่ระบุ') + '\n' +
    'วิธีประเมิน: RULA\n' +
    'งาน: ' + (d.task || 'ไม่ระบุ') + '\n' +
    'คะแนน RULA ' + d.final + ' (ระดับ ' + (LEVEL_TEXT[d.level] || d.level) + ')\n' +
    'ลำตัวก้ม ' + a.trunk + '° | คอ ' + a.neck + '° | ต้นแขน ' + a.upperArm + '°\n' +
    'น้ำหนัก: ' + (LOAD_TEXT[d.load] || '-') + '\n' +
    'ประเมินโดย ' + (d.assessor || '-') + ' ผ่าน ErgoEye';
}

/** ข้อความ LINE REBA: ขึ้นต้นด้วยจุดงาน บอกวิธีประเมิน ไม่ระบุตัวพนักงาน */
function rebaMessage_(d) {
  const a = d.angles || {};
  return 'จุดงาน: ' + (d.station || 'ไม่ระบุ') + '\n' +
    'วิธีประเมิน: REBA\n' +
    'งาน: ' + (d.task || 'ไม่ระบุ') + '\n' +
    'คะแนน REBA ' + d.final + ' (ระดับ ' + rebaLevelText_(d) + ')\n' +
    'ลำตัว ' + a.trunk + '° | คอ ' + a.neck + '° | เข่า ' + a.knee + '° | ต้นแขน ' + a.upperArm + '°\n' +
    'น้ำหนัก: ' + rebaLoadText_(d) + ' | การจับ: ' + (COUPLING_TEXT[d.coupling] || '-') + '\n' +
    'กิจกรรม: ' + activityText_(d.activity) + '\n' +
    'ประเมินโดย ' + (d.assessor || '-') + ' ผ่าน ErgoEye';
}

/** ส่งแจ้งเตือน LINE (ข้อความ และรูปถ้ามี ส่งในครั้งเดียวกันจึงนับเป็น 1 ข้อความในโควตา) */
function pushLine_(text, img) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const to = p.getProperty('LINE_TO');
  if (!token || !to) return;

  const messages = [{ type: 'text', text: text }];
  if (img && img.shared) messages.push({ type: 'image', originalContentUrl: img.direct, previewImageUrl: img.direct });
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true
  });
}

/** ใช้ขอสิทธิ์ครั้งแรก */
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  UrlFetchApp.fetch('https://www.google.com');
}

/** ทดสอบ LINE: ดูผลในบันทึกการดำเนินการ (200 = สำเร็จ) */
function testLine() {
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + p.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ to: p.getProperty('LINE_TO'),
      messages: [{ type: 'text', text: 'ทดสอบ ErgoEye: เชื่อมต่อ LINE สำเร็จ ✅' }] }),
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}
