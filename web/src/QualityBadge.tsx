import type { Analysis } from './analysis';
import { rateUnitsLong } from './format';
import { BADGE_LABEL, reasonSentences, type Grade } from './quality';
import { combineGrade, COUNTRY_NOTE, type RefCheck } from './reference';

/** "Robust" / "Use with caution" / "Doubtful" as a small coloured pill (nothing for the other grades). */
export function GradeBadge({ grade }: { grade: Grade }) {
  if (grade !== 'robust' && grade !== 'caution' && grade !== 'doubtful') return null;
  return <span className={`grade-badge grade-${grade}`}>{BADGE_LABEL[grade]}</span>;
}

/** The independent-record line(s) of a place: a small label, the sentence, the bad years and the trend without them. */
export function ReferenceLine({ check }: { check: RefCheck }) {
  return (
    <div className={`refcheck refcheck-${check.cls ?? 'period'}`} data-ref-class={check.cls ?? 'period'}>
      <span className="refcheck-label">Independent check</span>
      <p className="refcheck-text">{check.sentence}</p>
      {check.badSentence && <p className="refcheck-text">{check.badSentence}</p>}
      {check.withoutSentence && <p className="refcheck-text">{check.withoutSentence}</p>}
    </div>
  );
}

/** Country / sea overlay: the check exists for single places only. */
export function ReferenceCountryNote() {
  return <p className="quality-caveat refcheck-note">{COUNTRY_NOTE}</p>;
}

/**
 * Under a verdict: the grade badge (the pattern grade, capped by the independent check when `reference` is given), the
 * reason sentence(s), the independent check and the variable's caveat (one small grey line).
 */
export function QualityBlock({ a, caveat, reference, countryNote }: { a: Analysis; caveat?: string; reference?: RefCheck | null; countryNote?: boolean }) {
  const q = a.quality;
  const grade = combineGrade(q.grade, reference ? reference.cls : null);
  const sentences = reasonSentences(q, a.years, rateUnitsLong(a.units));
  if (!sentences.length && !caveat && !reference && !countryNote) return null;
  return (
    <div className={`quality quality-${grade}`} data-grade={grade} data-pattern-grade={q.grade}>
      {(grade === 'robust' || grade === 'caution' || grade === 'doubtful') && (
        <div className="quality-head">
          <GradeBadge grade={grade} />
        </div>
      )}
      {sentences.map((s) => (
        <p key={s} className="quality-reason">
          {s}
        </p>
      ))}
      {reference && <ReferenceLine check={reference} />}
      {countryNote && <ReferenceCountryNote />}
      {caveat && <p className="quality-caveat">{caveat}</p>}
    </div>
  );
}
