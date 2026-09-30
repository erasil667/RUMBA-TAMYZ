import { CONFIG } from './config';
import type { Assessment, FeatureSample, MetricResult } from './types';

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function intervalScore(value: number, preferred: readonly [number, number], outer: readonly [number, number]) {
  if (value >= preferred[0] && value <= preferred[1]) return 100;
  if (value < preferred[0]) return Math.round(100 * Math.max(0, (value - outer[0]) / (preferred[0] - outer[0])));
  return Math.round(100 * Math.max(0, (outer[1] - value) / (outer[1] - preferred[1])));
}

export function calculateAssessment(samples: FeatureSample[], leftFrames: number, rightFrames: number): Assessment {
  const enough = samples.length >= 18;
  const metrics: MetricResult[] = [];
  const summary = enough ? {
    symmetryError: median(samples.map(s => s.symmetryError)),
    widthHeightRatio: median(samples.map(s => s.widthHeightRatio)),
    eyeSpacingRatio: median(samples.map(s => s.eyeSpacingRatio)),
  } : null;
  if (summary) {
    const symmetry = Math.max(0, Math.round(100 * (1 - summary.symmetryError / CONFIG.metrics.symmetry.tolerance)));
    metrics.push({ id: 'symmetry', title: 'Визуальная симметрия', score: symmetry, rawValue: summary.symmetryError, displayValue: `${(summary.symmetryError * 100).toFixed(1)}% ширины лица`, weight: CONFIG.metrics.symmetry.weight, description: 'Сравнивается разница нескольких пар ориентиров относительно середины между глазами. Это геометрия одного скана, а не оценка здоровья.' });
    metrics.push({ id: 'face-proportion', title: 'Ширина и высота лица', score: intervalScore(summary.widthHeightRatio, CONFIG.metrics.faceProportion.preferred, CONFIG.metrics.faceProportion.outer), rawValue: summary.widthHeightRatio, displayValue: summary.widthHeightRatio.toFixed(2), weight: CONFIG.metrics.faceProportion.weight, description: 'Отношение расстояния между скулами (ориентиры 234–454) к высоте от верхней точки лба (10) до подбородка (152). Диапазон — настройка продукта.' });
    metrics.push({ id: 'eye-spacing', title: 'Расстояние между глазами', score: intervalScore(summary.eyeSpacingRatio, CONFIG.metrics.eyeSpacing.preferred, CONFIG.metrics.eyeSpacing.outer), rawValue: summary.eyeSpacingRatio, displayValue: summary.eyeSpacingRatio.toFixed(2), weight: CONFIG.metrics.eyeSpacing.weight, description: 'Расстояние между внутренними уголками глаз (133–362), делённое на ширину между внешними уголками (33–263). Диапазон — настройка продукта.' });
  }
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  const overall = enough && totalWeight >= 0.7 ? Math.round(metrics.reduce((sum, m) => sum + m.score * m.weight, 0) / totalWeight) : null;
  const stability = summary ? 1 - Math.min(1, median(samples.map(s => Math.abs(s.widthHeightRatio - summary.widthHeightRatio))) / 0.10) : 0;
  const coverage = Math.min(1, samples.length / 36);
  const sideCoverage = Math.min(1, Math.min(leftFrames, rightFrames) / 8);
  const confidence = Math.round(100 * (0.55 * coverage + 0.30 * stability + 0.15 * sideCoverage));
  const sortedMetrics = [...metrics].sort((a, b) => b.score - a.score);
  const strengths = sortedMetrics.filter(m => m.score >= 65).slice(0, 2).map(m => `${m.title}: ${m.score}/100`);
  const recommendations = [
    'Можно поэкспериментировать с объёмом причёски сверху и по бокам, если хочется изменить общий визуальный баланс.',
    'Если ты носишь бороду, попробуй разные аккуратные контуры щёк и шеи — это обратимая стилистическая опция.',
    'Для бровей можно начать с укладки щёточкой; менять форму не обязательно.',
  ];
  const sideNotes = [
    leftFrames >= 8 ? `В левом ракурсе устойчиво отслеживался контур из 468 ориентиров (${leftFrames} кадров). Обычная камера не даёт надёжной численной оценки челюсти.` : 'Левый контур содержал недостаточно стабильных кадров для описания.',
    rightFrames >= 8 ? `В правом ракурсе устойчиво отслеживался контур из 468 ориентиров (${rightFrames} кадров). Эти данные описывают скан, но не добавляют баллы.` : 'Правый контур содержал недостаточно стабильных кадров для описания.',
  ];
  return { overall, metrics, confidence, confidenceLabel: confidence >= 75 ? 'Хорошее качество измерений' : confidence >= 45 ? 'Среднее качество измерений' : 'Низкое качество измерений', sampleCount: samples.length, strengths, recommendations, sideNotes };
}

export const scoreInternals = { median, intervalScore };
