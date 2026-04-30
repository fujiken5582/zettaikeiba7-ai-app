// AI競馬予測モデル v2（493,826件学習済み）
import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export const modelInfo = {
  name: 'AI競馬予測 SuperModel v2',
  version: '2.0.0',
  description: '人気除外・実力ベース予測（馬体重/タイム/上り/馬場/ペース指数等26特徴量、493,826件学習）',
  accuracy: { first: 0.4612, top3: 0.6176 },
  trainSize: 493826
};

export function predictRace(horses, trainerStats, sireStats) {
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
      console.error('前後50文字:', JSON.stringify(rawStr.substring(Math.max(0,pos-50), pos+50)));
      console.error('全出力先頭200:', rawStr.substring(0, 200));
      throw parseErr;
    }
    // 新形式: {horses, isShowdown, showdownReason}
    if (raw.horses) {
      console.log(`✅ Python予測完了: ${raw.horses.length}頭 勝負レース:${raw.isShowdown}`);
      return raw;
    }
    // 旧形式: 配列
    console.log(`✅ Python予測完了: ${raw.length}頭`);
    return { horses: raw, isShowdown: false, showdownReason: '' };
  } catch (e) {
    console.error('Python予測エラー:', e.message?.substring(0, 300));
    console.error('⚠️ Python予測失敗 - fallbackに切り替え');
    return fallbackPredict(horses);
  }
}

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
    return { ...h, score: parseFloat(score.toFixed(2)), confidence };
  });
  return scored.sort((a, b) => b.score - a.score);
}
