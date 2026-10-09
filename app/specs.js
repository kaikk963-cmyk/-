// 機種スペック定義。
// 確率・継続率は攻略サイト掲載値をもとにした近似値。出玉は仮の値なので、実機に合わせて調整する。
// payouts は [出玉, 重み] の配列で、重みに比例して振り分ける。
window.SPECS = {
  standard: {
    name: "e東京喰種（2025）",
    normalProb: 199.9,      // 通常時の初当たり合算確率 1/x
    rushEntryRate: 0.51,    // 初当たり時のRUSH突入率
    firstPayouts: [[300, 1]],
    rushProb: 95.3,         // RUSH中の大当たり確率 1/x
    stSpins: 130,           // RUSHのST回転数
    rushPayouts: [[1500, 1]],
    ballsPerSpin: 14,       // 通常時1回転あたりの消費玉数（約18回転/1000円）
  },
  chodeka: {
    name: "e東京喰種 超デカ超一撃ver.",
    normalProb: 349.9,
    rushEntryRate: 0.50,
    firstPayouts: [[300, 1]],
    rushProb: 7.7,
    stSpins: 5,
    rushPayouts: [[3000, 1]],
    ballsPerSpin: 14,
  },
};

window.RENT = { yen: 1000, balls: 250 };
