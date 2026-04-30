// データ読み込みと前処理スクリプト
import fs from 'fs';
import path from 'path';

/**
 * CSVファイルを読み込んでJSONに変換
 */
export function loadCSVData(filePath) {
    console.log(`📂 CSVデータを読み込み中: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
        throw new Error('CSVファイルが空です');
    }

    // ヘッダー行を取得
    const headers = lines[0].split(',').map(h => h.trim());
    console.log(`📊 カラム: ${headers.join(', ')}`);

    // データ行を解析
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length !== headers.length) continue;

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index].trim();
        });
        data.push(row);
    }

    console.log(`✅ ${data.length}件のレコードを読み込みました`);
    return { headers, data };
}

/**
 * JSONファイルを読み込み
 */
export function loadJSONData(filePath) {
    console.log(`📂 JSONデータを読み込み中: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    console.log(`✅ データを読み込みました`);
    return data;
}

/**
 * データを学習用・検証用・テスト用に分割
 */
export function splitData(data, trainRatio = 0.7, valRatio = 0.15) {
    const shuffled = [...data].sort(() => Math.random() - 0.5);

    const trainSize = Math.floor(shuffled.length * trainRatio);
    const valSize = Math.floor(shuffled.length * valRatio);

    const trainData = shuffled.slice(0, trainSize);
    const valData = shuffled.slice(trainSize, trainSize + valSize);
    const testData = shuffled.slice(trainSize + valSize);

    console.log(`📊 データ分割:`);
    console.log(`  学習データ: ${trainData.length}件`);
    console.log(`  検証データ: ${valData.length}件`);
    console.log(`  テストデータ: ${testData.length}件`);

    return { trainData, valData, testData };
}

/**
 * データの統計情報を表示
 */
export function showDataStats(data, label = 'データ') {
    console.log(`\n📊 ${label}の統計情報:`);
    console.log(`  総レコード数: ${data.length}`);

    if (data.length > 0) {
        const keys = Object.keys(data[0]);
        console.log(`  カラム数: ${keys.length}`);
        console.log(`  カラム名: ${keys.join(', ')}`);

        // 数値カラムの統計
        keys.forEach(key => {
            const values = data.map(d => parseFloat(d[key])).filter(v => !isNaN(v));
            if (values.length > 0) {
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const min = Math.min(...values);
                const max = Math.max(...values);
                console.log(`  ${key}: 平均=${avg.toFixed(2)}, 最小=${min}, 最大=${max}`);
            }
        });
    }
}

/**
 * データクリーニング
 */
export function cleanData(data) {
    console.log(`🧹 データクリーニング中...`);

    let cleaned = data.filter(row => {
        // 必須フィールドのチェック
        return row.horseName && row.horseNumber;
    });

    // 欠損値の処理
    cleaned = cleaned.map(row => {
        const cleaned = { ...row };

        // 数値フィールドのデフォルト値
        if (!cleaned.popularity || isNaN(cleaned.popularity)) cleaned.popularity = 10;
        if (!cleaned.weight || isNaN(cleaned.weight)) cleaned.weight = 480;
        if (!cleaned.age || isNaN(cleaned.age)) cleaned.age = 4;
        if (!cleaned.kinryo || isNaN(cleaned.kinryo)) cleaned.kinryo = 55;

        return cleaned;
    });

    console.log(`✅ ${data.length}件 → ${cleaned.length}件（${data.length - cleaned.length}件を除外）`);
    return cleaned;
}

// メイン処理（テスト用）
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('=== データ読み込みテスト ===\n');

    try {
        // CSVデータの読み込み
        const csvData = loadCSVData('./20152025.csv');
        showDataStats(csvData.data, 'CSVデータ');

        // JSONデータの読み込み
        const jsonData = loadJSONData('./training-data.json');
        console.log('\nJSONデータ:', JSON.stringify(jsonData).substring(0, 200) + '...');

    } catch (error) {
        console.error('エラー:', error.message);
    }
}
