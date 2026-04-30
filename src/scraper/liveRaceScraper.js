// リアルタイムレーススクレイパー
import axios from "axios";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

// JRAページを取得（Shift-JIS対応）
async function fetchJRAPage(url) {
  const res = await axios.get(url, { 
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    responseType: "arraybuffer"
  });
  const html = iconv.decode(Buffer.from(res.data), "Shift_JIS");
  return cheerio.load(html);
}

// 今日の開催情報を取得
export async function fetchTodayRaces() {
  console.log("📅 今日の開催情報を取得中...");
  
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  
  // JRAの開催情報ページ
  const url = `https://www.jra.go.jp/keiba/calendar/`;
  
  try {
    const $ = await fetchJRAPage(url);
    
    const venues = [];
    
    // 開催場を抽出
    $("a").each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href");

      
      if (text.includes("競馬場") && href) {
        venues.push({
          name: text,
          url: href.startsWith("http") ? href : "https://www.jra.go.jp" + href
        });
      }
    });
    
    console.log(`✅ ${venues.length}箇所の開催場を検出`);
    return venues;
    
  } catch (error) {
    console.error("❌ エラー:", error.message);
    return generateMockTodayRaces();
  }
}

// モックデータ生成（JRAサイトにアクセスできない場合）
function generateMockTodayRaces() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][today.getDay()];
  
  const venues = ["東京", "中山", "阪神"];
  const races = [];
  
  venues.forEach((venue, vIndex) => {
    for (let r = 1; r <= 12; r++) {
      const raceTime = new Date(today);
      raceTime.setHours(10 + Math.floor(r / 4), (r % 4) * 15, 0);
      
      races.push({
        venue: venue,
        raceNumber: r,
        raceName: `第${r}レース`,
        date: dateStr,
        dayOfWeek: dayOfWeek,
        fullDate: today.toISOString().split('T')[0],
        time: raceTime.toTimeString().slice(0, 5),
        distance: `${1200 + r * 100}m`,
        surface: r % 2 === 0 ? "芝" : "ダート",
        horses: generateMockHorses(r)
      });
    }
  });
  
  return races;
}

// モック出馬表生成
function generateMockHorses(raceNum) {
  const jockeys = ["武豊", "川田将雅", "ルメール", "福永祐一", "横山武史", "戸崎圭太", "岩田康誠", "池添謙一"];
  const horses = [];
  const horseCount = 12 + (raceNum % 6);
  
  for (let i = 1; i <= horseCount; i++) {
    horses.push({
      馬番: i,
      馬名: `サンプルホース${i}号`,
      騎手: jockeys[i % jockeys.length],
      オッズ: (2.5 + Math.random() * 50).toFixed(1),
      人気: i
    });
  }
  
  return horses;
}

// 全レース情報を取得
export async function fetchAllRacesToday() {
  console.log("🏇 本日の全レース情報を取得中...\n");
  
  const races = generateMockTodayRaces();
  
  console.log(`✅ ${races.length}レースのデータを生成`);
  return races;
}
