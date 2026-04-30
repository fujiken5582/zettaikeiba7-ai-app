// 馬柱付き出馬表（shutuba_past.html）のスクレイパー
// race.netkeiba.com（中央）・nar.netkeiba.com（地方）両対応
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getVenueName(code) {
  const venues = {
    "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
    "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
    // 地方競馬
    "30": "門別", "31": "岩手", "32": "浦和", "33": "船橋", "34": "大井",
    "35": "川崎", "36": "金沢", "37": "笠松", "38": "名古屋", "39": "園田",
    "40": "姫路", "41": "高知", "42": "佐賀"
  };
  return venues[code] || "競馬場";
}

export async function fetchShutubaPast(url) {
  try {
    console.log(`🐴 馬柱付き出馬表を取得中: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': url.includes('nar.') 
          ? 'https://nar.netkeiba.com/top/' 
          : 'https://race.netkeiba.com/top/'
      },
      responseType: 'arraybuffer',
      timeout: 15000
    });

    const html = iconv.decode(Buffer.from(response.data), 'EUC-JP');
    const $ = cheerio.load(html);

    const raceTitle = $('.RaceName').first().text().trim()
      || $('.race_name').first().text().trim()
      || 'レース';

    const raceDataText = $('.RaceData01').first().text().trim()
      || $('.race_data').first().text().trim();

    const raceIdMatch = url.match(/race_id=(\d+)/);
    const raceId = raceIdMatch ? raceIdMatch[1] : '';

    const distanceMatch = raceDataText.match(/(\d+)m/);
    const distance = distanceMatch ? parseInt(distanceMatch[1]) : 1600;

    const surfaceMatch = raceDataText.match(/(芝|ダート|ダ)/);
    const surface = surfaceMatch
      ? (surfaceMatch[1].startsWith('ダ') ? 'ダ' : '芝')
      : 'ダ'; // 地方はほぼダート

    const conditionMatch = raceDataText.match(/(良|稍重|重|不良)/);
    const condition = conditionMatch
      ? conditionMatch[1].replace('稍重', '稍').replace('不良', '不')
      : '良';

    const placeCode = raceId.substring(4, 6);
    const venue = getVenueName(placeCode);

    const horses = [];

    // セレクタを複数試す
    const rowSelectors = [
      'table.Shutuba_Table tbody tr',
      '#shutuba_table tbody tr',
      '.Shutuba_Table tr',
      'table.ShutubaTable tbody tr',
      'table tbody tr'
    ];

    for (const sel of rowSelectors) {
      $(sel).each((index, element) => {
        const $row = $(element);
        const cells = $row.find('td');
        if (cells.length < 5) return;

        // 馬番
        const horseNumber = parseInt(cells.eq(1).text().trim()) || 0;
        if (!horseNumber || horseNumber > 20) return;

        // 馬名
        const cell3 = cells.eq(3);
        const cell3Text = cell3.text();
        const horseName = cell3.find('.HorseName, a[href*="/horse/"]').first().text().trim()
          || cell3Text.split('\n').map(l => l.trim()).filter(l => l.length >= 2 && /[ぁ-ヿ\u4e00-\u9fff]/.test(l))[0]
          || '';
        if (!horseName) return;

        // 性齢
        const cell4Text = cells.eq(4).text().trim();
        const sexMatch = cell4Text.match(/([牡牝セ騸])/);
        const sex = sexMatch ? sexMatch[1] : '牡';
        const ageMatch = cell4Text.match(/(\d+)/);
        const age = ageMatch ? parseInt(ageMatch[1]) : 4;

        // 斤量
        const kinryoText = cells.eq(5).text().trim();
        const kinryoMatch = kinryoText.match(/(\d+\.?\d*)/);
        const kinryo = kinryoMatch ? parseFloat(kinryoMatch[1]) : 55;

        // 騎手
        const jockeyCell = cells.eq(6);
        const jockey = jockeyCell.find('a').text().trim() || jockeyCell.text().trim() || '未定';

        // 調教師
        const trainerCell = cells.eq(7);
        const trainer = trainerCell.find('a').text().trim() || trainerCell.text().trim() || '未定';

        // 馬体重
        const weightCell = cells.eq(8);
        const weightText = weightCell.text().trim();
        const weightMatch = weightText.match(/(\d{3,4})\(([+-]?\d+)\)/);
        const weight = weightMatch ? parseInt(weightMatch[1]) : 480;
        const weightChange = weightMatch ? parseInt(weightMatch[2]) : 0;

        // 父馬
        const sireText = cell3Text;
        const sireMatch = sireText.match(/\((.+?)\)/);
        const sire = sireMatch ? sireMatch[1].trim() : '不明';

        // 過去成績（馬柱）
        const pastRaces = [];
        for (let i = 9; i < Math.min(cells.length, 15); i++) {
          const pastText = cells.eq(i).text().trim();
          const rankMatch = pastText.match(/(\d+)/);
          if (rankMatch) pastRaces.push({ rank: rankMatch[1] });
        }

        horses.push({
          name: horseName,
          horseNumber,
          popularity: horseNumber,
          weight,
          weightChange,
          age,
          sex,
          kinryo,
          jockey,
          trainer,
          sire,
          previousRank: pastRaces.length > 0 ? pastRaces[0].rank : '5',
          last3F: 0,
          corner4: 0,
          interval: 30,
          surface,
          distance,
          condition
        });
      });

      if (horses.length > 0) break;
    }

    console.log(`✅ ${horses.length}頭のデータを取得しました`);

    return {
      raceId,
      raceName: raceTitle,
      raceInfo: {
        raceName: raceTitle,
        distance: `${distance}m`,
        surface: surface === 'ダ' ? 'ダート' : '芝',
        condition,
        date: new Date().toLocaleDateString('ja-JP')
      },
      venueName: venue,
      horses
    };

  } catch (error) {
    console.error('馬柱付き出馬表の取得エラー:', error.message);
    throw error;
  }
}
