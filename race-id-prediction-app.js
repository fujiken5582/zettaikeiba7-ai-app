// レースID入力でnetkeiba.comからデータ取得してAI予測
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { fetchShutubaTable, fetchWeekendRaceList } from './src/scraper/netkeibaRealScraper.js';
import { fetchShutubaPast } from './src/scraper/shutubaPastScraper.js';
import { predictRace, modelInfo } from './src/model/aiRacePredictor.js';

const app = express();
app.use(cors());
app.use(express.json());
// キャッシュ無効化（HTMLが常に最新で読み込まれるよう）
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static('.')); // 静的ファイルを提供

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
});;

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

    const duration = Date.now() - startTime;
    console.log(`✅ ${raceData.horses.length}頭のデータを取得しました (所要時間: ${duration}ms)`);

    res.json({
      success: true,
      data: raceData,
      meta: {
        fetchTime: duration,
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
      RPCI: paceRpci !== null ? paceRpci : (h.RPCI || 50),
      PCI: paceRpci !== null ? paceRpci : (h.PCI || 50),
    }));
    const predResult = predictRace(horsesWithManual, trainerStats, sireStats);
    // 新形式 or 旧形式に対応
    const predHorses = predResult.horses || predResult;
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
          popularity: horse.popularity,
          aiScore: score.toFixed(2),
          confidence: (confidence * 100).toFixed(1) + '%',
          recommendation: i < 3 ? '◎○▲'[i] : '',
          isTopJockey,
          jockeyWinRate: (jockeyWinRate * 100).toFixed(1) + '%',
          odds: horse.odds || null,
          popularity: horse.popularity || null,
          expectedValue: horse.expectedValue || null,
          evLabel: horse.evLabel || 'オッズ未発表',
          isBuy: horse.isBuy || null,
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
import { join as _join } from 'path';
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
  console.error('❌ Python/Modelチェック失敗:', _e.message.substring(0,300));
}

app.listen(PORT, () => {
  console.log(`\n🚀 サーバー起動完了!`);
  console.log(`\nAPI エンドポイント:`);
  console.log(`  GET  /api/race-list - 今週のレース一覧`);
  console.log(`  POST /api/fetch-race - レースデータ取得`);
  console.log(`  POST /api/predict - レース予測`);
  console.log(`  GET  /api/model-info - モデル情報`);
  console.log(`\nWebインターフェース: http://localhost:${PORT}/race-id-viewer.html`);
});
