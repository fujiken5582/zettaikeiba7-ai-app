// AI Race Predictor Logic & UI Controller

// --- Model Weights & Logic (Ported from src/model/aiRacePredictor.js) ---
const weights = {
    "popularity": 0.156068513071268,
    "weight": 0.005206529717948421,
    "weightChange": 0.00024218740777448566,
    "horseNumber": -0.07240185326171078,
    "age": -0.13237613694643907,
    "kinryo": 0.0180785742238031,
    "previousRank": 5.562531059101324,
    "interval": -0.02580815101179964,
    "sexMale": 0.775660905828716,
    "sexFemale": -0.5355304917784095,
    "sexGelding": 1.201135594352724,
    "surfaceTurf": 0.08225737455949977,
    "surfaceDirt": 2.804212919330199,
    "conditionGood": -1.4101201550974438,
    "conditionSlightlyHeavy": 1.8942252078768629,
    "conditionHeavy": -2.5705384060543395,
    "conditionBad": 3.7253829778729073,
    "distanceShort": -1.8478925954020475,
    "distanceMedium": 1.5133977518010386,
    "distanceLong": 2.1057382352263114,
    "last3F": 5.12249609801458,
    "corner4": 0.6662853168692211,
    "trainerWinRate": 1.1524867357385997,
    "sireWinRate": 3.877144900361273,
    "random": -0.9281236268371842
};

// Statistics placeholders (would normally be calculated from full dataset)
// For this demo, we'll use empty stats or build them dynamically from the loaded CSV
let trainerStats = {};
let sireStats = {};

function predictRace(horses) {
    return horses.map(horse => {
        let score = 0;

        score += (20 - horse.popularity) * weights.popularity;
        score += horse.weight * weights.weight;
        score += horse.weightChange * weights.weightChange;
        score += (20 - horse.horseNumber) * weights.horseNumber;
        score += (10 - horse.age) * weights.age;
        score += (60 - horse.kinryo) * weights.kinryo;

        const prevRank = parseInt(horse.previousRank) || 10;
        score += (20 - prevRank) * weights.previousRank;
        score += horse.interval * weights.interval;

        if (horse.sex === '牡') score += weights.sexMale;
        if (horse.sex === '牝') score += weights.sexFemale;
        if (horse.sex === 'セ') score += weights.sexGelding;

        if (horse.surface === '芝') score += weights.surfaceTurf;
        if (horse.surface === 'ダ') score += weights.surfaceDirt;

        if (horse.condition === '良') score += weights.conditionGood;
        if (horse.condition === '稍') score += weights.conditionSlightlyHeavy;
        if (horse.condition === '重') score += weights.conditionHeavy;
        if (horse.condition === '不') score += weights.conditionBad;

        if (horse.distance < 1400) score += weights.distanceShort;
        else if (horse.distance < 2000) score += weights.distanceMedium;
        else score += weights.distanceLong;

        if (horse.last3F > 0) {
            score += (40 - horse.last3F) * weights.last3F;
        }

        if (horse.corner4 > 0) {
            score += (20 - horse.corner4) * weights.corner4;
        }

        const trainerWinRate = trainerStats[horse.trainer]
            ? trainerStats[horse.trainer].wins / trainerStats[horse.trainer].total
            : 0.1;
        score += trainerWinRate * weights.trainerWinRate;

        const sireWinRate = sireStats[horse.sire]
            ? sireStats[horse.sire].wins / sireStats[horse.sire].total
            : 0.1;
        score += sireWinRate * weights.sireWinRate;

        return { horse, score };
    }).sort((a, b) => b.score - a.score);
}

// --- UI Controller ---

const fileInput = document.getElementById('race-file-input');
const fileStatus = document.getElementById('file-status');
const predictBtn = document.getElementById('predict-btn');
const resultSection = document.getElementById('result-section');
const resultList = document.getElementById('result-list');

let loadedRaces = [];

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileStatus.textContent = "読み込み中...";

    try {
        const text = await readFileAsText(file);
        loadedRaces = parseCSV(text);

        // Calculate stats from loaded data
        calculateStats(loadedRaces);

        fileStatus.textContent = `読み込み完了: ${loadedRaces.length}レース`;
        predictBtn.disabled = false;
    } catch (err) {
        console.error(err);
        fileStatus.textContent = "エラー: ファイルを読み込めませんでした";
    }
});

predictBtn.addEventListener('click', () => {
    if (loadedRaces.length === 0) return;

    // For demo, predict the last race in the list
    const targetRace = loadedRaces[loadedRaces.length - 1];
    const prediction = predictRace(targetRace);

    displayResults(prediction);
});

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        // Use Shift_JIS decoder if possible, but FileReader reads as UTF-8 by default usually.
        // However, the original file is Shift_JIS.
        // We need to read as ArrayBuffer and decode.
        reader.readAsArrayBuffer(file);
    }).then(buffer => {
        const decoder = new TextDecoder('shift_jis');
        return decoder.decode(buffer);
    });
}

function parseCSV(content) {
    const lines = content.split('\n');
    const races = [];
    let currentRace = [];
    let currentRaceKey = '';

    // Skip header (line 0)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV split (assuming no commas in fields for this specific dataset structure)
        // The original code used split(',') so we do the same.
        const cols = line.split(',');
        if (cols.length < 50) continue;

        const raceKey = `${cols[1]}-${cols[2]}-${cols[4]}`;

        if (currentRaceKey !== raceKey) {
            if (currentRace.length >= 5) {
                races.push(currentRace);
            }
            currentRace = [];
            currentRaceKey = raceKey;
        }

        const horse = {
            name: cols[5],
            popularity: parseInt(cols[19]) || 99,
            horseNumber: parseInt(cols[12]) || 0,
            weight: parseInt(cols[40]) || 0,
            weightChange: parseInt(cols[41]) || 0,
            jockey: cols[9],
            trainer: cols[28],
            age: parseInt(cols[8]) || 0,
            sex: cols[7],
            kinryo: parseFloat(cols[10]) || 0,
            surface: cols[21],
            distance: parseInt(cols[22]) || 0,
            courseType: cols[23],
            condition: cols[24],
            runTime: parseFloat(cols[29]) || 0,
            timeDiff: parseFloat(cols[30]) || 0,
            corner2: parseInt(cols[31]) || 0,
            corner3: parseInt(cols[32]) || 0,
            corner4: parseInt(cols[33]) || 0,
            last3F: parseFloat(cols[34]) || 0,
            sire: cols[42],
            dam: cols[43],
            damSire: cols[44],
            previousRank: cols[61],
            interval: parseInt(cols[50]) || 0,
            actualRank: cols[20]
        };

        currentRace.push(horse);
    }

    // Push last race
    if (currentRace.length >= 5) {
        races.push(currentRace);
    }

    return races;
}

function calculateStats(races) {
    trainerStats = {};
    sireStats = {};

    races.forEach(horses => {
        horses.forEach(horse => {
            if (!trainerStats[horse.trainer]) {
                trainerStats[horse.trainer] = { wins: 0, total: 0 };
            }
            trainerStats[horse.trainer].total++;

            if (!sireStats[horse.sire]) {
                sireStats[horse.sire] = { wins: 0, total: 0 };
            }
            sireStats[horse.sire].total++;

            const isWinner = horse.actualRank === '１' || horse.actualRank === '1';
            if (isWinner) {
                trainerStats[horse.trainer].wins++;
                sireStats[horse.sire].wins++;
            }
        });
    });
}

function displayResults(prediction) {
    resultList.innerHTML = '';
    resultSection.classList.remove('hidden');

    prediction.forEach((result, index) => {
        const rank = index + 1;
        const horse = result.horse;
        const score = result.score.toFixed(2);

        const item = document.createElement('div');
        item.className = `result-item rank-${rank}`;
        item.innerHTML = `
      <div class="horse-info">
        <span class="horse-name">${rank}. ${horse.name}</span>
        <span class="horse-meta">
          馬番:${horse.horseNumber} / 人気:${horse.popularity} / ${horse.jockey}
        </span>
      </div>
      <div class="score-badge">
        ${score}
      </div>
    `;

        resultList.appendChild(item);
    });

    // Scroll to results
    resultSection.scrollIntoView({ behavior: 'smooth' });
}
