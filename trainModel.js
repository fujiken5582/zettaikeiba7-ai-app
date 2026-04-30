import axios from "axios";
import * as cheerio from "cheerio";

export async function fetchRaceResult(raceUrl) {
  try {
    // JRAの結果ページURLに変換
    const resultUrl = raceUrl.replace("shutuba", "result");

    const res = await axios.get(resultUrl, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
      } 
    });
    const $ = cheerio.load(res.data);

    const data = [];

    // JRAサイトの結果テーブルに対応
    $("table tr").each((i, el) => {
      try {
        const cells = $(el).find("td");
        if (cells.length >= 8) {
          data.push({
            着順: $(cells[0]).text().trim(),
            馬番: $(cells[1]).text().trim(),
            馬名: $(cells[2]).text().trim(),
            騎手: $(cells[3]).text().trim(),
            タイム: $(cells[4]).text().trim(),
            上り: $(cells[5]).text().trim(),
            単勝オッズ: $(cells[6]).text().trim(),
            人気: $(cells[7]).text().trim(),
            race_url: raceUrl
          });
        }
      } catch {}
    });

    console.log(`レース結果データ: ${data.length}件`);
    return data;
  } catch (error) {
    console.error("レース結果の取得に失敗:", error.message);
    return [];
  }
}
