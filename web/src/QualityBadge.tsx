import type { Analysis } from './analysis';
import { rateUnitsLong } from './format';
import { BADGE_LABEL, reasonSentences, type Grade } from './quality';

/** "Robust" / "Use with caution" / "Doubtful" as a small coloured pill (nothing for the other grades). */
export function GradeBadge({ grade }: { grade: Grade }) {
  if (grade !== 'robust' && grade !== 'caution' && grade !== 'doubtful') return null;
  return <span className={`grade-badge grade-${grade}`}>{BADGE_LABEL[grade]}</span>;
}

/** Under a verdict: the grade badge, the reason sentence(s) and the variable's caveat (one small grey line). */
export function QualityBlock({ a, caveat }: { a: Analysis; caveat?: string }) {
  const q = a.quality;
  const sentences = reasonSentences(q, a.years, rateUnitsLong(a.units));
  if (!sentences.length && !caveat) return null;
  return (
    <div className={`quality quality-${q.grade}`} data-grade={q.grade}>
      {(q.grade === 'robust' || q.grade === 'caution' || q.grade === 'doubtful') && (
        <div className="quality-head">
          <GradeBadge grade={q.grade} />
        </div>
      )}
      {sentences.map((s) => (
        <p key={s} className="quality-reason">
          {s}
        </p>
      ))}
      {caveat && <p className="quality-caveat">{caveat}</p>}
    </div>
  );
}
