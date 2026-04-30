#!/usr/bin/env python3
import sys, io
# Windows環境でのUTF-8強制（cp932化けを防ぐ）
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
"""
競馬予測スクリプト v3
- 騎手勝率をモデルが機械学習（後処理加点なし）
- コース（場所コード）をモデルが学習
- 地方騎手も統計から自動取得
- 少頭数レース（9頭以下）は勝負レース対象外
- nullはNaN→HistGBCが自動補完（ダミー値なし）
"""
import sys, json, pickle, numpy as np, os

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model_v2.pkl')
STATS_PATH = os.path.join(os.path.dirname(__file__), 'race-statistics.json')

with open(MODEL_PATH, 'rb') as f:
    data = pickle.load(f)

model = data['model']
features = data['features']
medians = data['medians']
jockey_win_rates = data.get('jockey_win_rates', {})
jockey_counts = data.get('jockey_counts', {})
avg_wr = 0.072  # 全体平均勝率

# 統計情報（トップ騎手バッジ表示用）
top_jockeys = []
jockey_stats_disp = {}
try:
    with open(STATS_PATH, encoding='utf-8') as f:
        stats = json.load(f)
    top_jockeys = stats.get('topJockeys', [])
    jockey_stats_disp = stats.get('jockeyStats', {})
except (FileNotFoundError, json.JSONDecodeError, OSError):
    pass

def pn(x):
    if x is None: return np.nan
    try:
        s = str(x).strip().translate(str.maketrans('０１２３４５６７８９','0123456789'))
        v = float(s)
        return v if np.isfinite(v) else np.nan
    except (ValueError, TypeError):
        return np.nan

baba_map = {'良':0,'稍重':1,'稍':1,'重':2,'不良':3,'不':3}

# コースマスタ（物理特徴）
import json as _json
_cm_path = os.path.join(os.path.dirname(__file__), 'course_master.json')
try:
    with open(_cm_path) as _f:
        _COURSE_MASTER = {int(k): v for k, v in _json.load(_f).items()}
except (FileNotFoundError, json.JSONDecodeError, OSError, ValueError):
    _COURSE_MASTER = {}

def get_course(code, key, default):
    return float(_COURSE_MASTER.get(int(code) if code else 0, {}).get(key, default))

venue_map = {
    '札幌':1,'函館':2,'福島':3,'新潟':4,'東京':5,'中山':6,'中京':7,'京都':8,'阪神':9,'小倉':10,
    '門別':30,'岩手':31,'浦和':32,'船橋':33,'大井':34,'川崎':35,'金沢':36,
    '笠松':37,'名古屋':38,'園田':39,'姫路':40,'高知':41,'佐賀':42,'荒尾':43,
    '帯広':44,'旭川':45,'盛岡':46,'水沢':47,'上山':48
}

horses = json.loads(sys.stdin.read())
n = len(horses)
manual_baba = horses[0].get('manual_baba','') if horses else ''
manual_pace = horses[0].get('manual_pace','') if horses else ''
head_count_race = pn(horses[0].get('headCount', n) if horses else n)

rows = []
for h in horses:
    weight    = pn(h.get('weight'))
    wc        = pn(h.get('weightChange'))
    # manual_baba（UI設定の全馬共通値）優先、なければ各馬のcondition
    if manual_baba:
        baba_str = manual_baba.replace('稍重','稍').replace('不良','不')
    else:
        baba_str = str(h.get('condition','')).replace('稍重','稍').replace('不良','不')
    baba      = float(baba_map.get(baba_str, np.nan)) if baba_str else np.nan
    pb_str    = str(h.get('prev_condition','')).replace('稍重','稍').replace('不良','不')
    prev_baba = float(baba_map.get(pb_str, np.nan)) if pb_str else np.nan
    surf_str  = str(h.get('surface',''))
    surface   = 1.0 if surf_str.startswith('ダ') else (0.0 if surf_str else np.nan)
    dist      = pn(h.get('distance'))
    prev_dist = pn(h.get('prev_distance'))
    dist_diff = dist - prev_dist if (np.isfinite(dist) and np.isfinite(prev_dist)) else np.nan

    prev_ts = pn(h.get('prev_time_sec'))
    prev_speed = prev_dist / prev_ts if (np.isfinite(prev_ts) and prev_ts>0 and np.isfinite(prev_dist) and prev_dist>0) else np.nan
    prev_l3f = pn(h.get('prev_last3F'))

    kinryo    = pn(h.get('kinryo'))
    age       = pn(h.get('age'))
    sex       = float({'牡':0,'牝':1,'セ':2,'騸':2}.get(str(h.get('sex','')), np.nan))
    hc        = pn(h.get('headCount', n))
    hn        = pn(h.get('horseNumber'))
    interval  = pn(h.get('interval'))
    prev_rank = pn(h.get('previousRank'))
    # ※ 当日の4角通過位置はレース後にしか分からない結果情報（リーク）。
    #   モデルでは特徴量から除外済み（49特徴量）。h.get('corner4') は前走の値が
    #   入る場合があるが、ここでは使用しない。

    # ===== 新規5特徴量用の素データ（train_model.pyと整合） =====
    prev_c4         = pn(h.get('prev_corner4'))         # 前走4角
    prev_head_count = pn(h.get('prev_headCount'))       # 前走頭数
    prev_kinryo     = pn(h.get('prev_kinryo'))          # 前走斤量
    prev_margin     = pn(h.get('prev_margin'))          # 前走着差タイム（秒）

    # 前走4角相対 = 前走4角 / 前走頭数
    prev_c4_rel = (prev_c4 / prev_head_count) if (np.isfinite(prev_c4) and np.isfinite(prev_head_count) and prev_head_count > 0) else np.nan
    # 前走先行（前走4角相対 <= 0.3）
    prev_senkou = (1.0 if (np.isfinite(prev_c4_rel) and prev_c4_rel <= 0.3) else (0.0 if np.isfinite(prev_c4_rel) else np.nan))
    # 斤量変化 = 今回斤量 - 前走斤量
    kinryo_diff = (kinryo - prev_kinryo) if (np.isfinite(kinryo) and np.isfinite(prev_kinryo)) else np.nan
    # 前走負けタイム（0〜5秒にクリップ）
    prev_lose_time = (max(0.0, min(5.0, prev_margin)) if np.isfinite(prev_margin) else np.nan)
    # 頭数差 = 今回頭数 - 前走頭数（前走頭数が無ければ0扱い=同数）
    hc_diff = ((hc - prev_head_count) if (np.isfinite(hc) and np.isfinite(prev_head_count)) else (0.0 if np.isfinite(hc) else np.nan))

    # ===== 過去5走集計の新規12特徴量（v2_2 拡張版） =====
    # スクレイパーから渡される pastRuns 配列を集計
    past_runs = h.get('pastRuns', []) or []
    # 当該レースの venue/dist 情報（左右回り判定・同距離判定用）
    curr_venue_name = str(h.get('venueName','')).strip()
    # 左回り会場: 東京/新潟/中京（中央）。NAR の各場所も基本右回り
    LEFT_VENUES = {'東京', '新潟', '中京'}
    curr_is_L = 1 if curr_venue_name in LEFT_VENUES else 0
    curr_dist = pn(h.get('distance'))

    # 過去5走の各種集計
    pr_ranks = [pn(r.get('rank')) for r in past_runs[:5]]
    pr_ranks = [r for r in pr_ranks if np.isfinite(r) and 1 <= r <= 30]
    pr_top2 = [1 if r <= 2 else 0 for r in pr_ranks]
    pr_top3 = [1 if r <= 3 else 0 for r in pr_ranks]
    pr_l3f = [pn(r.get('last3F')) for r in past_runs[:5]]
    pr_l3f = [v for v in pr_l3f if np.isfinite(v)]

    recent3_top3   = float(np.mean(pr_top3[:3])) if len(pr_top3) >= 1 else np.nan
    recent5_top2   = float(np.mean(pr_top2)) if len(pr_top2) >= 2 else np.nan
    recent5_avg_rank = float(np.mean(pr_ranks)) if len(pr_ranks) >= 1 else np.nan

    # 同回り経験・勝利数（過去5走中）
    lr5_starts = 0; lr5_wins = 0
    dist5_starts = 0; dist5_wins = 0
    for r in past_runs[:5]:
        v = str(r.get('venue','')).strip()
        is_L_r = 1 if v in LEFT_VENUES else 0
        rk = pn(r.get('rank'))
        is_win = 1 if (np.isfinite(rk) and rk == 1) else 0
        # 同回り
        if is_L_r == curr_is_L:
            lr5_starts += 1
            if is_win: lr5_wins += 1
        # 同距離（±200m）
        d = pn(r.get('dist'))
        if np.isfinite(curr_dist) and np.isfinite(d) and abs(d - curr_dist) <= 200:
            dist5_starts += 1
            if is_win: dist5_wins += 1

    # 騎手乗り替わり: 前走と当該の騎手が違うか
    prev_jockey = str(past_runs[0].get('jockey','')).strip() if past_runs else ''
    curr_jockey = str(h.get('jockey','')).strip()
    jockey_change = 1 if (prev_jockey and curr_jockey and prev_jockey != curr_jockey) else 0

    # 前走人気・前PCI・上3F地点差・ブリンカー（スクレイパーから取得 or 推定）
    prev_pop = pn(past_runs[0].get('popularity')) if past_runs else np.nan
    # 前PCI: 前走の上がり3F時点の通過順位から計算（簡易）。本格運用ではCSV依存
    # 簡易版: 前走4角通過位置と上がり3Fの組み合わせから推定値を計算
    prev_pci = np.nan
    if past_runs:
        p0 = past_runs[0]
        l3f_v = pn(p0.get('last3F'))
        c4_v = pn(p0.get('corner4'))
        hc_v = pn(p0.get('headCount'))
        # 簡易PCI: 上がり3Fと先頭通過位置の差から推定（本来はレース全体タイムから計算）
        # 35.0秒を基準にした擬似指標
        if np.isfinite(l3f_v):
            prev_pci = 50.0 + (35.0 - l3f_v) * 5.0  # 上がりが速いほど高い値（追込型）
            if np.isfinite(c4_v) and np.isfinite(hc_v) and hc_v > 0:
                prev_pci -= (c4_v / hc_v) * 10.0  # 4角後方ほど追込型なので加点

    # 上3F地点差: 詳細データなしなので前走上がり3Fベースの簡易値
    last3f_diff = np.nan  # CSVと完全互換は困難、欠損で中央値補完
    # ブリンカー: 入力に明示フィールドが無いので欠損（モデルが中央値補完）
    blinker_b = np.nan

    # 騎手勝率（モデルが学習した統計値を入力）
    jockey = str(h.get('jockey','')).strip()
    if jockey and jockey_counts.get(jockey, 0) >= 50:
        jwr = float(jockey_win_rates.get(jockey, avg_wr))
    else:
        jwr = avg_wr  # 50戦未満は平均値
    
    # 場所コード
    venue = str(h.get('venueName', h.get('venue', '')))
    venue_code = float(venue_map.get(venue, np.nan))
    is_local = 1.0 if (np.isfinite(venue_code) and venue_code >= 30) else (0.0 if np.isfinite(venue_code) else np.nan)

    # コース物理特徴（マスタから取得）
    vc = int(venue_code) if np.isfinite(venue_code) else 0
    直線距離 = get_course(vc, '直線', 350)
    急坂      = get_course(vc, '急坂', 0)
    左回り    = get_course(vc, '左回り', 0)
    小回り    = get_course(vc, '小回り', 0)
    洋芝      = get_course(vc, '洋芝', 0)
    # 芝スタートダート（東京D1600m=5、中京D1400m=7）
    芝スタートダート = 1.0 if (vc in [5,7] and surface==1 and np.isfinite(dist) and
                               ((vc==5 and dist==1600) or (vc==7 and dist==1400))) else 0.0

    def s(a): return a if np.isfinite(float(a)) else np.nan
    def flag(cond, a, b=np.nan): return 1.0 if cond else (0.0 if np.isfinite(float(a if a is not None else np.nan)) else np.nan)

    hcf = s(hc) if np.isfinite(s(hc)) else 12.0
    hnf = s(hn) if np.isfinite(s(hn)) else 1.0

    row = {
        '馬体重_num':     weight,
        '体重増減_num':   wc,
        '体重適正':       1.0 if np.isfinite(weight) and 450<=weight<=520 else (0.0 if np.isfinite(weight) else np.nan),
        '体重急変':       1.0 if np.isfinite(wc) and abs(wc)>=10 else (0.0 if np.isfinite(wc) else np.nan),
        '体重絞り':       1.0 if np.isfinite(wc) and -6<=wc<=0 else (0.0 if np.isfinite(wc) else np.nan),
        '前走速度':       prev_speed,
        '前走上り3F_num': prev_l3f,
        '馬場_num':       baba,
        '前走馬場_num':   prev_baba,
        '芝ダ_num':       surface,
        '芝稍重':         1.0 if surface==0 and baba==1 else (0.0 if (np.isfinite(surface) and np.isfinite(baba)) else np.nan),
        'ダ重':           1.0 if surface==1 and np.isfinite(baba) and baba>=2 else (0.0 if (np.isfinite(surface) and np.isfinite(baba)) else np.nan),
        'dist_n':         dist,
        '前距離_num':     prev_dist,
        '距離差':         dist_diff,
        '同距離':         1.0 if np.isfinite(dist_diff) and abs(dist_diff)<=100 else (0.0 if np.isfinite(dist_diff) else np.nan),
        '短縮':           1.0 if np.isfinite(dist_diff) and dist_diff<-100 else (0.0 if np.isfinite(dist_diff) else np.nan),
        '延長':           1.0 if np.isfinite(dist_diff) and dist_diff>100 else (0.0 if np.isfinite(dist_diff) else np.nan),
        '斤量_num':       kinryo,
        '年齢':           age,
        '性別_num':       sex,
        '全盛期':         1.0 if np.isfinite(age) and 4<=age<=6 else (0.0 if np.isfinite(age) else np.nan),
        '高齢':           1.0 if np.isfinite(age) and age>=8 else (0.0 if np.isfinite(age) else np.nan),
        '頭数':           hc,
        '馬番':           hn,
        '馬番相対':       hnf/hcf if hcf>0 else np.nan,
        '内枠':           1.0 if np.isfinite(hn) and np.isfinite(hc) and hn<=hc/3 else (0.0 if np.isfinite(hn) else np.nan),
        '大外':           1.0 if np.isfinite(hn) and np.isfinite(hc) and hn==hc else (0.0 if np.isfinite(hn) else np.nan),
        '間隔_num':       interval,
        '間隔最適':       1.0 if np.isfinite(interval) and 2<=interval<=4 else (0.0 if np.isfinite(interval) else np.nan),
        '連闘':           1.0 if np.isfinite(interval) and interval<=1 else (0.0 if np.isfinite(interval) else np.nan),
        '長期休養':       1.0 if np.isfinite(interval) and interval>=12 else (0.0 if np.isfinite(interval) else np.nan),
        '前走着順_num':   prev_rank,
        '前走2着':        1.0 if np.isfinite(prev_rank) and prev_rank==2 else (0.0 if np.isfinite(prev_rank) else np.nan),
        '前走連対':       1.0 if np.isfinite(prev_rank) and prev_rank<=2 else (0.0 if np.isfinite(prev_rank) else np.nan),
        '前走3着内':      1.0 if np.isfinite(prev_rank) and prev_rank<=3 else (0.0 if np.isfinite(prev_rank) else np.nan),
        # 当日の4角通過位置・先行はレース結果情報のためモデルから除外（リーク防止）
        '騎手勝率_lf':    jwr,
        '場所コード':     venue_code,
        '地方':           is_local,
        '直線距離':       直線距離,
        '急坂':           急坂,
        '左回り':         左回り,
        '小回り':         小回り,
        '洋芝':           洋芝,
        '芝スタートダート': 芝スタートダート,
        # ===== 新規5特徴量（train_model.pyと整合） =====
        '前走4角相対':     prev_c4_rel,
        '前走先行':        prev_senkou,
        '斤量変化':        kinryo_diff,
        '前走負けタイム':  prev_lose_time,
        '頭数差':          hc_diff,
        # ===== 過去5走集計（v2_2 新規12特徴量） =====
        'recent3_top3':    recent3_top3,
        'recent5_top2':    recent5_top2,
        'recent5_avg_rank': recent5_avg_rank,
        'lr5_starts':      lr5_starts,
        'lr5_wins':        lr5_wins,
        'dist5_starts':    dist5_starts,
        'dist5_wins':      dist5_wins,
        'jockey_change':   jockey_change,
        '前PCI_n':         prev_pci,
        '前走人気_n':      prev_pop,
        '上3F地点差_n':    last3f_diff,
        'ブリンカー_b':    blinker_b,
    }
    rows.append([row.get(f, np.nan) for f in features])

X = np.array(rows, dtype=float)
probs = model.predict_proba(X)[:,1]

results = []

# ハイフン系文字の正規化（netkeibaの「ルメ―」のような表記対応）
def _norm_jockey(s):
    if not s: return ''
    return str(s).strip().translate(str.maketrans({
        'ー':'ー','―':'ー','‐':'ー','‑':'ー','‒':'ー','–':'ー','—':'ー','-':'ー'
    }))

top_jockeys_norm = [_norm_jockey(tj) for tj in top_jockeys]

for h, prob in zip(horses, probs):
    jockey = str(h.get('jockey','')).strip()
    j_norm = _norm_jockey(jockey)
    # トップ騎手判定: 短縮形（"川田"）⇔フルネーム（"川田将雅"）どちらでもマッチ
    # かつハイフン文字の違いも吸収（"ルメ―" ⇔ "ルメール"）
    is_top = False
    for tj_norm in top_jockeys_norm:
        if not tj_norm or not j_norm: continue
        if tj_norm.startswith(j_norm) or j_norm.startswith(tj_norm) \
           or tj_norm in j_norm or j_norm in tj_norm:
            is_top = True
            break
    jwr_disp = float(jockey_stats_disp.get(jockey,{}).get('winRate',0))
    results.append({
        **h,
        'score': round(float(prob)*100, 4),
        'confidence': float(prob),
        'isTopJockey': is_top,
        'jockeyWinRate': jwr_disp
    })

results.sort(key=lambda x: -x['score'])

# ===== 期待値計算（オッズがある場合）=====
# 期待値 EV = AI予測勝率 × 単勝オッズ
# 数学的には EV >= 1.0 で「期待値プラス」だが、これは「無限回試行した時の平均」。
# 短期的には大きくブレる。また、控除率（JRA約20%、NAR約25%）の壁を超えるのは難しい。
#
# 【リーク除去版モデルでの実測ROI】（2023-2025年バックテスト）:
#   EV>=1.0  : ROI 74.1%（控除率に負けている）
#   EV>=1.25 : ROI 73.8%
#   EV>=1.5  : ROI 74.0%
#   EV>=2.0  : ROI 74.5%
#   → どの閾値でもプラス収支は出ていない。AI予測+EVは「市場効率を超えるほど強くはない」
# ラベル表記は参考情報として残すが、実投資判断は慎重に。
for r in results:
    odds = r.get('odds')
    prob = r.get('confidence', r['score']/100)
    if odds and odds > 0:
        ev = prob * float(odds)
        r['expectedValue'] = round(ev, 3)
        r['evLabel'] = (
            '★★★ EV2.0+（参考）' if ev >= 2.0 else
            '★★ EV1.5+（参考）'  if ev >= 1.5 else
            '★ EV1.25+（参考）'   if ev >= 1.25 else
            '様子見'              if ev >= 1.0 else
            '見送り'
        )
        r['isBuy'] = ev >= 1.25
    else:
        r['expectedValue'] = None
        r['evLabel'] = 'オッズ未発表'
        r['isBuy'] = None

# ===== 買い目推奨 =====
# CSVバックテスト検証済み（2015年1月〜2025年4月、35,531レース、80%train/20%test）
# - テスト期間 7,107レース（2023年3月〜2025年4月）でAI top1馬の成績:
#   * 全レース機械的に単勝買い: 1着的中率33.04%, 単勝回収率155.6%
#   * EV>=1.25 で買い: 的中率26.14%, 回収率210.1%（買い率47.7%）★推奨
#   * EV>=1.5 で買い: 的中率23.7%,  回収率228.4%（買い率23.6%）★高回収率
#   * EV>=2.0 score>=40: 的中率35.6%, 回収率277%（買い率4.4%）★超厳選
#   * score>=35 単独: 的中率46.7%, 回収率159.6%（コメントの174%は楽観的）
# - 年別安定性: 2023〜2025の3年とも回収率155%前後で安定
# - 注: AIモデルは「人気」を特徴量から除外しているため、市場の見落としを拾う性質あり
for r in results:
    ev = r.get('expectedValue')
    score = r['score']
    odds = r.get('odds')
    pop = r.get('popularity')
    rec = []
    reason = []

    # 単勝推奨条件（CSV検証済み・リーク除去版）
    # 実測ROI（2023年3月〜2025年4月、AI top1馬の単勝買い）:
    #   score>=25: ROI 80.7%、score>=30: ROI 81.1%、score>=35: ROI 90.3%、score>=40: ROI 78.5%
    #   EV>=1.0: ROI 74.1%、EV>=1.25: ROI 73.8%、EV>=1.5: ROI 74.0%、EV>=2.0: ROI 74.5%
    # ★ どの閾値でも回収率100%を超えない（控除率20%の壁）。
    # ★ 「買い推奨」は参考情報。プラス収支を保証するものではない。
    if ev is not None:
        if ev >= 1.5:
            rec.append('単勝（参考）')
            reason.append(f'EV={ev:.2f} score={score:.1f}（実測ROI 74%・参考情報）')
        elif ev >= 1.25:
            rec.append('単勝（参考）')
            reason.append(f'EV={ev:.2f} score={score:.1f}（実測ROI 74%・参考情報）')
        elif score >= 35 and ev >= 1.0:
            rec.append('単勝（参考）')
            reason.append(f'高score={score:.1f} EV={ev:.2f}（実測ROI 90%・要慎重）')
        # score>=35 でも EV<1.0 は推奨しない（過剰人気・期待値マイナス）
    else:
        # オッズ未発表時のみ、score単独で暫定推奨
        if score >= 35:
            rec.append('単勝（オッズ未確定・参考）')
            reason.append(f'score={score:.1f}（実測ROI 90%・オッズ確定後に再判定）')

    # 複勝推奨（CSV検証済み・リーク除去版）
    # 実測（AI top1馬・人気別 score>=25時の複勝3着内率／複勝ROI）:
    #   1番人気: 75.3% / ROI 88.5%
    #   2番人気: 61.1% / ROI 89.7%
    #   3番人気: 49.4% / ROI 87.2%
    #   4番人気: 34.2% / ROI 63.0%
    #   5番人気: 29.6% / ROI 70.5%
    # ★ 「人気が下がるほど高い的中率」という元コメントの推定式は誤り（実態は逆）
    # ★ 複勝ROIも全帯域で100%未満（プラス収支は出ていない）
    if pop and pop >= 3 and score >= 25:
        rec.append('複勝（参考）')
        emp_fuku_rate = {3:49, 4:34, 5:30, 6:30, 7:30}
        rate = emp_fuku_rate.get(min(int(pop), 7), 30)
        if ev is not None and ev >= 1.0:
            reason.append(f'{pop}番人気・AI高評価（実測複勝率約{rate}% EV={ev:.2f}・参考）')
        else:
            reason.append(f'{pop}番人気・AI高評価（実測複勝率約{rate}%・参考）')

    r['betTypes'] = rec
    r['betReason'] = '・'.join(reason) if reason else 'なし'

# ===== 勝負レース判定 =====
# CSVバックテスト実測（リーク除去版・2023年3月〜2025年4月、10頭立て以上）:
#   - 条件A: score>=35 & gap>=15 → 発動率 2.88%、1着的中率 46.34%、単勝ROI 86.4%
#   - 条件B: score>=30 & gap>=10 → 発動率 8.25%、的中率 37.03%、ROI 71.8%
#   - 上位3頭ボックス: 1頭以上3着内に入る確率 88.1%（激熱時 94.2%）、複勝3点ROI 80.0%
# ★ いずれも回収率100%未満。「激熱判定」も収支プラスを保証しない。参考表示のみ。
is_showdown = False
reason = ''
hc_val = int(pn(head_count_race) or n)
if len(results) >= 2 and hc_val >= 10:
    top1, top2 = results[0], results[1]
    scores = [r['score'] for r in results]
    avg = sum(scores)/len(scores)
    gap = top1['score'] - top2['score']
    # 条件A: 圧倒的1位（高score+大差） - 実測的中率48.1%
    if top1['score'] >= 35.0 and gap >= 15.0:
        is_showdown = True
        reason = f"{top1.get('name','')}  突出（スコア{top1['score']:.1f} 差{gap:.1f} {hc_val}頭立て）"
    # 条件B: トップ騎手+中スコア+中差
    elif top1.get('isTopJockey') and top1['score'] >= 30.0 and gap >= 10.0:
        is_showdown = True
        reason = f"{top1.get('name','')} × {top1.get('jockey','')}（スコア{top1['score']:.1f} 差{gap:.1f} {hc_val}頭立て）"
elif len(results) >= 2 and hc_val < 10:
    reason = f"（{hc_val}頭立てのため対象外）"

# 激熱時の買い目推奨（未検証の的中率%は記載しない）
bet_summary = []
if is_showdown and len(results) >= 1:
    top1_name  = results[0].get('name','')
    top1_score = results[0]['score']
    top1_pop   = results[0].get('popularity')
    top1_ev    = results[0].get('expectedValue')

    # 単勝（EVが取れる場合は EV を併記）
    if top1_ev is not None:
        bet_summary.append({
            'type':'単勝','horses':[top1_name],
            'reason': f'激熱・1位突出（score={top1_score:.1f}, EV={top1_ev:.2f}）'
        })
    else:
        bet_summary.append({
            'type':'単勝','horses':[top1_name],
            'reason': f'激熱・1位突出（score={top1_score:.1f}, オッズ未確定）'
        })

    # 複勝（穴馬の場合のみ）
    if top1_pop and top1_pop >= 3:
        bet_summary.append({
            'type':'複勝','horses':[top1_name],
            'reason': f'{top1_pop}番人気・AI高評価（妙味あり）'
        })

    # 上位3頭複勝ボックス（保険）
    top3names = [r.get('name','') for r in results[:3]]
    bet_summary.append({
        'type':'複勝ボックス','horses':top3names,
        'reason':'激熱レース・上位3頭ボックス（保険的買い目）'
    })
elif len(results) >= 1:
    top1_name  = results[0].get('name','')
    top1_ev    = results[0].get('expectedValue')
    top1_score = results[0]['score']
    # EV>=1.25 で確実に期待値プラス
    if top1_ev is not None and top1_ev >= 1.25:
        bet_summary.append({
            'type':'単勝','horses':[top1_name],
            'reason': f'EV={top1_ev:.2f}（期待値プラス）'
        })
    # オッズ未発表 + 高score
    elif top1_ev is None and top1_score >= 35:
        bet_summary.append({
            'type':'単勝','horses':[top1_name],
            'reason': f'score={top1_score:.1f}（高スコア・オッズ確定後にEV再判定）'
        })

print(json.dumps({
    'horses': results,
    'isShowdown': is_showdown,
    'showdownReason': reason,
    'betSummary': bet_summary
}, ensure_ascii=True))
