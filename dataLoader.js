import { fetchRaceList } from "./raceList.js";
import { fetchShutuba } from "./shutuba.js";
import { fetchRaceResult } from "./raceResult.js";
import { upsertData } from "../db/supabaseClient.js";

export async function runScraping() {
  console.log("スクレイピング開始...");
  
  const raceList = await fetchRaceList();
  console.log(`${raceList.length}件のレースを取得`);

  for (const race of raceList) {
    console.log(`処理中: ${race.race_name}`);
    
    const shutuba = await fetchShutuba(race.race_url);
    const result = await fetchRaceResult(race.race_url);

    await upsertData("shutuba", shutuba);
    await upsertData("race_results", result);
    
    // サーバー負荷軽減のため待機
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log("スクレイピング完了");
}

runScraping();
