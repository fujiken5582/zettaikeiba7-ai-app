#!/usr/bin/env python3
"""モデル再学習スクリプト（人気系特徴量除外・新規特徴量追加）"""
import pandas as pd, numpy as np, pickle, json, warnings
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split

def pn(x):
    try:
        s=str(x).strip().translate(str.maketrans('０１２３４５６７８９','0123456789'))
        v=float(s); return int(v) if v==int(v) else v
    except: return None

print("CSVロード中...")
df = pd.read_csv('/mnt/user-data/uploads/20152025.csv', encoding='cp932', on_bad_lines='skip')
df['着順_num']=df['着順'].apply(pn)
df=df[df['着順_num'].notna()].reset_index(drop=True)
df['race_key']=df['日付'].astype(str)+'_'+df['開催'].astype(str)+'_'+df['Ｒ'].astype(str)
print(f"有効行: {len(df):,}")

# コースマスタ
with open('/home/claude/keiba_app/course_master.json') as f:
    CM={int(k):v for k,v in json.load(f).items()}
def gc(c,k,d): return float(CM.get(int(c) if c else 0,{}).get(k,d))
vm={'札':1,'函':2,'福':3,'新':4,'東':5,'中':6,'京':7,'阪':8,'小':10,'名':38,'大':34,
    '川':35,'浦':32,'船':33,'金':36,'笠':37,'園':39,'高':41,'佐':42,'帯':44,'水':47,'盛':46}
df['sc']=df['開催'].astype(str).str.extract(r'([^\d]+)')[0].str[:1]
df['場所コード']=df['sc'].map(vm).fillna(0).astype(int)
df['地方']=(df['場所コード']>=30).astype(int)
for feat,key,defv in [('直線距離','直線',350),('急坂','急坂',0),('左回り','左回り',0),('小回り','小回り',0),('洋芝','洋芝',0)]:
    df[feat]=df['場所コード'].apply(lambda c:gc(c,key,defv))
df['芝スタートダート']=df.apply(
    lambda r:1 if str(r['芝・ダ']).strip()=='ダ' and
    ((int(r['場所コード'])==5 and int(r['距離'])==1600) or
     (int(r['場所コード'])==7 and int(r['距離'])==1400)) else 0, axis=1)

# 騎手勝率
jw=df.groupby('騎手')['着順_num'].apply(lambda x:(x==1).mean()).to_dict()
jc=df.groupby('騎手').size().to_dict(); aw=df['着順_num'].eq(1).mean()
df['騎手勝率']=df['騎手'].map(lambda j:jw.get(j,aw) if jc.get(j,0)>=50 else aw)

# 基本特徴量
bm={'良':0,'稍重':1,'稍':1,'重':2,'不良':3,'不':3}
df['斤量_num']=pd.to_numeric(df['斤量'].astype(str).str.extract(r'(\d+\.?\d*)')[0],errors='coerce')
df['馬場_num']=df['馬場状態'].map(bm).fillna(0)
df['前走馬場_num']=df['前走馬場状態'].map(bm).fillna(0)
df['芝ダ_num']=(df['芝・ダ'].str.strip()=='ダ').astype(int)
df['性別_num']=df['性別'].map({'牡':0,'牝':1,'セ':2,'騸':2}).fillna(0)
df['前走着順_num']=df['前走着順'].apply(pn)
df['馬体重_num']=pd.to_numeric(df['馬体重'],errors='coerce')
df['体重増減_num']=pd.to_numeric(df['馬体重増減'],errors='coerce')
df['前走上り3F_num']=pd.to_numeric(df['前走上り3F'],errors='coerce')
df['4角_num']=pd.to_numeric(df['4角'],errors='coerce')
df['間隔_num']=pd.to_numeric(df['間隔'],errors='coerce')
df['前距離_num']=pd.to_numeric(df['前距離'],errors='coerce')

# 新規：前走4角（数値のみ）
df['前4角_num']=pd.to_numeric(df['前4角'].astype(str).str.extract(r'(\d+)')[0],errors='coerce')
df['前走頭数_num']=pd.to_numeric(df['前走頭数'],errors='coerce')
df['前走斤量_num']=pd.to_numeric(df['前走斤量'].astype(str).str.extract(r'(\d+\.?\d*)')[0],errors='coerce')
df['前走着差タイム_num']=pd.to_numeric(df['前走着差タイム'],errors='coerce')
df['前走4角相対']=df['前4角_num']/df['前走頭数_num'].replace(0,np.nan)
df['前走先行']=(df['前走4角相対']<=0.3).astype(float)
df['斤量変化']=df['斤量_num']-df['前走斤量_num']
df['前走負けタイム']=df['前走着差タイム_num'].clip(0,5)
df['頭数差']=df['頭数']-df['前走頭数_num'].fillna(df['頭数'])

# 既存特徴量
df['距離差']=df['距離']-df['前距離_num'].fillna(df['距離'])
df['同距離']=(df['距離差'].abs()<=100).astype(int)
df['短縮']=(df['距離差']<-100).astype(int); df['延長']=(df['距離差']>100).astype(int)
df['馬番相対']=df['馬番']/df['頭数'].replace(0,1)
df['内枠']=(df['馬番']<=df['頭数']/3).astype(int); df['大外']=(df['馬番']==df['頭数']).astype(int)
df['4角相対']=df['4角_num']/df['頭数'].replace(0,1); df['先行']=(df['4角相対']<=0.3).astype(int)
df['間隔最適']=((df['間隔_num']>=2)&(df['間隔_num']<=4)).astype(int)
df['連闘']=(df['間隔_num']<=1).astype(int); df['長期休養']=(df['間隔_num']>=12).astype(int)
df['前走2着']=(df['前走着順_num']==2).astype(int)
df['前走連対']=(df['前走着順_num']<=2).astype(int)
df['前走3着内']=(df['前走着順_num']<=3).astype(int)
df['全盛期']=((df['年齢']>=4)&(df['年齢']<=6)).astype(int); df['高齢']=(df['年齢']>=8).astype(int)
df['体重適正']=((df['馬体重_num']>=450)&(df['馬体重_num']<=520)).astype(int)
df['体重急変']=(df['体重増減_num'].abs()>=10).astype(int)
df['体重絞り']=((df['体重増減_num']>=-6)&(df['体重増減_num']<=0)).astype(int)
df['芝稍重']=((df['芝ダ_num']==0)&(df['馬場_num']==1)).astype(int)
df['ダ重']=((df['芝ダ_num']==1)&(df['馬場_num']>=2)).astype(int)
df['前走タイム秒']=df['前走走破タイム'].apply(pn)
df['前走速度']=df['前距離_num']/pd.to_numeric(df['前走タイム秒'],errors='coerce').replace(0,np.nan)

features = [
    '馬体重_num','体重増減_num','体重適正','体重急変','体重絞り',
    '前走速度','前走上り3F_num',
    '馬場_num','前走馬場_num','芝ダ_num','芝稍重','ダ重',
    '距離','前距離_num','距離差','同距離','短縮','延長',
    '斤量_num','年齢','性別_num','全盛期','高齢',
    '頭数','馬番','馬番相対','内枠','大外',
    '間隔_num','間隔最適','連闘','長期休養',
    '前走着順_num','前走2着','前走連対','前走3着内',
    '4角_num','4角相対','先行',
    '騎手勝率',
    '直線距離','急坂','左回り','小回り','洋芝','芝スタートダート','地方',
    # 新規（人気系除外）
    '前走4角相対',   # 前走での位置取り
    '前走先行',      # 前走で先行していたか
    '斤量変化',      # 斤量の増減
    '前走負けタイム', # 前走でどれだけ負けたか
    '頭数差',        # 相手関係の増減
]
print(f"特徴量: 旧47 → 新{len(features)}")

df_feat=df[features].copy()
medians={col: float(df_feat[col].median()) for col in features}
for col in features: df_feat[col]=df_feat[col].fillna(medians[col])

y=(df['着順_num']==1).astype(int)
print("学習中...")
X_tr,X_te,y_tr,y_te=train_test_split(df_feat.values,y.values,test_size=0.2,random_state=42,stratify=y)
model=HistGradientBoostingClassifier(
    max_iter=500, max_depth=7, learning_rate=0.05,
    min_samples_leaf=25, l2_regularization=0.1, random_state=42)
model.fit(X_tr, y_tr)

y_prob=model.predict_proba(X_te)[:,1]
tdf=pd.DataFrame({'rk':df['race_key'].values[-len(X_te):],'actual':y_te,'prob':y_prob})
wr=tdf.groupby('rk').apply(lambda g:int(g.loc[g['prob'].idxmax(),'actual']==1)).mean()
t3=tdf.groupby('rk').apply(lambda g:int(g.nlargest(3,'prob')['actual'].any())).mean()

print(f"\n=== 結果 ===")
print(f"旧: 1着的中率 28.43% / 3着内 48.33%")
print(f"新: 1着的中率 {wr*100:.2f}% / 3着内 {t3*100:.2f}%")

with open('/home/claude/keiba_app/model_v2.pkl','wb') as f:
    pickle.dump({
        'model':model,'features':features,'medians':medians,
        'win_rate':float(wr),'top3_rate':float(t3),'train_size':len(df),
        'jockey_win_rates':jw,'jockey_counts':jc
    },f)
print("✅ model_v2.pkl 保存完了")
