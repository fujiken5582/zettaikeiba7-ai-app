#!/usr/bin/env node
/**
 * 毎週土曜朝に実行される自動投稿生成スクリプト
 * 1. RenderのAPIから今週のレース一覧を取得
 * 2. 各レースを予測
 * 3. 激熱レースを抽出
 * 4. X/note/Bluesky形式の投稿テキストを生成
 * 5. docs/index.html に公開
 * 6. Discordに通知
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const APP_URL = process.env.APP_URL || 'https://zettaikeiba7-ai-app-1.onrender.com';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';

// fetch代替（Node 18+はネイティブfetchあり）
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, timeout: 60000 });
  return await res.json();
}

async function fetchPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json();
}

// 日付フォーマット
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// 投稿テキスト生成（X用）
function generateXPost(date, races, showdownRaces) {
  const venues = [...new Set(races.map(r => r.venue))].join('・');
  let text = `🐎 ${date} ${venues} AI予測\n`;
  text += `📊 競馬予想AI ホライゾン\n\n`;

  if (showdownRaces.length > 0) {
    text += `🔥 激熱レース ${showdownRaces.length}件\n`;
    showdownRaces.slice(0, 3).forEach(r => {
      text += `▶${r.venue}${r.raceNum} ${r.raceName}\n`;
      text += ` ◎${r.top1Name}（${r.top1Jockey}）\n`;
      text += ` 📈AIスコア${r.top1Score} (差${r.gap})\n`;
    });
    text += `\n`;
  }

  text += `📋 全予測 → ${process.env.PAGES_URL || 'https://fujiken5582.github.io/zettai-atarukun/'}\n\n`;
  text += `#競馬予想 #AI予想 #ホライゾン #競馬`;

  return text;
}

// note用Markdown生成
function generateNoteMarkdown(date, races, showdownRaces, venue) {
  let md = `# ${date} ${venue} AI競馬予測【ホライゾン】\n\n`;
  md += `競馬予想AI「ホライゾン」が${races.length}レース分の予測を実施しました。\n`;
  md += `機械学習モデル（学習データ49万件・特徴量52）による分析結果です。\n\n`;
  md += `---\n\n`;

  if (showdownRaces.length > 0) {
    md += `## 🔥 激熱レース\n\n`;
    md += `AIスコアが特に高く、上位馬との差が大きい注目レースです。\n\n`;
    showdownRaces.forEach(r => {
      md += `### ${r.venue}${r.raceNum}R ${r.raceName}\n\n`;
      md += `- **AI 1位推奨**: ${r.top1Name}（${r.top1Jockey}騎手）\n`;
      md += `- **AIスコア**: ${r.top1Score}\n`;
      md += `- **2位との差**: ${r.gap}\n\n`;
    });
    md += `---\n\n`;
  }

  md += `## 📊 全レース予測一覧\n\n`;
  md += `| R | レース名 | AI 1位 | スコア | 差 |\n`;
  md += `|---|---------|--------|--------|----|\n`;
  races.forEach(r => {
    const sd = r.isShowdown ? ' 🔥' : '';
    md += `| ${r.raceNum} | ${r.raceName} | ${r.top1Name}（${r.top1Jockey}）${sd} | ${r.top1Score} | ${r.gap} |\n`;
  });

  md += `\n---\n\n`;
  md += `## このAIについて\n\n`;
  md += `**ホライゾン** は競馬予想に特化したAIシステムです。\n\n`;
  md += `- 学習データ: 2015〜2025年の49万3826件\n`;
  md += `- 特徴量: 52種類（前走成績・馬体重・コース特性・騎手勝率など）\n`;
  md += `- モデル: HistGradientBoostingClassifier\n`;
  md += `- 1着的中率: 28.65% / 3着内的中率: 49.21%\n\n`;
  md += `※ 予想は当たることを保証するものではありません。馬券購入は自己責任でお願いします。\n\n`;
  md += `#競馬予想 #AI予想 #ホライゾン\n`;

  return md;
}

// Bluesky用テキスト
function generateBlueskyPost(date, showdownRaces) {
  let text = `🐎 ${date} AI競馬予測\n📊 競馬予想AI ホライゾン\n\n`;
  if (showdownRaces.length > 0) {
    text += `🔥 激熱 ${showdownRaces.length}件\n`;
    showdownRaces.slice(0, 2).forEach(r => {
      text += `▶${r.venue}${r.raceNum} ◎${r.top1Name}\n`;
    });
  }
  text += `\n全予測→ ${process.env.PAGES_URL || 'https://fujiken5582.github.io/zettai-atarukun/'}`;
  return text;
}

// Discord通知
async function notifyDiscord(date, races, showdownRaces) {
  if (!DISCORD_WEBHOOK) return;

  const embed = {
    title: `📩 ${date} AI予測 準備完了`,
    description: `今週は **${races.length}レース** の予測が完了しました。`,
    color: 0xf0c040,
    fields: [
      {
        name: '🔥 激熱レース',
        value: showdownRaces.length > 0
          ? showdownRaces.map(r => `**${r.venue}${r.raceNum}** ${r.raceName}\n　◎${r.top1Name}（差${r.gap}）`).join('\n\n')
          : '今週は激熱レースなし',
        inline: false
      },
      {
        name: '📋 投稿用テキスト',
        value: `[こちらをタップ → コピーして投稿](${process.env.PAGES_URL || 'https://fujiken5582.github.io/zettai-atarukun/'})`,
        inline: false
      }
    ],
    footer: { text: '競馬予想AI ホライゾン' },
    timestamp: new Date().toISOString()
  };

  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
  console.log('✅ Discord通知送信完了');
}

// HTML生成
function generateHtml(date, posts, races, showdownRaces) {
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xPost = escapeHtml(posts.x);
  const notePost = escapeHtml(posts.note);
  const bskyPost = escapeHtml(posts.bluesky);

  let raceTableRows = '';
  races.forEach(r => {
    const sd = r.isShowdown ? '🔥' : '';
    raceTableRows += `<tr><td>${escapeHtml(r.venue + r.raceNum)}</td><td>${escapeHtml(r.raceName)}</td><td><strong>${escapeHtml(r.top1Name)}</strong><br><span class="muted">${escapeHtml(r.top1Jockey)}</span></td><td>${r.top1Score}</td><td>${r.gap}</td><td>${sd}</td></tr>`;
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${date} 競馬予想AI ホライゾン</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, "Hiragino Sans", sans-serif; background: #0a0a14; color: #e8e8f0; line-height:1.6; min-height:100vh; }
.container { max-width: 800px; margin: 0 auto; padding: 24px 16px 80px; }
header { text-align:center; padding: 40px 0 30px; }
h1 { font-size: 28px; background: linear-gradient(135deg,#fff,#f0c040,#e8a000); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:6px; }
.sub { color: #888; font-size: 13px; letter-spacing: 0.1em; }
.section { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.section h2 { font-size: 15px; color:#f0c040; margin-bottom: 12px; letter-spacing: 0.05em; }
.post-box { position: relative; }
.post-text { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 14px; font-family: ui-monospace, monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; color: #ddd; }
.copy-btn { display: block; width: 100%; margin-top: 10px; background: linear-gradient(135deg,#f0c040,#e8a000); color: #000; font-weight: 700; border: none; border-radius: 8px; padding: 12px; font-size: 14px; cursor: pointer; transition: transform 0.2s; }
.copy-btn:hover { transform: translateY(-2px); }
.copy-btn.copied { background: linear-gradient(135deg,#10c070,#0d9050); color: #fff; }
.share-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.share-btn { flex:1; min-width:120px; text-align:center; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 10px; color: #ddd; text-decoration: none; font-size: 13px; transition: background 0.2s; }
.share-btn:hover { background: rgba(255,255,255,0.1); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: rgba(255,255,255,0.04); padding: 10px 8px; text-align: left; color: #888; font-size: 11px; letter-spacing: 0.1em; border-bottom: 1px solid rgba(255,255,255,0.1); }
td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.muted { color: #888; font-size: 11px; }
.showdown-row { background: rgba(255,100,0,0.08); }
.showdown-row td:first-child { border-left: 3px solid #ff8800; }
.note-link { display: inline-block; margin-top: 12px; color: #f0c040; text-decoration: underline; font-size: 13px; }
@media(max-width:600px) {
  h1 { font-size: 22px; }
  .section { padding: 16px; }
  .post-text { font-size: 12px; }
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🐎 ${date} 競馬予想AI ホライゾン</h1>
    <p class="sub">AI予測 ${races.length}レース / 激熱 ${showdownRaces.length}件</p>
  </header>

  <div class="section">
    <h2>𝕏 X用投稿（コピペで投稿）</h2>
    <div class="post-box">
      <div class="post-text" id="xText">${xPost}</div>
      <button class="copy-btn" onclick="copyToClipboard('xText', this)">📋 コピーする</button>
      <div class="share-row">
        <a class="share-btn" href="https://twitter.com/intent/tweet" target="_blank">𝕏で投稿</a>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>🦋 Bluesky用投稿</h2>
    <div class="post-box">
      <div class="post-text" id="bskyText">${bskyPost}</div>
      <button class="copy-btn" onclick="copyToClipboard('bskyText', this)">📋 コピーする</button>
      <div class="share-row">
        <a class="share-btn" href="https://bsky.app/" target="_blank">Blueskyで投稿</a>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>📝 note用記事（Markdown）</h2>
    <div class="post-box">
      <div class="post-text" id="noteText">${notePost}</div>
      <button class="copy-btn" onclick="copyToClipboard('noteText', this)">📋 コピーする</button>
      <div class="share-row">
        <a class="share-btn" href="https://note.com/notes/new" target="_blank">noteで投稿</a>
      </div>
    </div>
    <a class="note-link" href="https://note.com/notes/new" target="_blank">→ noteの新規記事作成画面を開く</a>
  </div>

  <div class="section">
    <h2>📊 全レース予測一覧</h2>
    <table>
      <thead>
        <tr><th>R</th><th>レース</th><th>AI 1位</th><th>スコア</th><th>差</th><th>判定</th></tr>
      </thead>
      <tbody>${raceTableRows}</tbody>
    </table>
  </div>
</div>

<script>
function copyToClipboard(id, btn) {
  const text = document.getElementById(id).innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ コピー完了！';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋 コピーする';
      btn.classList.remove('copied');
    }, 2500);
  });
}
</script>
</body>
</html>`;
}

// メイン処理
async function main() {
  console.log(`🚀 自動投稿生成開始 ${todayStr()}`);
  console.log(`APP_URL: ${APP_URL}`);

  // 1. 今週のレース一覧取得
  console.log('📋 レース一覧を取得中...');
  const raceList = await fetchJson(`${APP_URL}/api/race-list`);
  if (!raceList.success) throw new Error('レース一覧取得失敗');
  const allRaces = raceList.data || raceList.races || [];
  console.log(`✅ ${allRaces.length}レース取得`);

  // 2. 今日の日付（曜日問わず）= 取得対象
  const today = new Date();
  const dateMatch = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  console.log(`本日の日付: ${dateMatch}`);

  // 今日開催のJRAレースのみフィルタ
  // raceDataから情報を展開
  const flattenedRaces = allRaces.map(r => {
    const rd = r.raceData || {};
    return {
      raceId: r.raceId,
      raceName: r.raceName || rd.raceName || '',
      date: r.date,
      dateDisplay: r.dateDisplay,
      venue: r.venue || rd.venue || '',
      raceNum: rd.raceNum || rd.number || '',
      url: r.url
    };
  });
  console.log('サンプル:', JSON.stringify(flattenedRaces[0]));

  const todayRaces = flattenedRaces.filter(r => {
    const isJRA = r.raceId && /^\d{12}$/.test(r.raceId) && parseInt(r.raceId.substring(4,6)) < 30;
    return isJRA && r.dateDisplay === dateMatch;
  });
  console.log(`✅ 本日のJRA: ${todayRaces.length}レース`);

  if (todayRaces.length === 0) {
    console.log('⚠️ 本日開催のJRAレースなし。Discord通知してスキップ');
    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ content: `📭 ${todayStr()} 本日開催のJRAレースはありません` })
      });
    }
    return;
  }

  // 3. 各レースを予測
  const results = [];
  for (let i = 0; i < todayRaces.length; i++) {
    const race = todayRaces[i];
    process.stdout.write(`予測中 ${i+1}/${todayRaces.length}: ${race.venue}${race.raceNum}R...`);
    try {
      const fetchData = await fetchPost(`${APP_URL}/api/fetch-race`, { url: race.url || `https://race.netkeiba.com/race/shutuba_past.html?race_id=${race.raceId}` });
      if (!fetchData.success || !fetchData.data || !fetchData.data.horses) { console.log(' SKIP'); continue; }
      const predictData = await fetchPost(`${APP_URL}/api/predict`, { horses: fetchData.data.horses });
      if (!predictData.success || !predictData.predictions) { console.log(' SKIP'); continue; }
      const top1 = predictData.predictions[0];
      const top2 = predictData.predictions[1];
      const score1 = parseFloat(top1.aiScore || 0);
      const score2 = parseFloat(top2 ? top2.aiScore : 0);
      results.push({
        raceId: race.raceId,
        venue: race.venue,
        raceNum: race.raceNum,
        raceName: race.raceName || '',
        top1Name: top1.horseName,
        top1Jockey: (top1.details && top1.details.jockey) || '',
        top1Score: score1.toFixed(1),
        gap: (score1 - score2).toFixed(1),
        isShowdown: predictData.isShowdown || false,
      });
      console.log(' ✅');
    } catch(e) {
      console.log(` ❌ ${e.message}`);
    }
  }

  console.log(`\n✅ ${results.length}レース予測完了`);

  const showdownRaces = results.filter(r => r.isShowdown);
  console.log(`🔥 激熱レース: ${showdownRaces.length}件`);

  // 4. 投稿テキスト生成
  const date = todayStr();
  const venues = [...new Set(results.map(r => r.venue))].join('・');
  const posts = {
    x: generateXPost(date, results, showdownRaces),
    note: generateNoteMarkdown(date, results, showdownRaces, venues),
    bluesky: generateBlueskyPost(date, showdownRaces),
  };

  // 5. HTML生成・保存
  const html = generateHtml(date, posts, results, showdownRaces);
  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'index.html'), html);
  console.log('✅ docs/index.html 保存');

  // 履歴も保存
  const archiveName = `${date.replace(/\//g,'-')}.html`;
  fs.writeFileSync(path.join(docsDir, archiveName), html);
  console.log(`✅ docs/${archiveName} 保存`);

  // 6. Discord通知
  await notifyDiscord(date, results, showdownRaces);

  console.log('\n🎉 全処理完了');
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
