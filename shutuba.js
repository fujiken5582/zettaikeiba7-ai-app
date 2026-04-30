import axios from "axios";
import * as cheerio from "cheerio";

export async function fetchOdds(raceUrl) {
  const oddsUrl = raceUrl.replace("shutuba", "odds");

  const res = await axios.get(oddsUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const $ = cheerio.load(res.data);

  const data = [];

  $(".OddsTable tbody tr").each((i, el) => {
    try {
      data.push({
        馬番: $(el).find(".OddsT_Num").text().trim(),
        馬名: $(el).find(".OddsT_Horse a").text().trim(),
        単勝: $(el).find(".OddsT_Odds").text().trim(),
        人気: $(el).find(".OddsT_Popular").text().trim(),
        odds_url: oddsUrl
      });
    } catch {}
  });

  return data;
}
