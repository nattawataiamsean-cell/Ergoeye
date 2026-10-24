// Runs appscript/code.gs against mocked Apps Script services.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../appscript/code.gs', import.meta.url), 'utf8');

let sheets, pushes, props;
function mockSheet(name) {
  const sh = { name, rows: [], header: null, rules: [], frozen: 0 };
  const range = a1 => {
    const r = {
      a1, setValues(v) { if (a1 === 'header') sh.header = v[0]; return r; },
      setFontWeight: () => r, setBackground: () => r, setFontColor: () => r, setNumberFormat: () => r
    };
    return r;
  };
  Object.assign(sh, {
    appendRow: row => sh.rows.push(row),
    getRange: (...a) => range(a.length === 4 && a[0] === 1 ? 'header' : String(a[0])),
    setFrozenRows: n => { sh.frozen = n; }, setConditionalFormatRules: r => { sh.rules = r; }, autoResizeColumns() { }
  });
  return sh;
}
function ruleBuilder() {
  const rule = {};
  const b = {
    whenTextStartsWith: t => { rule.prefix = t; return b; }, setBackground: c => { rule.bg = c; return b; },
    setFontColor: c => { rule.fg = c; return b; }, setRanges: r => { rule.range = r[0].a1; return b; }, build: () => rule
  };
  return b;
}
const G = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getName: () => 'ss', getSheetByName: n => sheets[n] || null,
      insertSheet: n => (sheets[n] = mockSheet(n))
    }),
    newConditionalFormatRule: ruleBuilder
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] }) },
  UrlFetchApp: {
    fetch: (url, o) => { if (url.includes('line.me')) pushes.push(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => '{}' }; }
  },
  Logger: { log() { } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: {
    formatDate: () => '20261024_150000', base64Decode: b => Buffer.from(b, 'base64'),
    newBlob: (bytes, type, name) => ({ bytes, type, name })
  },
  DriveApp: {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    createFolder: name => { drive.folders.push(name); return driveFolder; },
    getFolderById: () => driveFolder
  }
};
let drive;
const driveFolder = {
  getId: () => 'folder1',
  createFile: blob => {
    const id = 'file' + (drive.files.length + 1);
    const f = { blob, sharing: null, getId: () => id, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
      setSharing(a, p) { if (drive.blockSharing) throw new Error('blocked'); f.sharing = a + ':' + p; } };
    drive.files.push(f); return f;
  }
};
const GS = new Function(...Object.keys(G), src + `
  return { doPost, setupSheets, authorize, testLine, HEADERS, REBA_HEADERS, REBA_LEVEL_TEXT, LEVEL_TEXT };`)(...Object.values(G));

const post = d => JSON.parse(GS.doPost({ postData: { contents: JSON.stringify(d) } }).text);
const RULA = {
  time: '2026-10-24T08:00:00Z', station: 'คลัง B', task: 'ยกกล่อง', assessor: 'จป. สมชาย', final: 5, level: 3, scoreC: 4, scoreD: 5, side: 'right',
  parts: { upper: 3, lower: 2, wrist: 1, neck: 3, trunk: 4, legs: 1 }, angles: { upperArm: 70, elbow: 10, wrist: null, neck: 30, trunk: 70 }, load: 1, muscle: true
};
const REBA = {
  time: '2026-10-24T08:00:00Z', station: 'คลัง B', task: 'ยกกล่อง', assessor: 'จป. สมชาย', method: 'REBA', final: 11, risk: 5,
  scoreA: 8, scoreB: 5, tableC: 10, side: 'left', parts: { trunk: 4, neck: 2, legs: 2, upper: 3, lower: 2, wrist: 1 },
  angles: { trunk: 70, neck: 30, knee: 50, upperArm: 70, elbow: 10 }, load: 2, shock: true, coupling: 1,
  activity: { static: false, repeat: true, rapid: false }
};

beforeEach(() => {
  sheets = {}; pushes = []; drive = { folders: [], files: [], blockSharing: false };
  props = { LINE_CHANNEL_ACCESS_TOKEN: 't', LINE_TO: 'u' };
  G.PropertiesService.getScriptProperties = () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } });
});
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');

test('image is saved to Drive, linked in the last column and attached to the LINE alert', () => {
  post({ ...REBA, image: JPEG, station: 'คลัง/B' });
  assert.deepEqual(drive.folders, ['ErgoEye รูปประเมิน']);
  assert.equal(props.IMAGE_FOLDER_ID, 'folder1');
  const f = drive.files[0];
  assert.equal(f.blob.type, 'image/jpeg'); assert.equal(f.blob.bytes.toString(), 'fake-jpeg');
  assert.equal(f.blob.name, 'REBA_20261024_150000_คลัง-B.jpg');
  assert.equal(f.sharing, 'ANYONE_WITH_LINK:VIEW');
  assert.equal(sheets.REBA.rows[0].at(-1), '=HYPERLINK("https://drive.google.com/file/d/file1/view","ดูรูป")');
  const msgs = pushes[0].messages;
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[1], { type: 'image', originalContentUrl: 'https://lh3.googleusercontent.com/d/file1', previewImageUrl: 'https://lh3.googleusercontent.com/d/file1' });
  // second upload reuses the folder
  post({ ...RULA, image: JPEG });
  assert.equal(drive.folders.length, 1);
  assert.match(sheets.RULA.rows[0].at(-1), /file2/);
});

test('no image: blank picture cell and text-only LINE; blocked sharing keeps the sheet link only', () => {
  post(REBA);
  assert.equal(sheets.REBA.rows[0].at(-1), ''); assert.equal(pushes[0].messages.length, 1);
  drive.blockSharing = true;
  post({ ...REBA, image: JPEG });
  assert.match(sheets.REBA.rows[1].at(-1), /HYPERLINK/); assert.equal(pushes[1].messages.length, 1);
  post({ ...REBA, image: 'not-an-image' });
  assert.equal(sheets.REBA.rows[2].at(-1), ''); assert.equal(drive.files.length, 1);
});

test('no method field goes to the RULA tab with the original columns', () => {
  const { method, ...old } = { ...RULA };
  assert.equal(post(old).method, 'RULA');
  assert.deepEqual(Object.keys(sheets), ['RULA']);
  const row = sheets.RULA.rows[0];
  assert.equal(row.length, GS.HEADERS.length);
  assert.deepEqual(row.slice(1), ['คลัง B', 'ยกกล่อง', 'จป. สมชาย', 5, '3 – ควรปรับปรุงเร็ว ๆ นี้', 'ขวา', 3, 2, 1, 3, 4, 1, 4, 5, 70, 10, null, 30, 70, '2-10 กก. เป็นครั้งคราว', 'ใช่', '']);
  assert.deepEqual(sheets.RULA.header, GS.HEADERS);
});

test('method RULA goes to RULA, method REBA goes to REBA', () => {
  post({ ...RULA, method: 'RULA' }); post(REBA);
  assert.equal(sheets.RULA.rows.length, 1); assert.equal(sheets.REBA.rows.length, 1);
});

test('REBA row has its own columns and a plain-hyphen level text', () => {
  post(REBA);
  const row = sheets.REBA.rows[0];
  assert.deepEqual(sheets.REBA.header, GS.REBA_HEADERS);
  assert.equal(row.length, GS.REBA_HEADERS.length);
  assert.deepEqual(row.slice(1), ['คลัง B', 'ยกกล่อง', 'จป. สมชาย', 11, '5 - สูงมาก ต้องแก้ไขทันที', 'ซ้าย',
    4, 2, 2, 3, 2, 1, 8, 5, 10, 70, 30, 50, 70, 10, '> 10 กก. + แรงกระแทก', 'พอใช้', 'ทำซ้ำเกิน 4 ครั้งต่อนาที', '']);
  for (const t of Object.values(GS.REBA_LEVEL_TEXT)) assert.match(t, /^[1-5] - [฀-๿ ]+$/, t);
  assert.equal(post({ ...REBA, risk: undefined, final: 9 }).ok, true);
  assert.equal(sheets.REBA.rows[1][5], '4 - สูง ต้องแก้ไขโดยเร็ว');
});

test('LINE: RULA from level 3, REBA from score 8, message starts with the station and names the method', () => {
  post({ ...RULA, level: 2 }); assert.equal(pushes.length, 0);
  post(RULA); assert.equal(pushes.length, 1);
  post({ ...REBA, final: 7, risk: 3 }); assert.equal(pushes.length, 1);
  post({ ...REBA, final: 8, risk: 4 }); assert.equal(pushes.length, 2);
  const [rula, reba] = pushes.map(p => p.messages[0].text);
  assert.match(rula, /^จุดงาน: คลัง B\nวิธีประเมิน: RULA\n/);
  assert.match(reba, /^จุดงาน: คลัง B\nวิธีประเมิน: REBA\n/);
  assert.match(reba, /คะแนน REBA 8 \(ระดับ 4 - สูง ต้องแก้ไขโดยเร็ว\)/);
  assert.match(reba, /เข่า 50°/);
});

test('LINE is skipped when the properties are missing', () => {
  props = {}; post(REBA); assert.equal(pushes.length, 0);
});

test('setupSheets formats both tabs with colour rules on the level column', () => {
  GS.setupSheets();
  assert.deepEqual(Object.keys(sheets).sort(), ['REBA', 'RULA']);
  assert.equal(sheets.RULA.rules.length, 4); assert.equal(sheets.REBA.rules.length, 5);
  assert.deepEqual(sheets.REBA.rules.map(r => r.prefix), ['1 -', '2 -', '3 -', '4 -', '5 -']);
  assert.ok([...sheets.RULA.rules, ...sheets.REBA.rules].every(r => r.range === 'F2:F'));
  assert.equal(sheets.REBA.frozen, 1);
});

test('authorize and testLine are kept', () => {
  GS.authorize(); GS.testLine();
  assert.equal(pushes.at(-1).messages[0].text, 'ทดสอบ ErgoEye: เชื่อมต่อ LINE สำเร็จ ✅');
});
