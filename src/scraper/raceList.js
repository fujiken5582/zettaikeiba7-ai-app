import axios from "axios";
import * as cheerio from "cheerio";

export async function fetchRaceList() {
  // JRA公式データベースから開催情報を取得
  const url = "https://www.jra.go.jp/JRADB/accessD.html";
  
  try {
    const res = await axios.get(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      } 
    });
    const $ = cheerio.load(res.data);

    const data = [];

    // JRAサイトの構造に合わせて調整
    $("a[href*='kaisai']").each((i, el) => {
      const name = $(el).text().trim();
      const link = $(el).attr("href");

      if (link && name) {
        data.push({
          race_name: name,
          race_url: link.startsWith("http") ? link : "https://www.jra.go.jp" + link
        });
      }
    });

    console.log(`取得したレース数: ${data.length}`);
    return data;
  } catch (error) {
    console.error("レース一覧の取得に失敗:", error.message);
    return [];
  }
}
