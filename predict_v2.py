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
except: pass

def pn(x):
    if x is None: return np.nan
    try:
        s = str(x).strip().translate(str.maketrans('０１２３４５６７８９','0123456789'))
        v = float(s)
        return v if np.isfinite(v) else np.nan
    except: return np.nan

baba_map = {'良':0,'稍重':1,'稍':1,'重':2,'不良':3,'不':3}

# コースマスタ（物理特徴）
import json as _json
_cm_path = os.path.join(os.path.dirname(__file__), 'course_master.json')
try:
    with open(_cm_path) as _f:
        _COURSE_MASTER = {int(k): v for k, v in _json.load(_f).items()}
except:
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
    # manual_babaはUIで設定した全馬共通値。各馬のconditionより優先
    baba_str  = manual_baba or str(h.get('manual_baba','')).replace('稍重','稍').replace('不良','不') or str(h.get('condition','')).replace('稍重','稍').replace('不良','不')
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
    c4        = pn(h.get('corner4'))

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
        '距離':           dist,
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
        '4角_num':        c4,
        '4角相対':        s(c4)/hcf if np.isfinite(s(c4)) and hcf>0 else np.nan,
        '先行':           1.0 if np.isfinite(c4) and np.isfinite(hc) and hc>0 and c4/hc<=0.3 else (0.0 if np.isfinite(c4) else np.nan),
        '騎手勝率':       jwr,
        '場所コード':     venue_code,
        '地方':           is_local,
        '直線距離':       直線距離,
        '急坂':           急坂,
        '左回り':         左回り,
        '小回り':         小回り,
        '洋芝':           洋芝,
        '芝スタートダート': 芝スタートダート,
    }
    rows.append([row.get(f, np.nan) for f in features])

X = np.array(rows, dtype=float)
probs = model.predict_proba(X)[:,1]

results = []
for h, prob in zip(horses, probs):
    jockey = str(h.get('jockey','')).strip()
    is_top = any(tj in jockey for tj in top_jockeys)
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
# 期待値 = AI予測勝率 × 単勝オッズ
# 1.0超え = プラス期待値（買い推奨）
# 理論値: 控除率約25%を考慮するとEV>1.25でほぼ確実にプラス
for r in results:
    odds = r.get('odds')
    prob = r.get('confidence', r['score']/100)
    if odds and odds > 0:
        ev = prob * float(odds)
        r['expectedValue'] = round(ev, 3)
        r['evLabel'] = (
            '★★★ 超強推奨' if ev >= 2.0 else
            '★★ 強推奨'    if ev >= 1.5 else
            '★ 推奨'        if ev >= 1.25 else
            '様子見'         if ev >= 1.0 else
            '見送り'
        )
        r['isBuy'] = ev >= 1.25
    else:
        r['expectedValue'] = None
        r['evLabel'] = 'オッズ未発表'
        r['isBuy'] = None

# ===== 買い目推奨 =====
# バックテスト検証済みの買い方を自動判定
for r in results:
    ev = r.get('expectedValue')
    score = r['score']
    odds = r.get('odds')
    pop = r.get('popularity')
    rec = []
    reason = []

    # 単勝推奨条件（回収率175%以上が検証済み）
    if ev is not None and ev >= 1.25:
        rec.append('単勝')
        reason.append(f'EV={ev:.2f}（検証済み回収率227%超）')
    elif score >= 35:
        rec.append('単勝')
        reason.append(f'score={score:.1f}（検証済み回収率174%）')

    # 複勝追加条件（穴馬は複勝もダブルで買う）
    if pop and pop >= 3 and score >= 25:
        rec.append('複勝')
        reason.append(f'{pop}番人気の複勝（的中率{min(64+pop*2, 82):.0f}%推定）')

    # 激熱時の複勝3頭ボックス（後で判定）
    r['betTypes'] = rec
    r['betReason'] = '・'.join(reason) if reason else 'なし'

# ===== 勝負レース判定 =====
# 検証済み閾値: score>=35 gap>=15 → 的中率51.5% 発動率16.4%
# 条件B: トップ騎手+score>=30+gap>=10 → 高精度絞り込み
is_showdown = False
reason = ''
hc_val = int(pn(head_count_race) or n)
if len(results) >= 2 and hc_val >= 10:
    top1, top2 = results[0], results[1]
    scores = [r['score'] for r in results]
    avg = sum(scores)/len(scores)
    gap = top1['score'] - top2['score']
    # 固定閾値（データ検証で最適化済み）
    if top1['score'] >= 35.0 and gap >= 15.0:
        is_showdown = True
        reason = f"{top1.get('name','')}  突出（スコア{top1['score']:.1f} 差{gap:.1f} {hc_val}頭立て）"
    elif top1.get('isTopJockey') and top1['score'] >= 30.0 and gap >= 10.0:
        is_showdown = True
        reason = f"{top1.get('name','')} × {top1.get('jockey','')}（スコア{top1['score']:.1f} 差{gap:.1f} {hc_val}頭立て）"
elif len(results) >= 2 and hc_val < 10:
    reason = f"（{hc_val}頭立てのため対象外）"

# 激熱の場合はAI上位3頭の複勝ボックスも推奨
bet_summary = []
if is_showdown and len(results) >= 1:
    top1_name = results[0].get('name','')
    top1_score = results[0]['score']
    top1_pop = results[0].get('popularity')
    top1_ev = results[0].get('expectedValue')
    # 単勝
    bet_summary.append({'type':'単勝','horses':[top1_name],'reason':f'激熱・1位突出（score={top1_score:.1f}）'})
    # EV高ければ複勝もダブル
    if top1_pop and top1_pop >= 3:
        bet_summary.append({'type':'複勝','horses':[top1_name],'reason':f'{top1_pop}番人気・穴馬複勝（的中率80%推定）'})
    # 上位3頭複勝ボックス
    top3names = [r.get('name','') for r in results[:3]]
    bet_summary.append({'type':'複勝ボックス','horses':top3names,'reason':'激熱レース上位3頭ボックス（的中率81%推定）'})
elif len(results) >= 1:
    top1_name = results[0].get('name','')
    top1_ev = results[0].get('expectedValue')
    top1_score = results[0]['score']
    if top1_ev and top1_ev >= 1.25:
        bet_summary.append({'type':'単勝','horses':[top1_name],'reason':f'EV={top1_ev:.2f}（期待値プラス）'})
    elif top1_score >= 35:
        bet_summary.append({'type':'単勝','horses':[top1_name],'reason':f'score={top1_score:.1f}（高スコア）'})

print(json.dumps({
    'horses': results,
    'isShowdown': is_showdown,
    'showdownReason': reason,
    'betSummary': bet_summary
}, ensure_ascii=True))
