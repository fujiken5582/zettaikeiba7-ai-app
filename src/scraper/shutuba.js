import axios from "axios";
import * as cheerio from "cheerio";

export async function fetchShutuba(raceUrl) {
  try {
    const res = await axios.get(raceUrl, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
      } 
    });
    const $ = cheerio.load(res.data);

    const data = [];

    // JRAサイトのテーブル構造に対応
    $("table tr").each((i, el) => {
      try {
        const cells = $(el).find("td");
        if (cells.length >= 4) {
          data.push({
            馬番: $(cells[0]).text().trim(),
            馬名: $(cells[1]).text().trim(),
            騎手: $(cells[2]).text().trim(),
            オッズ: $(cells[3]).text().trim(),
            race_url: raceUrl
          });
        }
      } catch {}
    });

    console.log(`出馬表データ: ${data.length}件`);
    return data;
  } catch (error) {
    console.error("出馬表の取得に失敗:", error.message);
    return [];
  }
}
