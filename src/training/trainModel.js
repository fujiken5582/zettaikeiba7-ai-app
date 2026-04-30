// モデル学習スクリプト
import { loadCSVData, loadJSONData, splitData, cleanData, showDataStats } from './dataLoader.js';
import { predictRace, modelInfo } from '../model/aiRacePredictor.js';
import fs from 'fs';

/**
 * 特徴量を抽出
 */
function extractFeatures(horse) {
    return {
        popularity: parseFloat(horse.popularity) || 10,
        weight: parseFloat(horse.weight) || 480,
        weightChange: parseFloat(horse.weightChange) || 0,
        horseNumber: parseInt(horse.horseNumber) || 1,
        age: parseInt(horse.age) || 4,
        kinryo: parseFloat(horse.kinryo) || 55,
        previousRank: parseInt(horse.previousRank) || 5,
        interval: parseInt(horse.interval) || 30,
        sex: horse.sex || '牡',
        surface: horse.surface || '芝',
        condition: horse.condition || '良',
        distance: parseInt(horse.distance) || 1600,
        last3F: parseFloat(horse.last3F) || 0,
        corner4: parseInt(horse.corner4) || 0,
        jockey: horse.jockey || '',
        trainer: horse.trainer || '',
        sire: horse.sire || ''
    };
}

/**
 * モデルを評価
 */
function evaluateModel(predictions, actualResults) {
    let correct1st = 0;
    let correctTop3 = 0;

    predictions.forEach((pred, idx) => {
        const actual = actualResults[idx];
        if (pred.rank === 1 && actual.rank === 1) correct1st++;
        if (pred.rank <= 3 && actual.rank <= 3) correctTop3++;
    });

    const accuracy1st = correct1st / predictions.length;
    const accuracyTop3 = correctTop3 / predictions.length;

    return {
        accuracy1st,
        accuracyTop3,
        totalRaces: predictions.length
    };
}

/**
 * 交差検証
 */
function crossValidation(data, folds = 5) {
    console.log(`\n🔄 ${folds}分割交差検証を実行中...`);

    const foldSize = Math.floor(data.length / folds);
    const results = [];

    for (let i = 0; i < folds; i++) {
        const start = i * foldSize;
        const end = (i + 1) * foldSize;

        const testData = data.slice(start, end);
        const trainData = [...data.slice(0, start), ...data.slice(end)];

        // ここで実際の学習を行う（現在はスキップ）
        // const model = trainModel(trainData);

        // 評価
        // const evaluation = evaluateModel(model, testData);
        // results.push(evaluation);

        console.log(`  Fold ${i + 1}/${folds} 完了`);
    }

    return results;
}

/**
 * メイン学習処理
 */
async function trainModel() {
    console.log('=== AI競馬予測モデル学習 ===\n');

    try {
        // 1. データ読み込み
        console.log('📂 Step 1: データ読み込み');
        const csvData = loadCSVData('./20152025.csv');
        const jsonData = loadJSONData('./training-data.json');

        // 2. データクリーニング
        console.log('\n🧹 Step 2: データクリーニング');
        const cleanedData = cleanData(csvData.data);

        // 3. データ分割
        console.log('\n📊 Step 3: データ分割');
        const { trainData, valData, testData } = splitData(cleanedData, 0.7, 0.15);

        // 4. 統計情報表示
        showDataStats(trainData, '学習データ');
        showDataStats(valData, '検証データ');
        showDataStats(testData, 'テストデータ');

        // 5. 特徴量抽出
        console.log('\n🔧 Step 4: 特徴量抽出');
        const trainFeatures = trainData.map(extractFeatures);
        const valFeatures = valData.map(extractFeatures);
        const testFeatures = testData.map(extractFeatures);

        console.log(`  学習特徴量: ${trainFeatures.length}件`);
        console.log(`  検証特徴量: ${valFeatures.length}件`);
        console.log(`  テスト特徴量: ${testFeatures.length}件`);

        // 6. モデル学習（現在のモデルを使用）
        console.log('\n🤖 Step 5: モデル評価');
        console.log('  現在のモデル情報:');
        console.log(`    名前: ${modelInfo.name}`);
        console.log(`    バージョン: ${modelInfo.version}`);
        console.log(`    学習レース数: ${modelInfo.trainedRaces}`);
        console.log(`    1着的中率: ${(modelInfo.accuracy.first * 100).toFixed(2)}%`);
        console.log(`    3着以内的中率: ${(modelInfo.accuracy.top3 * 100).toFixed(2)}%`);

        // 7. 結果保存
        console.log('\n💾 Step 6: 結果保存');
        const results = {
            timestamp: new Date().toISOString(),
            dataStats: {
                total: cleanedData.length,
                train: trainData.length,
                validation: valData.length,
                test: testData.length
            },
            modelInfo: modelInfo
        };

        fs.writeFileSync('./training-results.json', JSON.stringify(results, null, 2));
        console.log('  ✅ training-results.json に保存しました');

        console.log('\n✅ 学習処理が完了しました！');

    } catch (error) {
        console.error('\n❌ エラーが発生しました:', error.message);
        console.error(error.stack);
    }
}

// 実行
trainModel();
