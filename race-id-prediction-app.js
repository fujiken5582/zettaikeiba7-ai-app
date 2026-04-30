// レースID入力でnetkeiba.comからデータ取得してAI予測
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { fetchShutubaTable, fetchWeekendRaceList } from './src/scraper/netkeibaRealScraper.js';
import { predictRace, modelInfo } from './src/model/aiRacePredictor.js';

const app = express();

// === パフォーマンス最適化 ===
app.use(compression()); // gzip圧縮（HTML/JSON/CSS全て）
app.use(cors());
app.use(express.json());

// キャッシュ制御:
// - HTML: 常に最新（更新が即反映）
// - JSON/モデルファイル/静的アセット: 1時間キャッシュ
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (req.path.match(/\.(json|css|js|png|jpg|svg|pkl)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  next();
});
app.use(express.static('.', { etag: true, lastModified: true }));

// === レース取得結果のメモリキャッシュ（5分間TTL）===
// 効果: 2回目以降のスクレイピング時間 2-5秒 → 0ms
const raceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
function getCachedRace(raceId) {
  const e = raceCache.get(raceId);
  if (e && Date.now() - e.t < CACHE_TTL_MS) return e.data;
  if (e) raceCache.delete(raceId);
  return null;
}
function setCachedRace(raceId, data) {
  if (raceCache.size >= 50) {
    const oldest = [...raceCache.entries()].sort((a,b)=>a[1].t-b[1].t)[0];
    if (oldest) raceCache.delete(oldest[0]);
  }
  raceCache.set(raceId, { data, t: Date.now() });
}

// リクエストロギングミドルウェア
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ヘルスチェックエンドポイント
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ルートパス
app.get('/', (req, res) => {
  res.redirect('/race-id-viewer.html');
});

console.log("=== レースID予測アプリ起動 ===\n");
console.log("✅ AIモデルを読み込みました");
console.log(`モデル精度: 1着的中率 ${(modelInfo.accuracy.first * 100).toFixed(2)}%\n`);

// 統計情報を読み込み
console.log("📊 統計情報を読み込み中...");
let trainerStats = {};
let sireStats = {};
let jockeyStats = {};

try {
  const statsData = JSON.parse(fs.readFileSync('./race-statistics.json', 'utf-8'));
  trainerStats = statsData.trainerStats || {};
  jockeyStats = statsData.jockeyStats || {};
  const meta = statsData.metadata || {};

  console.log(`✅ 統計情報を読み込みました`);
  console.log(`  騎手: ${Object.keys(jockeyStats).length}人`);
  console.log(`  調教師: ${Object.keys(trainerStats).length}人`);
  console.log(`  馬名: ${(meta.horseCount || 0).toLocaleString()}頭`);
  console.log(`  期間: ${meta.dateRange || ''}`);
  console.log(`  総レコード: ${(meta.totalRecords || 0).toLocaleString()}件\n`);
} catch (error) {
  console.log(`⚠️  統計ファイルが見つかりません。デフォルト値を使用します\n`);
}

// API: 今週のレース一覧を取得
app.get('/api/race-list', async (req, res) => {
  try {
    console.log('今週のレース一覧を取得リクエスト');
    const races = await fetchWeekendRaceList();
    console.log(`取得完了: ${races.length}件`);

    // データをサニタイズして送信
    const cleanRaces = races.map(r => ({
      raceId: r.raceId,
      raceName: r.raceName,
      date: r.date,
      dateDisplay: r.dateDisplay,
      venue: r.venue,
      raceData: r.raceData,
      url: r.url
    }));

    res.json({
      success: true,
      data: cleanRaces,
      count: cleanRaces.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('レース一覧取得エラー:', error);
    res.status(500).json({
      error: 'レース一覧の取得に失敗しました',
      message: error.message,
      stack: error.stack
    });
  }
});

// API: URLからデータ取得
app.post('/api/fetch-race', async (req, res) => {
  const startTime = Date.now();
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URLが必要です' });
    }

    console.log(`URL ${url} からデータを取得中...`);

    // URLからレースIDを抽出（地方競馬は12桁以外の場合もある）
    const raceIdMatch = url.match(/race_id=(\d+)/);
    if (!raceIdMatch) {
      return res.status(400).json({ error: 'URLからレースIDを抽出できません' });
    }

    const raceId = raceIdMatch[1];
    console.log(`抽出されたレースID: ${raceId}`);

    // === キャッシュチェック（5分以内なら即返答）===
    const cached = getCachedRace(raceId);
    if (cached) {
      const duration = Date.now() - startTime;
      console.log(`✅ キャッシュヒット ${raceId} (${duration}ms)`);
      return res.json({
        success: true,
        data: cached,
        meta: { fetchTime: duration, cached: true, timestamp: new Date().toISOString() }
      });
    }

    // fetchShutubaTable が中央・地方を自動判定して取得
    let raceData;
    try {
      console.log('出馬表を取得します（中央・地方自動判定）');
      raceData = await fetchShutubaTable(raceId);
    } catch (scrapeError) {
      console.error('スクレイピング処理中にエラーが発生:', scrapeError);
      throw new Error(`データ取得に失敗しました: ${scrapeError.message}`);
    }

    if (!raceData || !raceData.horses || raceData.horses.length === 0) {
      return res.status(404).json({
        error: 'レースデータが見つかりません。出馬表未確定またはURLが正しくない可能性があります。',
        details: raceData ? `レース名:${raceData.raceName} 馬数:${raceData.horses ? raceData.horses.length : 0}` : 'データなし'
      });
    }

    // 取得成功 → キャッシュ保存
    setCachedRace(raceId, raceData);

    const duration = Date.now() - startTime;
    console.log(`✅ ${raceData.horses.length}頭のデータを取得しました (所要時間: ${duration}ms)`);

    res.json({
      success: true,
      data: raceData,
      meta: {
        fetchTime: duration,
        cached: false,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`レースデータ取得エラー (${duration}ms):`, error);
    res.status(500).json({
      error: 'サーバー内部エラーが発生しました',
      details: error.message
    });
  }
});

// API: レース予測
app.post('/api/predict', (req, res) => {
  try {
    const { horses } = req.body;

    if (!horses || !Array.isArray(horses)) {
      return res.status(400).json({ error: '馬データが必要です' });
    }

    // manual_babaをhorsesの各要素に伝播（フロントから送られてくる）
    // ペース調整
    const manualPace = horses[0]?.manual_pace || '';
    const paceRpci = manualPace === 'slow' ? 55 : manualPace === 'high' ? 43 : null;
    const horsesWithManual = horses.map(h => ({
      ...h,
      RPCI: paceRpci !== null ? paceRpci : (h.RPCI ?? 50),
      PCI: paceRpci !== null ? paceRpci : (h.PCI ?? 50),
    }));
    const predResult = predictRace(horsesWithManual);
    // predictRaceは常に {horses, isShowdown, showdownReason, betSummary} を返す
    const predHorses = predResult.horses || [];
    const isShowdown = predResult.isShowdown || false;
    const showdownReason = predResult.showdownReason || '';
    const betSummary = predResult.betSummary || [];
    res.json({
      success: true,
      isShowdown,
      showdownReason,
      betSummary,
      modelInfo: {
        name: modelInfo.name,
        version: modelInfo.version,
        accuracy: {
          first: (modelInfo.accuracy.first * 100).toFixed(2) + '%',
          top3: (modelInfo.accuracy.top3 * 100).toFixed(2) + '%'
        }
      },
      predictions: predHorses.map((p, i) => {
        // p は馬オブジェクト直接（name, score, confidence など）
        const horse = p.horse || p;
        const isTopJockey = p.isTopJockey || false;
        const jockeyWinRate = p.jockeyWinRate || 0;
        const score = typeof p.score === 'number' ? p.score : parseFloat(p.score) || 0;
        const confidence = typeof p.confidence === 'number' ? p.confidence : score / 100;
        return {
          rank: i + 1,
          horseName: horse.name || horse.horseName || '不明',
          horseNumber: horse.horseNumber,
          popularity: horse.popularity ?? null,
          aiScore: score.toFixed(2),
          confidence: (confidence * 100).toFixed(1) + '%',
          recommendation: i < 3 ? '◎○▲'[i] : '',
          isTopJockey,
          jockeyWinRate: (jockeyWinRate * 100).toFixed(1) + '%',
          odds: horse.odds ?? null,
          expectedValue: horse.expectedValue ?? null,
          evLabel: horse.evLabel || 'オッズ未発表',
          isBuy: horse.isBuy ?? null,
          details: {
            weight: horse.weight,
            age: horse.age,
            sex: horse.sex,
            kinryo: horse.kinryo,
            previousRank: horse.previousRank,
            last3F: horse.last3F,
            trainer: horse.trainer,
            sire: horse.sire,
            jockey: horse.jockey
          }
        };
      })
    });

    console.log(`予測実行: ${horses.length}頭`);

  } catch (error) {
    console.error('予測エラー:', error);
    res.status(500).json({ error: '予測に失敗しました' });
  }
});

// API: モデル情報
app.get('/api/model-info', (req, res) => {
  res.json({
    success: true,
    model: {
      name: modelInfo.name,
      version: modelInfo.version,
      trainedRaces: modelInfo.trainedRaces,
      accuracy: {
        first: (modelInfo.accuracy.first * 100).toFixed(2) + '%',
        top3: (modelInfo.accuracy.top3 * 100).toFixed(2) + '%'
      },
      createdAt: modelInfo.createdAt
    }
  });
});

const PORT = process.env.PORT || 3004;
// 起動前にpython3とモデルを確認
import { execFileSync as _execCheck } from 'child_process';
const _ROOT = new URL('.', import.meta.url).pathname;
try {
  const _py = process.env.PYTHON_CMD || 'python3';
  const _ver = _execCheck(_py, ['--version'], {timeout:5000}).toString().trim();
  console.log('✅ Python:', _ver);
  const _mcheck = _execCheck(_py, ['-c',
    'import pickle; d=pickle.load(open("model_v2.pkl","rb")); print("features:"+str(len(d["features"]))+" win:"+str(round(d["win_rate"]*100,2))+"%")'
  ], {timeout:15000, cwd:_ROOT}).toString().trim();
  console.log('✅ Model:', _mcheck);
} catch(_e) {
  console.error('⚠️  Python/Modelチェック失敗:', _e.message.substring(0,300));
  console.error('   → 予測実行時にフォールバックモードで動作します');
}

const server = app.listen(PORT, async () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 サーバー起動完了!`);
  console.log(`${'='.repeat(50)}`);
  console.log(`\n📱 ブラウザで以下のURLを開いてください:`);
  console.log(`   http://localhost:${PORT}/race-id-viewer.html\n`);

  // LAN内のスマホ等から繋ぐためのIPアドレスも表示
  try {
    const os = await import('os');
    const nets = os.networkInterfaces();
    const lanIps = [];
    for (const name of Object.keys(nets)) {
      for (const net of (nets[name] || [])) {
        if (net.family === 'IPv4' && !net.internal) lanIps.push(net.address);
      }
    }
    if (lanIps.length > 0) {
      console.log(`📲 同じWi-Fiのスマホ・タブレットからは↓のURLでアクセス可能:`);
      lanIps.forEach(ip => console.log(`   http://${ip}:${PORT}/race-id-viewer.html`));
      console.log(`   ※ Windowsの場合、ファイアウォールで Node.js を許可してください\n`);
    }
  } catch (e) { /* IP取得失敗時は無視 */ }

  console.log(`💡 起動スクリプト経由なら自動でブラウザが開きます`);
  console.log(`🛑 停止するには Ctrl+C を押してください\n`);

  // === コールドスタート対策（Render無料版用）===
  // RENDER_EXTERNAL_URL が設定されていれば、14分おきに自己pingしてスリープを防ぐ
  if (process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/,'')}/api/health`;
    console.log(`🔄 自己ping機能を有効化: 14分ごとに ${pingUrl}`);
    setInterval(() => {
      const lib = pingUrl.startsWith('https:') ? https : http;
      const req = lib.get(pingUrl, (res) => {
        console.log(`[self-ping] ${new Date().toISOString()} status=${res.statusCode}`);
        res.resume();
      });
      req.on('error', (e) => console.error(`[self-ping] error: ${e.message}`));
      req.setTimeout(10000, () => req.destroy());
    }, 14 * 60 * 1000);
  }
});

// ポート競合などの起動エラー処理
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ポート ${PORT} は既に使用されています`);
    console.error(`\n解決方法:`);
    console.error(`  1. 既に動いているサーバーを停止する`);
    console.error(`     → 別のターミナル/コマンドプロンプトで Ctrl+C`);
    console.error(`  2. または別のポートで起動する:`);
    console.error(`     Windows: set PORT=3005 && node race-id-prediction-app.js`);
    console.error(`     Mac/Linux: PORT=3005 node race-id-prediction-app.js`);
  } else {
    console.error(`\n❌ サーバー起動エラー: ${err.message}`);
  }
  process.exit(1);
});

// 終了シグナルを綺麗に処理
process.on('SIGINT', () => {
  console.log(`\n\n👋 サーバーを停止しました`);
  server.close(() => process.exit(0));
});
