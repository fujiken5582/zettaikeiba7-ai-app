// NETKEIBA リアルスクレイパー（中央・地方両対応）
import axios from "axios";
import * as cheerio from "cheerio";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const iconv = require("iconv-lite");

import { parseRaceId } from './raceIdGenerator.js';

const JRA_BASE = "https://race.netkeiba.com";
const NAR_BASE = "https://nar.netkeiba.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const VENUE_MAP = {
  "01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京",
  "06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉",
  "30":"門別","31":"岩手","32":"浦和","33":"船橋","34":"大井",
  "35":"川崎","36":"金沢","37":"笠松","38":"名古屋","39":"園田",
  "40":"姫路","41":"高知","42":"佐賀","43":"荒尾","44":"帯広",
  "45":"旭川","46":"盛岡","47":"水沢","48":"上山","55":"佐賀"
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
function parsePastRun(text) {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // 行0: 日付＋場所（例: "2026.04.05 佐賀"）
  const dateMatch = lines[0].match(/(\d{4})\.(\d{2})\.(\d{2})/);
  const date = dateMatch ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`) : null;

  // 行1: 着順（数字のみ）
  const rank = parseInt(lines[1]) || null;

  // 行3: コース情報（例: "ダ1300 1:24.5 不"）
  const courseInfo = lines[3] || '';
  const surface = courseInfo.startsWith('ダ') ? 'ダ' : '芝';
  const distMatch = courseInfo.match(/(\d{3,4})/);
  const dist = distMatch ? parseInt(distMatch[1]) : null;
  const babaMatch = courseInfo.match(/(良|稍重|重|不良|稍|不)/);
  const baba = babaMatch ? babaMatch[1].replace('稍重','稍').replace('不良','不') : null;

  // タイム
  let timeSec = null;
  const timeMatch = courseInfo.match(/(\d+:\d+\.\d+)/);
  if (timeMatch) {
    const [m, s] = timeMatch[1].split(':');
    timeSec = parseInt(m) * 60 + parseFloat(s);
  }

  // 最終行: "6-5-5-5 (39.7) 494(-1)" など
  const statsLine = lines.find(l => /\(\d+\.\d+\)/.test(l)) || '';
  const last3FMatch = statsLine.match(/\((\d+\.\d+)\)/);
  const last3F = last3FMatch ? parseFloat(last3FMatch[1]) : null;
  const cornerMatch = statsLine.match(/(\d+)-(\d+)-(\d+)-(\d+)/);
  const corner4 = cornerMatch ? parseInt(cornerMatch[4]) : null;
  const weightMatch = statsLine.match(/(\d{3,4})\(([+-]?\d+)\)/);
  const weight = weightMatch ? parseInt(weightMatch[1]) : null;
  const weightChange = weightMatch ? parseInt(weightMatch[2]) : null;

  return { date, rank, surface, dist, baba, timeSec, last3F, corner4, weight, weightChange };
}

async function fetchRaceLinksFromUrl(url, baseUrl) {
  const res = await axios.get(url, {
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
    const $box = $item.closest(".RaceList_Box, .RaceList_DataList");
    const venueMatch = $box.text().match(/(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|門別|岩手|浦和|船橋|大井|川崎|金沢|笠松|名古屋|園田|姫路|高知|佐賀|荒尾|帯広|旭川|盛岡|水沢|上山)/);
    const venueName = venueMatch ? venueMatch[1] : getVenueName(placeCode);
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

  const res = await axios.get(url, {
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

    // 単勝オッズ・人気（col3に含まれる: "26.5 (6人気)"）
    const oddsLine = col3Lines.find(l => /[\d.]+[\s\u3000]*[\(\uff08]\d+[人\u4eba][気\u6c17][\)\uff09]/.test(l)) || '';
    const oddsMatch = oddsLine.match(/([\d.]+)[\s\u3000]*[\(\uff08](\d+)[人\u4eba][気\u6c17][\)\uff09]/);
    const tanshukuOdds = oddsMatch ? parseFloat(oddsMatch[1]) : null;
    const ninki = oddsMatch ? parseInt(oddsMatch[2]) : null;
    if (horseNumber === 1) console.log('[ODDS DEBUG] col3last3:', col3Lines.slice(-4).join('|'), '| oddsLine:', oddsLine, '| odds:', tanshukuOdds);

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
      popularity: horseNumber,
      // 当日情報
      age, sex, kinryo, jockey,
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
      corner4: prev ? prev.corner4 : null,
      interval: interval,
      // 前5走の詳細（参考情報）
      pastRuns: pastRuns.map(r => ({
        rank: r.rank,
        last3F: r.last3F,
        corner4: r.corner4,
        dist: r.dist,
        baba: r.baba,
        surface: r.surface,
        weight: r.weight,
        weightChange: r.weightChange,
        date: r.date ? r.date.toISOString().slice(0,10) : null
      })),
      // 単勝オッズ・人気（期待値計算用）
      odds: tanshukuOdds,
      popularity: ninki,
    });
  });

  // オッズAPIから単勝オッズを取得（JRAのみ・動的ロードのため別途取得）
  if (!isNar && !isAbroad && horses.length > 0) {
    try {
      const oddsApiUrl = `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1&action=update`;
      const oddsRes = await axios.get(oddsApiUrl, {
        headers: { "User-Agent": USER_AGENT, "Referer": `${JRA_BASE}/race/shutuba_past.html?race_id=${raceId}` },
        timeout: 8000
      });
      // レスポンスはJSON形式: {"status":"middle","data":{"odds":{"1":{"01":["オッズ","","人気"],...}}}}
      const oddsJson = typeof oddsRes.data === 'object' ? oddsRes.data : JSON.parse(oddsRes.data);
      const tanshoData = oddsJson && oddsJson.data && oddsJson.data.odds && oddsJson.data.odds['1'];
      if (tanshoData) {
        let oddsCount = 0;
        horses.forEach(h => {
          // 馬番は2桁ゼロ埋め文字列 "01","02",...,"18"
          const key = String(h.horseNumber).padStart(2, '0');
          const od = tanshoData[key];
          if (od && Array.isArray(od)) {
            const win = parseFloat(od[0] || '0');
            const ninki = parseInt(od[2] || '0');
            if (win > 0) { h.odds = win; h.popularity = ninki || null; oddsCount++; }
          }
        });
        console.log(`[ODDS API] ${oddsCount}頭のオッズ取得成功`);
      } else {
        console.log('[ODDS API] oddsデータなし（未発表）');
      }
    } catch(e) {
      console.log(`[ODDS API] 未発表: ${e.message.substring(0, 50)}`);
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
        // raceIdから日付を抽出: YYYYJJMMDDNN (例: 202608042507 → 2026/04/25)
        if (raceId && raceId.length >= 10) {
          const y = raceId.substring(0,4);
          const m = raceId.substring(6,8);
          const d = raceId.substring(8,10);
          return y+'/'+m+'/'+d;
        }
        return new Date().toLocaleDateString('ja-JP');
      })()
    },
    venueName: venue,
    horses
  };
}
// デバッグ用エクスポート（一時）
