// レースID生成ユーティリティ
// レースID形式: YYYYCCKKDDRR (12桁)
// YYYY: 西暦 (4桁)
// CC: 競馬場コード (2桁: 01-10)
// KK: 開催回数 (2桁: 01-06)
// DD: 開催日数 (2桁: 01-12)
// RR: レース番号 (2桁: 01-12)

// 競馬場コードマッピング
export const VENUE_CODES = {
  '01': '札幌',
  '02': '函館',
  '03': '福島',
  '04': '新潟',
  '05': '東京',
  '06': '中山',
  '07': '中京',
  '08': '京都',
  '09': '阪神',
  '10': '小倉'
};

export const VENUE_NAMES = {
  '札幌': '01',
  '函館': '02',
  '福島': '03',
  '新潟': '04',
  '東京': '05',
  '中山': '06',
  '中京': '07',
  '京都': '08',
  '阪神': '09',
  '小倉': '10'
};

/**
 * レースIDを生成
 * @param {string} year - 西暦 (YYYY)
 * @param {string} venueCode - 競馬場コード (01-10)
 * @param {number} kai - 開催回数 (1-6)
 * @param {number} day - 開催日数 (1-12)
 * @param {number} race - レース番号 (1-12)
 * @returns {string} レースID (12桁)
 */
export function generateRaceId(year, venueCode, kai, day, race) {
  const yearStr = String(year).substring(0, 4);
  const kaiStr = String(kai).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const raceStr = String(race).padStart(2, '0');
  
  return `${yearStr}${venueCode}${kaiStr}${dayStr}${raceStr}`;
}

/**
 * レースIDをパース
 * レースID形式: YYYYCCKKDDRR (12桁)
 * @param {string} raceId - レースID
 * @returns {object} パース結果
 */
export function parseRaceId(raceId) {
  if (!raceId || raceId.length !== 12) {
    console.error(`無効なレースID: ${raceId} (長さ: ${raceId?.length}, 期待: 12桁)`);
    return null;
  }
  
  return {
    year: raceId.substring(0, 4),
    venueCode: raceId.substring(4, 6),
    venueName: VENUE_CODES[raceId.substring(4, 6)] || '不明',
    kai: parseInt(raceId.substring(6, 8)),
    kaisaiDay: parseInt(raceId.substring(8, 10)),
    raceNumber: parseInt(raceId.substring(10, 12))
  };
}

/**
 * 指定期間のレースIDを生成
 * @param {object} options - オプション
 * @param {string} options.year - 西暦 (YYYY)
 * @param {string[]} options.venueCodes - 競馬場コード配列（省略時は全競馬場）
 * @param {number[]} options.kaiRange - 開催回数範囲 [min, max]（省略時は1-6）
 * @param {number[]} options.dayRange - 開催日数範囲 [min, max]（省略時は1-12）
 * @param {number[]} options.raceRange - レース番号範囲 [min, max]（省略時は1-12）
 * @returns {string[]} レースID配列
 */
export function generateRaceIds(options = {}) {
  const {
    year = new Date().getFullYear(),
    venueCodes = Object.keys(VENUE_CODES),
    kaiRange = [1, 6],
    dayRange = [1, 12],
    raceRange = [1, 12]
  } = options;
  
  const raceIds = [];
  
  // レースIDを生成
  for (const venueCode of venueCodes) {
    for (let kai = kaiRange[0]; kai <= kaiRange[1]; kai++) {
      for (let day = dayRange[0]; day <= dayRange[1]; day++) {
        for (let race = raceRange[0]; race <= raceRange[1]; race++) {
          raceIds.push(generateRaceId(year, venueCode, kai, day, race));
        }
      }
    }
  }
  
  return raceIds;
}

/**
 * 特定の年の全レースIDを生成
 * @param {string} year - 西暦 (YYYY)
 * @param {string[]} venueCodes - 競馬場コード配列（省略時は主要3場）
 * @returns {string[]} レースID配列
 */
export function generateYearRaceIds(year, venueCodes = ['05', '06', '08']) {
  const raceIds = [];
  
  for (const venueCode of venueCodes) {
    // 各開催回・開催日・レース番号の組み合わせを生成
    for (let kai = 1; kai <= 6; kai++) {
      for (let day = 1; day <= 12; day++) {
        for (let race = 1; race <= 12; race++) {
          raceIds.push(generateRaceId(year, venueCode, kai, day, race));
        }
      }
    }
  }
  
  return raceIds;
}

/**
 * 今週末（土日）のレースIDを生成
 * @param {number} weekOffset - 週のオフセット（0=今週、1=来週、-1=先週）
 * @returns {string[]} レースID配列
 */
export function generateWeekendRaceIds(weekOffset = 0) {
  const today = new Date();
  const year = today.getFullYear();
  
  // 今年の全レースIDを生成（主要3場のみ）
  const raceIds = generateYearRaceIds(String(year), ['05', '06', '08', '09']);
  
  return raceIds;
}

/**
 * レースIDの妥当性をチェック
 * @param {string} raceId - レースID
 * @returns {boolean} 妥当性
 */
export function isValidRaceId(raceId) {
  if (!raceId || raceId.length !== 12) return false;
  
  const parsed = parseRaceId(raceId);
  if (!parsed) return false;
  
  // 競馬場コードチェック
  if (!VENUE_CODES[parsed.venueCode]) return false;
  
  // 範囲チェック
  if (parsed.kai < 1 || parsed.kai > 6) return false;
  if (parsed.kaisaiDay < 1 || parsed.kaisaiDay > 12) return false;
  if (parsed.raceNumber < 1 || parsed.raceNumber > 12) return false;
  
  return true;
}

// テスト実行
if (import.meta.url === `file:///${(process.argv[1]||'').replace(/\\/g, '/')}`) {
  console.log("=== レースID生成ユーティリティ テスト ===\n");
  
  // 1. レースID生成
  console.log("【1】レースID生成");
  const raceId = generateRaceId('2025', '08', 4, 6, 11);
  console.log(`生成: ${raceId}`);
  console.log(`パース:`, parseRaceId(raceId));
  
  // 2. 今年のレースID生成
  console.log("\n【2】2025年のレースID（最初の10件）");
  const yearIds = generateYearRaceIds('2025', ['05']);
  console.log(`総数: ${yearIds.length}件`);
  yearIds.slice(0, 10).forEach((id, i) => {
    const parsed = parseRaceId(id);
    console.log(`${i + 1}. ${id} - ${parsed.venueName} ${parsed.kai}回${parsed.kaisaiDay}日目 ${parsed.raceNumber}R`);
  });
  
  // 3. 妥当性チェック
  console.log("\n【3】妥当性チェック");
  console.log(`${raceId}: ${isValidRaceId(raceId)}`);
  console.log(`202508040611: ${isValidRaceId('202508040611')}`);
  console.log(`invalid: ${isValidRaceId('invalid')}`);
}
