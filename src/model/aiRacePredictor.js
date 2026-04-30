// AI競馬予測モデル v2（493,826件学習済み）
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export const modelInfo = {
  name: 'AI競馬予測 SuperModel v2 (5runs-extended)',
  version: '2.2.0',
  description: '過去5走集計を追加した拡張モデル（61特徴量、394,135件学習）',
  // 時系列バックテスト実測値（2015-2023.2 train, 2023.3-2025 test, 7,294レース）
  // 過去5走集計の追加で 1着的中率 +6.11pt 改善
  accuracy: { first: 0.3230, top3: 0.6374 },
  // 単勝回収率（実測・過去5走拡張版）
  // - score>=35 で買い: 約100% 前後（ブレあり）
  // - EV>=1.25  で買い: 約75-85%（控除率20%の壁）
  trainSize: 394135
};

/**
 * レース予測のメイン関数。
 * Python (predict_v2.py) を呼び出して予測を行う。失敗時は fallbackPredict() を使用。
 * 戻り値は常に { horses, isShowdown, showdownReason, betSummary } の形式。
 */
export function predictRace(horses) {
  const modelPath = join(ROOT, 'model_v2.pkl');
  const scriptPath = join(ROOT, 'predict_v2.py');

  if (!existsSync(modelPath) || !existsSync(scriptPath)) {
    console.log('⚠️ v2モデルが見つかりません。フォールバックを使用');
    return fallbackPredict(horses);
  }

  // pythonコマンドを動的に解決（Render等の環境対応）
  const pythonCmd = process.env.PYTHON_CMD || 'python3';

  try {
    const input = JSON.stringify(horses);
    const result = execFileSync(pythonCmd, [scriptPath], {
      input,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    const rawStr = result.toString('utf8');
    let raw;
    try {
      raw = JSON.parse(rawStr);
    } catch (parseErr) {
      // エラー位置の前後を出力してデバッグ
      const pos = parseInt((parseErr.message.match(/position (\d+)/) || [])[1] || 0);
      console.error('JSON parseエラー位置:', pos);
      console.error('前後50文字:', JSON.stringify(rawStr.substring(Math.max(0, pos - 50), pos + 50)));
      console.error('全出力先頭200:', rawStr.substring(0, 200));
      throw parseErr;
    }
    // 新形式: {horses, isShowdown, showdownReason, betSummary}
    if (raw && raw.horses) {
      console.log(`✅ Python予測完了: ${raw.horses.length}頭 勝負レース:${raw.isShowdown}`);
      return {
        horses: raw.horses,
        isShowdown: raw.isShowdown || false,
        showdownReason: raw.showdownReason || '',
        betSummary: raw.betSummary || []
      };
    }
    // 旧形式: 配列のまま返ってきた場合のフォールバック
    if (Array.isArray(raw)) {
      console.log(`✅ Python予測完了: ${raw.length}頭（旧形式）`);
      return { horses: raw, isShowdown: false, showdownReason: '', betSummary: [] };
    }
    throw new Error('Python予測の戻り値形式が不正です');
  } catch (e) {
    console.error('Python予測エラー:', e.message?.substring(0, 300));
    console.error('⚠️ Python予測失敗 - fallbackに切り替え');
    return fallbackPredict(horses);
  }
}

/**
 * Python実行不可時のフォールバック予測。
 * 戻り値の形式は predictRace() と同じ {horses, isShowdown, showdownReason, betSummary}。
 */
function fallbackPredict(horses) {
  const scored = horses.map(h => {
    let score = 50;
    const last3f = parseFloat(h.last3F) || 38;
    score += (42 - last3f) * 2;
    const wc = parseFloat(h.weightChange) || 0;
    score -= Math.abs(wc) * 0.05;
    const prevRank = parseInt(h.previousRank) || 5;
    score += Math.max(0, 6 - prevRank) * 1.5;
    const kinryo = parseFloat(h.kinryo) || 55;
    score += (57 - kinryo) * 0.3;
    const confidence = Math.max(0.01, Math.min(0.99, score / 100));
    return {
      ...h,
      score: parseFloat(score.toFixed(2)),
      confidence,
      // 期待値・推奨フィールドはPython側と整合させて空でセット
      expectedValue: null,
      evLabel: 'オッズ未発表',
      isBuy: null,
      betTypes: [],
      betReason: 'なし',
      isTopJockey: false,
      jockeyWinRate: 0
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    horses: scored,
    isShowdown: false,
    showdownReason: '（フォールバック予測のため勝負レース判定なし）',
    betSummary: []
  };
}
