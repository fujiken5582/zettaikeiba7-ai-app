// NETKEIBA リアルスクレイパー（中央・地方両対応）
import axios from "axios";
import * as cheerio from "cheerio";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const iconv = require("iconv-lite");

// HTTP keep-alive エージェント（コネクション再利用で速度UP）
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 8 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 8 });
const axiosNk = axios.create({ httpAgent, httpsAgent, timeout: 15000 });

const JRA_BASE = "https://race.netkeiba.com";
const NAR_BASE = "https://nar.netkeiba.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============================================================
// VENUE_MAP: netkeibaの場所コード → 会場名
// ============================================================
// ⚠️ 重要: NARの場所コードは2024-2025年頃に再編されています。
// 実機検証で確認できたコードのみマッピング（不明なコードは場所(XX)表示）。
//
// JRA (中央): 01-10は従来通り
// NAR (地方): 新コード体系
//   30: 門別  (実機確認: 取得した raceId 202630... が門別)
//   44: 大井  (実機確認: race_id=202644043004 → 大井4R)
//   47: 笠松  (実機確認: race_id=202647043004 → 笠松4R)
//   50: 園田  (実機確認: race_id=202650043004 → 園田4R)
//
// ※ 旧コード(34大井, 37笠松, 39園田, 44帯広, 47水沢)は廃止または再割当
// ※ 帯広・水沢などの新コードは未確認のため、出現したら場所(XX)で表示
const VENUE_MAP = {
  // 中央 (JRA) - 従来通り
  "01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京",
  "06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉",
  // 地方 (NAR) - 実機確認済みのコードのみ
  "30":"門別",
  "44":"大井",
  "47":"笠松",
  "50":"園田"
};
const BABA_MAP = {"良":0,"稍重":1,"稍":1,"重":2,"不良":3,"不":3};

function getVenueName(code) { return VENUE_MAP[code] || `場所(${code})`; }

function getDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}${m}${d}`;
}

// col5〜9（前5走）のテキストを解析
// shutuba_past.html の前走セル（col5〜9）を解析
// 行構造（位置ではなく内容で判定する）:
//   日付行:    "2025.02.10 京都"        → /\d{4}\.\d{2}\.\d{2}/
//   R番:       "1"                       → 数字単独行（任意・着順ではない）
//   レース名:  "エルフィン" / "3歳条件未"
//   グレード:  "L" / "OP" / "GIII" / "1勝" 等（任意・あったりなかったり）
//   コース:    "芝1600(外) 1:35.3 良"  → /(芝|ダ)\d+/
//   統計1:     "9頭 4番 9人 浜中俊 55.0" → 頭数・着順・人気・騎手・斤量
//   統計2:     "2-2 (34.8) 474(+18)"     → コーナー・上り3F・体重
//   勝ち馬:    "オガル(1.8)"              → 勝ち馬名・着差秒
function parsePastRun(text) {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  // 日付行（場所も含む）
  let date = null, venueRaw = null;
  for (const l of lines) {
    const m = l.match(/(\d{4})\.(\d{2})\.(\d{2})\s*(\S+)?/);
    if (m) {
      date = new Date(`${m[1]}-${m[2]}-${m[3]}`);
      venueRaw = m[4] || null;
      break;
    }
  }
  if (!date) return null;

  // コース情報行: "芝1600(外) 1:35.3 良" or "ダ1000 1:03.6 良"
  const courseLine = lines.find(l => /^(芝|ダ)\d{3,4}/.test(l)) || '';
  const surface = courseLine.startsWith('ダ') ? 'ダ' : (courseLine.startsWith('芝') ? '芝' : null);
  const distMatch = courseLine.match(/(芝|ダ)(\d{3,4})/);
  const dist = distMatch ? parseInt(distMatch[2]) : null;
  const babaMatch = courseLine.match(/(良|稍重|重|不良|稍|不)\s*$/);
  const baba = babaMatch ? babaMatch[1].replace('稍重','稍').replace('不良','不') : null;

  // タイム秒（コース情報行から）
  let timeSec = null;
  const timeMatch = courseLine.match(/(\d+):(\d+)\.(\d+)/);
  if (timeMatch) {
    timeSec = parseInt(timeMatch[1]) * 60 + parseFloat(`${timeMatch[2]}.${timeMatch[3]}`);
  }

  // 統計1行: "9頭 4番 9人 宮内勇樹 55.0" → 頭数 着順 人気 騎手 斤量
  // 全角・半角スペース両対応
  let headCount = null, rank = null, popularity = null, jockey = null, kinryo = null;
  const statsLine1 = lines.find(l => /\d+頭[\s\u3000]+\d+番[\s\u3000]+\d+人/.test(l));
  if (statsLine1) {
    const m = statsLine1.match(/(\d+)頭[\s\u3000]+(\d+)番[\s\u3000]+(\d+)人[\s\u3000]+(\S+?)[\s\u3000]+(\d{2}(?:\.\d)?)\s*$/);
    if (m) {
      headCount = parseInt(m[1]);
      rank      = parseInt(m[2]);  // ★ ここが本当の着順
      popularity = parseInt(m[3]);
      jockey    = m[4];
      kinryo    = parseFloat(m[5]);
    } else {
      // フォールバック: 部分的にでも取得
      const hm = statsLine1.match(/(\d+)頭/);
      const rm = statsLine1.match(/(\d+)番/);
      const pm = statsLine1.match(/(\d+)人/);
      if (hm) headCount = parseInt(hm[1]);
      if (rm) rank = parseInt(rm[1]);
      if (pm) popularity = parseInt(pm[1]);
    }
  }

  // 統計2行: "2-2 (34.8) 474(+18)" or "4-5 (38.7) 468(+4)"
  // コーナー4位置（最後の数字）、上り3F、馬体重、増減
  let corner4 = null, last3F = null, weight = null, weightChange = null;
  const statsLine2 = lines.find(l => /\(\d+\.\d+\)/.test(l) && /\d+-\d+/.test(l));
  if (statsLine2) {
    const cornerMatch = statsLine2.match(/(\d+)-(\d+)(?:-(\d+))?(?:-(\d+))?/);
    if (cornerMatch) {
      // 最後の存在する数字を4角通過位置とする
      const passed = [cornerMatch[1], cornerMatch[2], cornerMatch[3], cornerMatch[4]].filter(Boolean);
      corner4 = parseInt(passed[passed.length - 1]);
    }
    const last3FMatch = statsLine2.match(/\((\d+\.\d+)\)/);
    if (last3FMatch) last3F = parseFloat(last3FMatch[1]);
    const wMatch = statsLine2.match(/(\d{3,4})\(([+-]?\d+)\)/);
    if (wMatch) {
      weight = parseInt(wMatch[1]);
      weightChange = parseInt(wMatch[2]);
    }
  }

  // 勝ち馬行 + 着差: "オガル(1.8)" / "グローリーリンク(-0.1)"
  // 統計2行よりも後にある
  let marginSec = null, winnerName = null;
  const idx2 = statsLine2 ? lines.indexOf(statsLine2) : -1;
  for (let i = (idx2 >= 0 ? idx2 + 1 : 0); i < lines.length; i++) {
    const m = lines[i].match(/^(.+?)\(([-]?\d+\.\d)\)\s*$/);
    if (m) {
      winnerName = m[1].trim();
      marginSec = parseFloat(m[2]);
      break;
    }
  }

  return {
    date, rank, surface, dist, baba, timeSec,
    marginSec, headCount, popularity, jockey, kinryo,
    last3F, corner4, weight, weightChange, winnerName,
    venueRaw
  };
}

async function fetchRaceLinksFromUrl(url, baseUrl) {
  const res = await axiosNk.get(url, {
    headers: { "User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest", "Referer": baseUrl+"/top/" },
    timeout: 15000,
    responseType: "arraybuffer"
  });
  const html = iconv.decode(Buffer.from(res.data), "UTF-8");
  const $ = cheerio.load(html);
  const races = [];
  const seen = new Set();

  $(".RaceList_DataItem").each((i, el) => {
    const $item = $(el);
    const $link = $item.find("a[href*='race_id=']").first();
    if (!$link.length) return;
    const href = $link.attr("href") || '';
    const m = href.match(/race_id=(\d+)/);
    if (!m || seen.has(m[1])) return;
    if (href.includes('result') || href.includes('odds')) return;
    seen.add(m[1]);
    const raceId = m[1];
    const placeCode = raceId.substring(4,6);
    const isNar = parseInt(placeCode) >= 30;
    const base = isNar ? NAR_BASE : JRA_BASE;
    const itemText = $item.text().trim().replace(/\s+/g,' ');
    const rNumMatch = itemText.match(/(\d+)R/);
    const raceNum = rNumMatch ? rNumMatch[1]+'R' : '';
    // 会場名はraceIdの場所コード（4-5桁目）から決定。これは確実。
    // 旧バグ: HTML全体から正規表現で会場名を拾うと、複数会場が同居するページで
    //   他会場の名前（例: 大井のページなのに「帯広」）を拾ってしまうことがあった。
    const venueName = getVenueName(placeCode);
    races.push({
      raceId, raceName: `${venueName} ${raceNum}`,
      raceData: itemText.replace(/\d+R/,'').trim(),
      venue: venueName, isNar,
      url: `${base}/race/shutuba_past.html?race_id=${raceId}`
    });
  });
  return races;
}

export async function fetchWeekendRaceList(weekOffset = 0) {
  const today = new Date();
  const dayOfWeek = today.getDay();

  let baseSaturday;
  if (dayOfWeek === 0) baseSaturday = new Date(today.getTime() - 24*60*60*1000);
  else if (dayOfWeek === 6) baseSaturday = new Date(today);
  else baseSaturday = new Date(today.getTime() + (6-dayOfWeek)*24*60*60*1000);

  const targetSat = new Date(baseSaturday.getTime() + weekOffset*7*24*60*60*1000);
  const targetSun = new Date(targetSat.getTime() + 24*60*60*1000);
  const todayStr = getDateString(today);
  const jraDateSet = new Set([getDateString(targetSat), getDateString(targetSun)]);
  if (dayOfWeek === 0 || dayOfWeek === 6) jraDateSet.add(todayStr);
  const jraDates = [...jraDateSet].sort();
  const narDate = getDateString(new Date(today.getTime() + weekOffset*7*24*60*60*1000));

  console.log(`[JRA] 取得日: ${jraDates.join(', ')}`);
  console.log(`[NAR] 取得日: ${narDate}`);

  const allRaces = [];
  for (const dateStr of jraDates) {
    try {
      const url = `${JRA_BASE}/top/race_list_sub.html?kaisai_date=${dateStr}`;
      const races = await fetchRaceLinksFromUrl(url, JRA_BASE);
      races.forEach(r => { r.date = dateStr; r.dateDisplay = `${dateStr.slice(4,6)}/${dateStr.slice(6,8)}`; });
      console.log(`[JRA] ${dateStr}: ${races.length}件`);
      allRaces.push(...races);
    } catch(e) { console.error(`[JRA] ${dateStr} エラー:`, e.message); }
  }
  try {
    const url = `${NAR_BASE}/top/race_list_sub.html?kaisai_date=${narDate}`;
    const races = await fetchRaceLinksFromUrl(url, NAR_BASE);
    races.forEach(r => { r.date = narDate; r.dateDisplay = `${narDate.slice(4,6)}/${narDate.slice(6,8)}`; });
    console.log(`[NAR] ${narDate}: ${races.length}件`);
    allRaces.push(...races);
  } catch(e) { console.error(`[NAR] エラー:`, e.message); }

  console.log(`合計 ${allRaces.length}件`);
  return allRaces;
}

// 出馬表取得（中央・地方両対応）
export async function fetchShutubaTable(raceId) {
  // 海外競馬: race_idに英字が含まれる（例: 2026H1010105）
  const isAbroad = /[A-Za-z]/.test(raceId);
  const placeCode = isAbroad ? '00' : raceId.substring(4,6);
  const isNar = !isAbroad && parseInt(placeCode) >= 30;
  const base = isAbroad ? JRA_BASE : (isNar ? NAR_BASE : JRA_BASE);
  const page = isAbroad ? 'shutuba_past_abroad.html' : 'shutuba_past.html';
  const url = `${base}/race/${page}?race_id=${raceId}`;
  console.log(`出馬表取得: ${url} (${isAbroad?'海外':isNar?'地方':'JRA'})`);

  const res = await axiosNk.get(url, {
    headers: { "User-Agent": USER_AGENT, "Referer": `${base}/top/` },
    timeout: 15000,
    responseType: "arraybuffer"
  });
  const html = iconv.decode(Buffer.from(res.data), "EUC-JP");
  const $ = cheerio.load(html);

  const raceName = $(".RaceName").first().text().trim() || `レース ${raceId.slice(-2)}`;
  const raceDataText = $(".RaceData01").first().text().trim();
  const distanceMatch = raceDataText.match(/(\d+)m/);
  const distance = distanceMatch ? parseInt(distanceMatch[1]) : 1600;
  const surfaceRaw = raceDataText.match(/(芝|ダート|ダ)/);
  const surface = surfaceRaw ? (surfaceRaw[1].startsWith('ダ') ? 'ダ' : '芝') : (isNar ? 'ダ' : '芝');
  const condMatch = raceDataText.match(/(良|稍重|重|不良)/);
  const condition = condMatch ? condMatch[1].replace('稍重','稍').replace('不良','不') : '良';
  // 海外競馬の場合は場所名をHTMLから取得
  let venue = isAbroad ? '' : getVenueName(placeCode);
  if (isAbroad) {
    const venueEl = $('.RaceData02').first().text() || $('.RaceName').first().text();
    // シャティン、メイダン等をHTMLから抽出
    const abroadMatch = raceId.match(/[A-Za-z]/);
    const venueNames = {'H':'シャティン','M':'メイダン','F':'フランス','E':'イギリス','U':'アメリカ','D':'ドバイ','A':'オーストラリア','I':'アイルランド'};
    const venueCode = abroadMatch ? abroadMatch[0].toUpperCase() : '';
    venue = venueNames[venueCode] || '海外';
    // HTMLから直接取得を試みる
    const courseEl = $('.RaceData01, .RaceCommon_Table').first().text();
    const venueFromHtml = courseEl.match(/(シャティン|メイダン|ロンシャン|アスコット|チャーチル|サンタアニタ|フレミントン|レパーズタウン|マンダリアン)/);
    if (venueFromHtml) venue = venueFromHtml[1];
  }

  const horses = [];
  const today = new Date();

  $("table.Shutuba_Table tbody tr").each((i, el) => {
    const cells = $(el).find("td");
    if (cells.length < 5) return;

    // JRA: col0=枠番(CSS背景のみで空), col1=馬番(空の場合あり), col2=印, col3=馬名情報
    // NAR: col0=枠番, col1=馬番, col2=印, col3=馬名情報
    // → col0・col1・col2のいずれかから馬番を取得
    let horseNumber = parseInt(cells.eq(1).text().trim()) || 0;
    if (!horseNumber) horseNumber = parseInt(cells.eq(0).text().trim()) || 0;
    // col0・col1が両方空の場合（JRAでよく起きる）→ 行インデックスから推定
    // ただしcol3に馬名データがある行のみカウント
    if (!horseNumber) {
      // col3の2行目が馬名かどうかで判定（数字の馬番は後で設定）
      const col3tmp = cells.eq(3).text().trim().split(/\n/).map(l=>l.trim()).filter(Boolean);
      if (col3tmp.length >= 2 && col3tmp[1] && col3tmp[1].length >= 2) {
        horseNumber = i; // 行インデックスを馬番として使用（暫定）
      }
    }
    if (!horseNumber || horseNumber > 20) return;

    // col3: 父馬(0行), 馬名(1行), 母馬(2行), 調教師(4行), 間隔・体重・オッズなど
    const col3Lines = cells.eq(3).text().trim().split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const sire = col3Lines[0] || '';
    const horseName = col3Lines[1] || '';
    if (!horseName || horseName.length < 2) return;

    // col3に含まれる間隔・体重・オッズ
    const col3Full = cells.eq(3).text();
    const intervalMatch = col3Full.match(/(中(\d+)週|連闘|長期休養|(\d+)週)/);
    let interval = null;
    if (intervalMatch) {
      if (intervalMatch[2]) interval = parseInt(intervalMatch[2]) + 1;
      else if (intervalMatch[0] === '連闘') interval = 1;
      else if (intervalMatch[3]) interval = parseInt(intervalMatch[3]);
    }

    // 当日体重（col3に含まれる場合: "490kg(-4)"）
    const todayWeightMatch = col3Full.match(/(\d{3,4})kg\(([+-]?\d+)\)/);
    const todayWeight = todayWeightMatch ? parseInt(todayWeightMatch[1]) : null;
    const todayWeightChange = todayWeightMatch ? parseInt(todayWeightMatch[2]) : null;

    // 単勝オッズ・人気
    // JRA: 1行に集約 "26.5 (6人気)" / NAR: 2行に分かれる "31.4" → "(5人気)"
    // どちらにも対応するため、オッズ単独行と次行の人気を組み合わせて検出
    let tanshukuOdds = null;
    let ninki = null;
    // パターンA: 同一行内 "26.5 (6人気)"
    const oddsLineA = col3Lines.find(l => /[\d.]+[\s\u3000]*[\(\uff08]\d+[人\u4eba][気\u6c17][\)\uff09]/.test(l));
    if (oddsLineA) {
      const m = oddsLineA.match(/([\d.]+)[\s\u3000]*[\(\uff08](\d+)[人\u4eba][気\u6c17][\)\uff09]/);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v < 10000) {
          tanshukuOdds = v;
          ninki = parseInt(m[2]);
        }
      }
    }
    // パターンB: 別行に分かれる場合 "31.4" → "(5人気)"
    if (tanshukuOdds === null) {
      for (let li = 0; li < col3Lines.length - 1; li++) {
        if (/^[\d.]+$/.test(col3Lines[li])) {
          const v = parseFloat(col3Lines[li]);
          if (v > 0 && v < 10000) {
            const next = col3Lines[li + 1] || '';
            const nm = next.match(/[\(\uff08](\d+)[人\u4eba][気\u6c17][\)\uff09]/);
            if (nm) {
              tanshukuOdds = v;
              ninki = parseInt(nm[1]);
              break;
            }
          }
        }
      }
    }

    // col4: 性齢(0行), 騎手(1行), 斤量(2行)
    const col4Lines = cells.eq(4).text().trim().split(/\n/).map(l => l.trim()).filter(Boolean);
    const sexAgeMatch = (col4Lines[0] || '').match(/([牡牝セ騸])(\d+)/);
    const sex = sexAgeMatch ? sexAgeMatch[1] : '牡';
    const age = sexAgeMatch ? parseInt(sexAgeMatch[2]) : 4;
    const jockey = col4Lines[1] || '';
    const kinryo = parseFloat(col4Lines[2]) || 55;

    // col5〜9: 前5走（全て解析）
    const pastRuns = [];
    for (let ci = 5; ci <= 9; ci++) {
      const cellText = cells.eq(ci).text().trim();
      if (!cellText) break;
      const run = parsePastRun(cellText);
      if (run) pastRuns.push(run);
    }

    // 前走データ（pastRuns[0]）
    const prev = pastRuns[0] || null;

    // 間隔を前走日付から計算（col3の間隔テキストより正確）
    if (!interval && prev && prev.date) {
      const diffDays = Math.floor((today - prev.date) / (1000*60*60*24));
      interval = Math.max(1, Math.round(diffDays / 7));
    }

    // 体重は当日体重優先、なければ前走体重
    const weight = todayWeight || (prev ? prev.weight : null);
    const weightChange = todayWeightChange !== null ? todayWeightChange
                       : (prev ? prev.weightChange : null);

    // 前走速度（前走タイム・距離から計算）
    let prevSpeed = null;
    if (prev && prev.timeSec && prev.dist) {
      prevSpeed = prev.dist / prev.timeSec;
    }

    horses.push({
      name: horseName,
      horseNumber,
      // 当日情報
      age, sex, kinryo, jockey,
      headCount: 0, // 後で全頭数確定後に上書き
      trainer: (() => {
        const t = col3Lines.find(l => l.includes('・') || l.includes('美浦') || l.includes('栗東')) || '';
        const tm = t.match(/[・　](.+)$/) || t.match(/(.+)/);
        return tm ? tm[1].trim() : '';
      })(),
      sire,
      surface, distance, condition,
      // 体重（当日優先）
      weight: weight,
      weightChange: weightChange,
      // 前走データ（nullは送らない）
      previousRank: prev ? String(prev.rank) : null,
      prev_last3F: prev ? prev.last3F : null,
      prev_distance: prev ? prev.dist : null,
      prev_condition: prev ? prev.baba : null,
      prev_time_sec: prev ? prev.timeSec : null,
      prev_surface: prev ? prev.surface : null,
      prev_corner4: prev ? prev.corner4 : null,
      prev_headCount: prev ? prev.headCount : null,
      prev_kinryo: prev ? prev.kinryo : null,
      prev_margin: prev ? prev.marginSec : null,
      corner4: prev ? prev.corner4 : null,
      interval: interval,
      // 前5走の詳細（参考情報）+ 過去5走集計用の追加情報
      pastRuns: pastRuns.map(r => ({
        rank: r.rank,
        last3F: r.last3F,
        corner4: r.corner4,
        dist: r.dist,
        baba: r.baba,
        surface: r.surface,
        weight: r.weight,
        weightChange: r.weightChange,
        date: r.date ? r.date.toISOString().slice(0,10) : null,
        // ↓ 過去5走から特徴量を計算するため追加
        venue: r.venueRaw || null,        // 場所名（左右回り判定用）
        popularity: r.popularity || null, // 過去走の人気
        jockey: r.jockey || null,         // 過去走の騎手
        headCount: r.headCount || null,   // 過去走の頭数
        timeSec: r.timeSec || null,       // 走破タイム秒
        marginSec: r.marginSec || null    // 着差秒
      })),
      // 単勝オッズ・人気（期待値計算用）
      odds: tanshukuOdds,
      popularity: ninki,
    });
  });

  // 全頭取得後、headCountを各馬に設定
  const totalHorses = horses.length;
  horses.forEach(h => { h.headCount = totalHorses; });

  // オッズAPIから単勝オッズを取得
  // JRA: race.netkeiba.com/api/api_get_jra_odds.html → {data:{odds:{"1":{"01":["odds","","ninki"]}}}}
  // NAR: nar.netkeiba.com/api/api_get_nar_odds.html → {ary_odds:{"01":{"Odds":"31.4","Ninki":5}}}
  if (!isAbroad && horses.length > 0) {
    try {
      let oddsApiUrl, referer;
      if (isNar) {
        oddsApiUrl = `${NAR_BASE}/api/api_get_nar_odds.html?race_id=${raceId}&type=1`;
        referer = `${NAR_BASE}/race/shutuba_past.html?race_id=${raceId}`;
      } else {
        oddsApiUrl = `${JRA_BASE}/api/api_get_jra_odds.html?race_id=${raceId}&type=1&action=update`;
        referer = `${JRA_BASE}/race/shutuba_past.html?race_id=${raceId}`;
      }
      const oddsRes = await axiosNk.get(oddsApiUrl, {
        headers: { "User-Agent": USER_AGENT, "Referer": referer },
        timeout: 8000
      });
      const oddsJson = typeof oddsRes.data === 'object' ? oddsRes.data : JSON.parse(oddsRes.data);

      let oddsCount = 0;
      if (isNar) {
        // NAR形式: ary_odds[馬番ゼロ埋め] = {Odds, Ninki}
        const ary = oddsJson && oddsJson.ary_odds;
        if (ary && typeof ary === 'object') {
          horses.forEach(h => {
            const key = String(h.horseNumber).padStart(2, '0');
            const od = ary[key];
            if (od && typeof od === 'object') {
              const win = parseFloat(od.Odds || '0');
              const nk  = parseInt(od.Ninki || '0');
              if (win > 0) { h.odds = win; h.popularity = nk || null; oddsCount++; }
            }
          });
        }
      } else {
        // JRA形式: data.odds["1"][馬番ゼロ埋め] = ["odds","","ninki"]
        const tanshoData = oddsJson && oddsJson.data && oddsJson.data.odds && oddsJson.data.odds['1'];
        if (tanshoData) {
          horses.forEach(h => {
            const key = String(h.horseNumber).padStart(2, '0');
            const od = tanshoData[key];
            if (od && Array.isArray(od)) {
              const win = parseFloat(od[0] || '0');
              const nk  = parseInt(od[2] || '0');
              if (win > 0) { h.odds = win; h.popularity = nk || null; oddsCount++; }
            }
          });
        }
      }
      console.log(`[ODDS API ${isNar ? 'NAR' : 'JRA'}] ${oddsCount}頭のオッズ取得成功`);
    } catch(e) {
      console.log(`[ODDS API ${isNar ? 'NAR' : 'JRA'}] 失敗（未発表または通信エラー）: ${e.message.substring(0, 80)}`);
    }
  }

  console.log(`${horses.length}頭取得（前走データ含む）`);
  return {
    raceId, raceName,
    raceInfo: {
      raceName,
      distance: `${distance}m`,
      surface: surface === 'ダ' ? 'ダート' : '芝',
      condition,
      date: (() => {
        // ❌ 旧バグ: raceIdの substring(6,8)/(8,10) は「開催回数/開催日数」であり月日ではない
        //   例: 202608030411 = 「3回開催・4日目」を「3月4日」と誤解釈していた
        // ✅ HTMLの <title> タグから「YYYY年M月D日」形式で正確抽出
        const titleText = ($('title').text() || '');
        const m = titleText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m) return `${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`;
        // フォールバック: RaceList_Date の最初の月日 + raceIdの年
        const dateBoxText = $('.RaceList_Date, .RaceList_NameBox').first().text() || '';
        const md = dateBoxText.match(/(\d{1,2})月(\d{1,2})日/);
        if (md && raceId && raceId.length >= 4) {
          return `${raceId.substring(0,4)}/${String(md[1]).padStart(2,'0')}/${String(md[2]).padStart(2,'0')}`;
        }
        return new Date().toLocaleDateString('ja-JP');
      })()
    },
    venueName: venue,
    horses
  };
}
// デバッグ用エクスポート（一時）
