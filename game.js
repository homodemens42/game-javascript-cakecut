const CONFIG = {
  // assets/cake1.png ～ cake30.png のうち、存在する画像を自動検出して
  // ラウンドごとにランダムで表示します。
  cakeImageMaxNumber: 30,

  // A new problem randomly asks for 2-8 pieces.
  minTargetParts: 2,
  maxTargetParts: 8,

  // Hidden madness threshold. It is intentionally not shown below this value.
  madnessThreshold: 0.50,

  // 狂気は「正確なのに変な切り方」を評価します。
  // 通常は90%以上。閉ループを作る明確な構造狂気がある場合のみ
  // フリーハンド誤差を考慮して最低精度を少し緩和します。
  madnessMinAccuracy: 90,
  madnessLoopAccuracy1: 85,
  madnessLoopAccuracy2: 83,
  madnessLoopAccuracy3Plus: 80,

  // 狂気スコアの係数。
  // 距離超過率 × 1.5、余分な1カット +15%、閉ループ1個 +50%。
  madnessLengthMultiplier: 0.5,
  madnessExtraCutBonus: 0.15,
  madnessLoopBonus: 0.50,

  // 端点・既存線・円周へのスナップ距離（画面px）。
  snapDistance: 12,

  // Internal raster resolution used to estimate the final regions.
  // Higher = more accurate but more CPU work.
  analysisSize: 700,

  // Small gap around a cut line in the analysis grid.
  cutThickness: 2.5,
};

// ============================================================
// RESULT MESSAGES
// ============================================================
// リザルト画面の一言はここだけ編集すれば増やせます。
//
// priority : 数字が大きいルールを優先します。
// when     : 条件。true になったルールが候補です。
// messages : 条件に合ったとき、この中からランダムで1つ表示します。
//
// 例：狂気500%以上専用メッセージを追加したい場合
// {
//   id: "madness_500",
//   priority: 950,
//   when: ({ scores }) => scores.madness >= 500,
//   messages: ["ここまで来ると芸術です。"]
// },
// ============================================================
const RESULT_MESSAGES = [
  {
    id: "too_few_parts",
    priority: 1000,
    when: ({ analysis, target }) => analysis.regionCount < target,
    messages: [
      "「等分」って知ってる？"
    ],
  },
  {
    id: "too_many_parts",
    priority: 1000,
    when: ({ analysis, target }) => analysis.regionCount > target,
    messages: [
      "「等分」って知ってる？"
    ],
  },
  {
    id: "madness_300",
    priority: 900,
    when: ({ scores }) => scores.madness >= 300,
    messages: [
      ""    ],
  },
  {
    id: "madness_200",
    priority: 800,
    when: ({ scores }) => scores.madness >= 200,
    messages: [
      ""
    ],
  },
  {
    id: "madness_100",
    priority: 700,
    when: ({ scores }) => scores.madness >= 100,
    messages: [
      ""
    ],
  },
  {
    id: "loop",
    priority: 650,
    when: ({ scores }) => scores.loopCount >= 1,
    messages: [
      ""
    ],
  },
  {
    id: "madness",
    priority: 600,
    when: ({ scores }) => scores.madnessRatio > CONFIG.madnessThreshold,
    messages: [
      ""
    ],
  },
  {
    id: "perfect",
    priority: 500,
    when: ({ scores }) => scores.accuracy >= 99.5,
    messages: [
      ""
    ],
  },
  {
    id: "very_accurate",
    priority: 400,
    when: ({ scores }) => scores.accuracy >= 95,
    messages: [
      ""
    ],
  },
  {
    id: "accurate",
    priority: 300,
    when: ({ scores }) => scores.accuracy >= 90,
    messages: [
      ""
    ],
  },
  {
    id: "default",
    priority: 0,
    when: () => true,
    messages: [
      ""
    ],
  },
];

// 初回は cake1.png を即表示し、プレイ中に残りをバックグラウンド確認します。
let availableCakeImages = ["assets/cake1.png"];
let cakeImageScanPromise = null;

// タイトル画面を見ている間に初回用画像だけ先読み。
const cake1Preload = new Image();
cake1Preload.src = "assets/cake1.png";

const titleScreen = document.getElementById("titleScreen");
const gameScreen = document.getElementById("gameScreen");
const resultScreen = document.getElementById("resultScreen");
const startButton = document.getElementById("startButton");
const backButton = document.getElementById("backButton");
const finishButton = document.getElementById("finishButton");
const retryButton = document.getElementById("retryButton");
const shareButton = document.getElementById("shareButton");
const resultCanvas = document.getElementById("resultCanvas");
const targetText = document.getElementById("targetText");
const cutCountText = document.getElementById("cutCountText");
const resultTarget = document.getElementById("resultTarget");
const accuracyScore = document.getElementById("accuracyScore");
const efficiencyScore = document.getElementById("efficiencyScore");
const madnessScore = document.getElementById("madnessScore");
const madnessCard = document.getElementById("madnessCard");
const resultMessage = document.getElementById("resultMessage");
const hint = document.getElementById("hint");
const canvas = document.getElementById("cakeCanvas");
const ctx = canvas.getContext("2d");

let cakeImage = new Image();
let cakeInfo = null;
let cuts = [];
let pendingStart = null;
let previewPoint = null;
let currentTargetParts = 5;
let lastScores = null;
let lastAnalysis = null;
let displaySize = 800;

startButton.addEventListener("click", startGame);
backButton.addEventListener("click", showTitle);
finishButton.addEventListener("click", finishGame);
retryButton.addEventListener("click", startGame);
shareButton.addEventListener("click", shareResult);

// HTMLを変更しなくても使えるよう、操作ボタンをJS側で追加します。
const undoButton = document.createElement("button");
undoButton.id = "undoButton";
undoButton.className = "secondary-button";
undoButton.textContent = "1手戻る";
finishButton.parentElement.insertBefore(undoButton, finishButton);
undoButton.addEventListener("click", undoLastCut);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancelPendingCut();
});
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  cancelPendingCut();
});

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function scanAvailableCakeImages() {
  if (cakeImageScanPromise) return cakeImageScanPromise;

  cakeImageScanPromise = (async () => {
    const candidates = [];
    for (let i = 1; i <= CONFIG.cakeImageMaxNumber; i++) {
      candidates.push(`assets/cake${i}.png`);
    }

    const checks = candidates.map(src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(null);
      img.src = src;
    }));

    const results = await Promise.all(checks);
    const found = results.filter(Boolean);

    if (found.length) {
      availableCakeImages = found;
    } else {
      console.error("assetsフォルダに利用可能なケーキ画像がありません。");
    }

    return availableCakeImages;
  })();

  return cakeImageScanPromise;
}

async function startGame() {
  cuts = [];
  pendingStart = null;
  previewPoint = null;
  lastScores = null;
  lastAnalysis = null;

  currentTargetParts =
    randomInt(CONFIG.minTargetParts, CONFIG.maxTargetParts);

  targetText.textContent = `${currentTargetParts}等分`;
  cutCountText.textContent = "ピース 1";
  hint.textContent =
    "始点をクリックして、終点をクリックしてください。端点・線・円周の近くでは自動的に吸着します。";

  titleScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  // 初回は cake1 を待たずに使用。スキャン完了後のラウンドは確認済み一覧からランダム。
  const selected = randomChoice(availableCakeImages);
  cakeImage = new Image();

  cakeImage.onload = () => {
    cakeInfo = buildCakeInfo(cakeImage);
    resizeCanvas();
    draw();

    // 画面表示後に cake1～cakeN の存在確認を開始。
    // 次のゲームから確認済み画像をランダム利用できます。
    scanAvailableCakeImages().catch(error => {
      console.error("ケーキ画像のバックグラウンド確認に失敗しました。", error);
    });
  };

  cakeImage.onerror = () => {
    alert(`ケーキ画像を読み込めませんでした: ${selected}`);
    showTitle();
  };

  cakeImage.src = selected;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function showTitle() {
  gameScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  titleScreen.classList.remove("hidden");
}

function resizeCanvas() {
  if (gameScreen.classList.contains("hidden")) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const oldDisplaySize = displaySize;
  const newDisplaySize = rect.width;

  // 保存済みのカット座標は画面座標なので、Canvasサイズ変更時に同じ比率で追従させます。
  if (oldDisplaySize > 0 && newDisplaySize > 0 && oldDisplaySize !== newDisplaySize) {
    const scale = newDisplaySize / oldDisplaySize;
    const scalePoint = (point) => {
      if (!point) return;
      point.x *= scale;
      point.y *= scale;
    };

    for (const cut of cuts) {
      scalePoint(cut.a);
      scalePoint(cut.b);
      scalePoint(cut.cutA);
      scalePoint(cut.cutB);
      cut.length *= scale;
    }
    scalePoint(pendingStart);
    scalePoint(previewPoint);
  }

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  displaySize = newDisplaySize;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function buildCakeInfo(img) {
  // The current asset is a round cake on a square background.
  // Keep the gameplay shape separate from the visual asset so the image
  // can be replaced later without rewriting the cutting logic.
  const size = Math.min(img.naturalWidth, img.naturalHeight);
  return {
    shape: "circle",
    centerX: displaySize / 2,
    centerY: displaySize / 2,
    radius: displaySize * 0.43,
    sourceCrop: {
      x: (img.naturalWidth - size) / 2,
      y: (img.naturalHeight - size) / 2,
      w: size,
      h: size,
    },
  };
}

function updateCakeInfoForDisplay() {
  if (!cakeInfo) return;
  cakeInfo.centerX = displaySize / 2;
  cakeInfo.centerY = displaySize / 2;
  cakeInfo.radius = displaySize * 0.43;
}

function draw() {
  if (!cakeImage.complete || !cakeImage.naturalWidth) return;

  updateCakeInfoForDisplay();

  ctx.clearRect(0, 0, displaySize, displaySize);

  // Background.
  ctx.fillStyle = "#fffaf5";
  ctx.fillRect(0, 0, displaySize, displaySize);

  // Cake visual clipped to the gameplay circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cakeInfo.centerX, cakeInfo.centerY, cakeInfo.radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(
    cakeImage,
    cakeInfo.sourceCrop.x,
    cakeInfo.sourceCrop.y,
    cakeInfo.sourceCrop.w,
    cakeInfo.sourceCrop.h,
    cakeInfo.centerX - cakeInfo.radius,
    cakeInfo.centerY - cakeInfo.radius,
    cakeInfo.radius * 2,
    cakeInfo.radius * 2
  );
  ctx.restore();

  // Cake outline.
  ctx.beginPath();
  ctx.arc(cakeInfo.centerX, cakeInfo.centerY, cakeInfo.radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(80, 50, 35, .35)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Existing cuts.
  for (const cut of cuts) {
    drawCut(cut, false);
  }

  // Live preview from the first click to the current cursor position.
  if (pendingStart && previewPoint) {
    drawPreviewCut(pendingStart, previewPoint);
  }

  // Pending first click.
  if (pendingStart) {
    ctx.beginPath();
    ctx.arc(pendingStart.x, pendingStart.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#9d5b3d";
    ctx.fill();
  }
}

function drawCut(cut, preview) {
  ctx.save();

  // The line can extend outside the cake. The whole line is shown so the
  // player can see exactly where they clicked.
  ctx.beginPath();
  ctx.moveTo(cut.a.x, cut.a.y);
  ctx.lineTo(cut.b.x, cut.b.y);
  ctx.strokeStyle = preview ? "#9d5b3d" : "rgba(77, 51, 40, .35)";
  ctx.lineWidth = preview ? 3 : 3;
  ctx.lineCap = "round";
  ctx.stroke();

  // Actual cutting part inside the cake.
  if (cut.cutA && cut.cutB) {
    ctx.beginPath();
    ctx.moveTo(cut.cutA.x, cut.cutA.y);
    ctx.lineTo(cut.cutB.x, cut.cutB.y);
    ctx.strokeStyle = preview ? "#9d5b3d" : "#4d3328";
    ctx.lineWidth = preview ? 3 : 4;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cut.a.x, cut.a.y, 4, 0, Math.PI * 2);
  ctx.arc(cut.b.x, cut.b.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#4d3328";
  ctx.fill();

  ctx.restore();
}


function drawPreviewCut(a, b) {
  ctx.save();

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = "rgba(157, 91, 61, .65)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.setLineDash([8, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#9d5b3d";
  ctx.fill();

  ctx.restore();
}

canvas.addEventListener("mousemove", (event) => {
  if (!pendingStart || !cakeInfo) return;
  previewPoint = snapPoint(canvasPoint(event));
  draw();
});

canvas.addEventListener("mouseleave", () => {
  if (!pendingStart) return;
  previewPoint = null;
  draw();
});

canvas.addEventListener("touchmove", (event) => {
  if (!pendingStart || !cakeInfo) return;
  const touch = event.touches[0];
  if (!touch) return;
  const rect = canvas.getBoundingClientRect();
  previewPoint = snapPoint({
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  });
  draw();
}, { passive: true });

canvas.addEventListener("click", (event) => {
  if (!cakeInfo) return;

  const rawPoint = canvasPoint(event);
  const p = snapPoint(rawPoint);

  if (!pendingStart) {
    pendingStart = p;
    previewPoint = p;
    hint.textContent =
      "終点をクリックしてください。マウスを動かすと切断予定線が表示されます。";
    draw();
    return;
  }

  const distance = Math.hypot(p.x - pendingStart.x, p.y - pendingStart.y);
  if (distance < 8) {
    hint.textContent = "始点と終点を少し離してください。";
    return;
  }

  const clipped = clipSegmentToCake(pendingStart, p);
  if (!clipped) {
    hint.textContent =
      "その2点を結んでもケーキを切れません。ケーキを横切る線にしてください。";
    return;
  }

  cuts.push({
    a: pendingStart,
    b: p,
    cutA: clipped.a,
    cutB: clipped.b,
    length: clipped.length,
  });

  pendingStart = null;
  previewPoint = null;

  // Show the current number of actual connected pieces immediately.
  const analysis = analyzeCuts();
  lastAnalysis = analysis;
  cutCountText.textContent = `ピース ${analysis.regionCount}`;
  hint.textContent =
    `現在 ${analysis.regionCount}ピース / 目標 ${currentTargetParts}等分`;
  draw();
});

function cancelPendingCut() {
  if (!pendingStart) return;
  pendingStart = null;
  previewPoint = null;
  hint.textContent = `現在 ${lastAnalysis ? lastAnalysis.regionCount : analyzeCuts().regionCount}ピース / 目標 ${currentTargetParts}等分`;
  draw();
}

function undoLastCut() {
  // 始点選択中なら、まずその始点だけ取り消します。
  if (pendingStart) {
    cancelPendingCut();
    return;
  }

  if (!cuts.length) {
    hint.textContent = "戻せるカットはありません。";
    return;
  }

  cuts.pop();
  const analysis = analyzeCuts();
  lastAnalysis = analysis;
  cutCountText.textContent = `ピース ${analysis.regionCount}`;
  hint.textContent = `1手戻しました。現在 ${analysis.regionCount}ピース / 目標 ${currentTargetParts}等分`;
  draw();
}

function clipSegmentToCake(a, b) {
  const cx = cakeInfo.centerX;
  const cy = cakeInfo.centerY;
  const r = cakeInfo.radius;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - cx;
  const fy = a.y - cy;

  const A = dx * dx + dy * dy;
  if (A === 0) return null;

  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const discriminant = B * B - 4 * A * C;

  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  let t1 = (-B - sqrtD) / (2 * A);
  let t2 = (-B + sqrtD) / (2 * A);
  if (t1 > t2) [t1, t2] = [t2, t1];

  // Only the part of the clicked segment between the two
  // circle intersections counts as the actual cut.
  const enter = Math.max(0, t1);
  const exit = Math.min(1, t2);

  if (enter >= exit) return null;

  const cutA = {
    x: a.x + dx * enter,
    y: a.y + dy * enter,
  };
  const cutB = {
    x: a.x + dx * exit,
    y: a.y + dy * exit,
  };

  const length = Math.hypot(cutB.x - cutA.x, cutB.y - cutA.y);
  if (length < 1) return null;

  return { a: cutA, b: cutB, length };
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function pointInsideCake(p) {
  const dx = p.x - cakeInfo.centerX;
  const dy = p.y - cakeInfo.centerY;
  return dx * dx + dy * dy <= cakeInfo.radius * cakeInfo.radius;
}


// ============================================================
// SNAP SYSTEM
// ============================================================
// プレイヤーが数pxずれてクリックしても、見た目どおり線が接続されるように
// 既存端点 → 既存線 → 円周 の順で最寄り候補へ吸着します。
function snapPoint(point) {
  if (!cakeInfo) return point;

  let bestPoint = { ...point };
  let bestDistance = CONFIG.snapDistance;

  // 1. 既存カットの端点へスナップ
  for (const cut of cuts) {
    for (const p of [cut.cutA, cut.cutB]) {
      if (!p) continue;
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = { x: p.x, y: p.y };
      }
    }
  }

  // 2. 既存の切断線上へスナップ
  for (const cut of cuts) {
    if (!cut.cutA || !cut.cutB) continue;
    const nearest = nearestPointOnSegment(point, cut.cutA, cut.cutB);
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = nearest;
    }
  }

  // 3. 円周へスナップ
  const dx = point.x - cakeInfo.centerX;
  const dy = point.y - cakeInfo.centerY;
  const distanceFromCenter = Math.hypot(dx, dy);

  if (distanceFromCenter > 0) {
    const distanceFromEdge = Math.abs(distanceFromCenter - cakeInfo.radius);
    if (distanceFromEdge < bestDistance) {
      const scale = cakeInfo.radius / distanceFromCenter;
      bestPoint = {
        x: cakeInfo.centerX + dx * scale,
        y: cakeInfo.centerY + dy * scale,
      };
    }
  }

  return bestPoint;
}

function nearestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return { x: a.x, y: a.y };

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
  };
}



function getResultMessage(analysis, scores) {
  const context = {
    analysis,
    scores,
    target: currentTargetParts,
    cuts,
  };

  const rule = [...RESULT_MESSAGES]
    .sort((a, b) => b.priority - a.priority)
    .find(item => item.when(context));

  if (!rule || !rule.messages.length) return "";
  return randomChoice(rule.messages);
}

function finishGame() {
  if (!cakeInfo) return;

  const analysis = analyzeCuts();
  const scores = calculateScores(analysis);

  lastAnalysis = analysis;
  lastScores = scores;

  resultTarget.textContent =
    `${currentTargetParts}等分 / ${analysis.regionCount}ピース`;
  accuracyScore.textContent = `${scores.accuracy.toFixed(2)}%`;
  efficiencyScore.textContent = `${scores.efficiency.toFixed(2)}%`;

  if (scores.madnessRatio > CONFIG.madnessThreshold) {
    madnessCard.classList.remove("hidden");
    madnessScore.textContent = `${scores.madness.toFixed(2)}%`;
  } else {
    madnessCard.classList.add("hidden");
  }

  renderResultImage();

  resultMessage.textContent = getResultMessage(analysis, scores);

  gameScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
}


async function shareResult() {
  if (!lastScores || !lastAnalysis) return;

  const blob = await resultCanvasToBlob();
  if (!blob) return;

  const text = buildShareText();
  const file = new File([blob], "cake-cutting-result.png", {
    type: "image/png",
  });

  // Web Share with files requires a secure context (HTTPS or localhost).
  // A file:// page is not a reliable environment for this API.
  if (window.isSecureContext && navigator.share) {
    try {
      const canShareFiles =
        !navigator.canShare || navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({
          title: "ケーキを切れ！",
          text,
          files: [file],
        });
        return;
      }
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  // X fallback. X's web intent accepts text, but a normal browser page
  // cannot attach a generated local PNG to that post automatically.
  const xUrl =
    "https://twitter.com/intent/tweet?text=" +
    encodeURIComponent(text);
  const opened = window.open(xUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = xUrl;
  }
}

function resultCanvasToBlob() {
  return new Promise((resolve) => {
    if (!resultCanvas.width || !resultCanvas.height) {
      resolve(null);
      return;
    }
    resultCanvas.toBlob(resolve, "image/png");
  });
}


function buildShareText() {
  const madnessText =
    lastScores && lastScores.madnessRatio > CONFIG.madnessThreshold
      ? `\n狂気：${lastScores.madness.toFixed(2)}%`
      : "";

  return [
    `🎂 ケーキを${currentTargetParts}等分`,
    `正確さ：${lastScores.accuracy.toFixed(2)}%`,
    `効率：${lastScores.efficiency.toFixed(2)}%`,
    `切断距離：${cuts.reduce((s, c) => s + c.length, 0).toFixed(1)}px`,
    `カット回数：${cuts.length}`,
    madnessText.trim(),
    "#ケーキの切れる健康優良不良少年たち",
  ].filter(Boolean).join("\n");
}

function renderResultImage() {
  if (!cakeImage.complete || !cakeImage.naturalWidth || !lastScores || !lastAnalysis) {
    return;
  }

  // Result preview is intentionally just the round cake with the cuts drawn
  // over it. The score/result text stays in the normal result UI.
  const size = 900;
  resultCanvas.width = size;
  resultCanvas.height = size;
  const c = resultCanvas.getContext("2d");

  c.fillStyle = "#fffaf5";
  c.fillRect(0, 0, size, size);

  const cakeCx = size / 2;
  const cakeCy = size / 2;
  const cakeR = 390;

  // Cake image.
  c.save();
  c.beginPath();
  c.arc(cakeCx, cakeCy, cakeR, 0, Math.PI * 2);
  c.clip();

  const sourceSize = Math.min(cakeImage.naturalWidth, cakeImage.naturalHeight);
  const sx = (cakeImage.naturalWidth - sourceSize) / 2;
  const sy = (cakeImage.naturalHeight - sourceSize) / 2;
  c.drawImage(
    cakeImage,
    sx, sy, sourceSize, sourceSize,
    cakeCx - cakeR, cakeCy - cakeR, cakeR * 2, cakeR * 2
  );
  c.restore();

  // Cake outline.
  c.beginPath();
  c.arc(cakeCx, cakeCy, cakeR, 0, Math.PI * 2);
  c.strokeStyle = "rgba(80,50,35,.35)";
  c.lineWidth = 4;
  c.stroke();

  // Map the actual cut segments from the gameplay canvas to this result cake.
  const gameCakeCx = displaySize / 2;
  const gameCakeCy = displaySize / 2;
  const gameCakeR = displaySize * 0.43;

  function transformPoint(p) {
    return {
      x: cakeCx + (p.x - gameCakeCx) * (cakeR / gameCakeR),
      y: cakeCy + (p.y - gameCakeCy) * (cakeR / gameCakeR),
    };
  }

  c.save();
  c.beginPath();
  c.arc(cakeCx, cakeCy, cakeR, 0, Math.PI * 2);
  c.clip();

  for (const cut of cuts) {
    const a = transformPoint(cut.cutA);
    const b = transformPoint(cut.cutB);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = "#4d3328";
    c.lineWidth = 7;
    c.lineCap = "round";
    c.stroke();
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/*
 * Prototype analysis
 * ------------------
 * The game area is a circle. We rasterize the cake into a high-resolution
 * grid and treat each drawn cut as a thin barrier, then flood-fill the
 * remaining cake pixels. This deliberately allows arbitrary numbers and
 * arbitrary shapes of cuts.
 *
 * It is not the final "perfect geometry" implementation yet; it is a good
 * first playable version and can later be replaced by polygon/geometry
 * operations without changing the UI or score structure.
 */
function analyzeCuts() {
  const n = CONFIG.analysisSize;
  const cx = n / 2;
  const cy = n / 2;
  const r = n * 0.43;

  const inside = new Uint8Array(n * n);
  const blocked = new Uint8Array(n * n);
  const visited = new Uint8Array(n * n);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) - cx;
      const dy = (y + 0.5) - cy;
      if (dx * dx + dy * dy <= r * r) {
        inside[y * n + x] = 1;
      }
    }
  }

  // Convert screen coordinates into analysis-grid coordinates and mark
  // pixels close to each actual cut segment as barriers.
  for (const cut of cuts) {
    const ax = (cut.cutA.x / displaySize) * n;
    const ay = (cut.cutA.y / displaySize) * n;
    const bx = (cut.cutB.x / displaySize) * n;
    const by = (cut.cutB.y / displaySize) * n;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - 5));
    const maxX = Math.min(n - 1, Math.ceil(Math.max(ax, bx) + 5));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - 5));
    const maxY = Math.min(n - 1, Math.ceil(Math.max(ay, by) + 5));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const d = pointToSegmentDistance(px, py, ax, ay, bx, by);
        if (d <= CONFIG.cutThickness) {
          blocked[y * n + x] = 1;
        }
      }
    }
  }

  const regionSizes = [];
  // x/yを別々に持たず、1次元indexだけをキューに積んでメモリとGC負荷を減らします。
  const queue = new Int32Array(n * n);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      if (!inside[idx] || blocked[idx] || visited[idx]) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;

      let size = 0;

      while (head < tail) {
        const current = queue[head++];
        const qx = current % n;
        const qy = Math.floor(current / n);
        size++;

        // 配列を毎ピクセル生成せず4方向を直接確認します。
        if (qx + 1 < n) {
          const ni = current + 1;
          if (inside[ni] && !blocked[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (qx > 0) {
          const ni = current - 1;
          if (inside[ni] && !blocked[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (qy + 1 < n) {
          const ni = current + n;
          if (inside[ni] && !blocked[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
        if (qy > 0) {
          const ni = current - n;
          if (inside[ni] && !blocked[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
      }

      regionSizes.push(size);
    }
  }

  regionSizes.sort((a, b) => b - a);

  return {
    regionCount: regionSizes.length,
    regionSizes,
    totalArea: regionSizes.reduce((a, b) => a + b, 0),
  };
}

// ============================================================
// CUT STRUCTURE ANALYSIS
// ============================================================
// 切断線をグラフとして見て「閉ループ」を数えます。
// 各線の端点と交点を頂点、頂点間の線分を辺として扱い、
// 閉路数 = 辺数 - 頂点数 + 連結成分数 で求めます。
function analyzeCutStructure() {
  if (!cuts.length) {
    return { loopCount: 0, vertexCount: 0, edgeCount: 0, componentCount: 0 };
  }

  const EPSILON = 4;
  const pointsPerCut = cuts.map(cut => [
    { ...cut.cutA },
    { ...cut.cutB },
  ]);

  // 線同士の交点を各カット上の頂点候補として追加
  for (let i = 0; i < cuts.length; i++) {
    for (let j = i + 1; j < cuts.length; j++) {
      const intersection = segmentIntersection(
        cuts[i].cutA, cuts[i].cutB,
        cuts[j].cutA, cuts[j].cutB
      );
      if (!intersection) continue;
      pointsPerCut[i].push(intersection);
      pointsPerCut[j].push(intersection);
    }
  }

  const vertices = [];
  function getVertexIndex(point) {
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (Math.hypot(point.x - v.x, point.y - v.y) <= EPSILON) return i;
    }
    vertices.push({ x: point.x, y: point.y });
    return vertices.length - 1;
  }

  const edges = [];

  // 各切断線を交点で分割してグラフの辺にする
  for (let cutIndex = 0; cutIndex < cuts.length; cutIndex++) {
    const cut = cuts[cutIndex];
    const points = pointsPerCut[cutIndex];
    const dx = cut.cutB.x - cut.cutA.x;
    const dy = cut.cutB.y - cut.cutA.y;
    const lengthSquared = dx * dx + dy * dy;

    const sorted = points
      .map(point => ({
        point,
        t: lengthSquared > 0
          ? ((point.x - cut.cutA.x) * dx + (point.y - cut.cutA.y) * dy) / lengthSquared
          : 0,
      }))
      .sort((a, b) => a.t - b.t);

    const unique = [];
    for (const item of sorted) {
      if (
        !unique.length ||
        Math.hypot(
          item.point.x - unique[unique.length - 1].point.x,
          item.point.y - unique[unique.length - 1].point.y
        ) > EPSILON
      ) {
        unique.push(item);
      }
    }

    for (let i = 0; i < unique.length - 1; i++) {
      const a = getVertexIndex(unique[i].point);
      const b = getVertexIndex(unique[i + 1].point);
      if (a !== b) edges.push([a, b]);
    }
  }

  const adjacency = Array.from({ length: vertices.length }, () => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  const visited = new Array(vertices.length).fill(false);
  let componentCount = 0;

  for (let start = 0; start < vertices.length; start++) {
    if (visited[start]) continue;
    if (adjacency[start].length === 0) {
      visited[start] = true;
      continue;
    }

    componentCount++;
    const stack = [start];
    visited[start] = true;

    while (stack.length) {
      const current = stack.pop();
      for (const next of adjacency[current]) {
        if (visited[next]) continue;
        visited[next] = true;
        stack.push(next);
      }
    }
  }

  const activeVertexCount = adjacency.filter(list => list.length > 0).length;
  const loopCount = Math.max(0, edges.length - activeVertexCount + componentCount);

  return {
    loopCount,
    vertexCount: activeVertexCount,
    edgeCount: edges.length,
    componentCount,
  };
}

function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;

  if (Math.abs(denominator) < 0.000001) return null;

  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: a.x + t * rx,
    y: a.y + t * ry,
  };
}

function estimateReferenceCutCount(parts) {
  // 「普通に切るなら何本か」のゲーム上の基準。
  // 2等分=直径1本、3等分=中心から3本、4等分=十字2本。
  switch (parts) {
    case 2: return 1;
    case 3: return 3;
    case 4: return 2;
    case 6: return 3;
    case 8: return 4;
    default: return parts;
  }
}

function getMadnessMinAccuracy(loopCount) {
  if (loopCount >= 3) return CONFIG.madnessLoopAccuracy3Plus;
  if (loopCount === 2) return CONFIG.madnessLoopAccuracy2;
  if (loopCount === 1) return CONFIG.madnessLoopAccuracy1;
  return CONFIG.madnessMinAccuracy;
}

function getMadnessAccuracyFactor(accuracy) {
  if (accuracy >= 95) return 1.00;
  if (accuracy >= 90) return 0.90;
  if (accuracy >= 85) return 0.70;
  if (accuracy >= 80) return 0.40;
  return 0;
}

function calculateScores(analysis) {
  const target = currentTargetParts;

  // 指定ピース数でなければ完全失敗。全スコア0。
  if (analysis.regionCount !== target) {
    return {
      accuracy: 0,
      efficiency: 0,
      madness: 0,
      madnessRatio: 0,
      loopCount: 0,
      extraCuts: 0,
    };
  }

  // 正確さ：各ピース面積の均等度
  const total = analysis.totalArea;
  const ideal = total / target;
  const accuracy = 100 * areaEqualityScore(analysis.regionSizes, ideal);

  // 効率：基準切断距離 / 実際の切断距離
  const optimalCutLength = estimateCircleReferenceLength(target);
  const actualCutLength = cuts.reduce((sum, cut) => sum + cut.length, 0);
  const efficiency = actualCutLength > 0
    ? Math.min(100, (optimalCutLength / actualCutLength) * 100)
    : 0;

  // 狂気は「正確なのに変な切り方」専用。
  // まず構造を解析し、閉ループがある場合だけフリーハンド誤差を少し救済します。
  const structure = analyzeCutStructure();
  const minAccuracyForMadness = getMadnessMinAccuracy(structure.loopCount);

  if (accuracy < minAccuracyForMadness) {
    return {
      accuracy,
      efficiency,
      madness: 0,
      madnessRatio: 0,
      loopCount: structure.loopCount,
      extraCuts: 0,
    };
  }

  // 1) 距離：基準より長い割合 × 係数
  const excessLengthRatio = optimalCutLength > 0
    ? Math.max(0, actualCutLength / optimalCutLength - 1)
    : 0;
  const lengthMadness = excessLengthRatio * CONFIG.madnessLengthMultiplier;

  // 2) 本数：普通の切り方より余分なカット1本ごとに加点
  const referenceCutCount = estimateReferenceCutCount(target);
  const extraCuts = Math.max(0, cuts.length - referenceCutCount);
  const cutMadness = extraCuts * CONFIG.madnessExtraCutBonus;

  // 3) 構造：閉ループ1個ごとに加点
  const loopMadness = structure.loopCount * CONFIG.madnessLoopBonus;

  // フリーハンド誤差を許容した分、精度が低い場合は狂気を段階的に減衰。
  // 雑な切り方が「狂気」になるのを防ぎつつ、円積問題的な挑戦は拾います。
  const accuracyFactor = getMadnessAccuracyFactor(accuracy);

  // 上限は設けません。100%、200%、300%超えもそのまま表示します。
  const rawMadnessRatio = lengthMadness + cutMadness + loopMadness;
  const madnessRatio = rawMadnessRatio * accuracyFactor;
  const madness = madnessRatio * 100;

  return {
    accuracy,
    efficiency,
    madness,
    madnessRatio,
    loopCount: structure.loopCount,
    extraCuts,
  };
}

function areaEqualityScore(sizes, ideal) {
  if (!sizes.length || ideal <= 0) return 0;

  const meanRelativeError =
    sizes.reduce((sum, s) => sum + Math.abs(s - ideal) / ideal, 0) / sizes.length;

  return Math.max(0, 1 - meanRelativeError);
}

function estimateCircleReferenceLength(parts) {
  // A simple playable reference for now:
  // equally spaced radial cuts from the center to the edge.
  // This will be replaced by per-shape/per-target optimal solutions later.
  const radius = displaySize * 0.43;
  return parts * radius;
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
  );

  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}
