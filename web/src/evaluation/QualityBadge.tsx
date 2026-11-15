import type { Analysis } from '../point/analysis';
import { rateUnitsLong } from '../data/format';
import { BADGE_LABEL, reasonSentences, type Grade } from './quality';
import { combineGrade, COUNTRY_NOTE, type RefCheck } from './reference';
import type { InstrumentCheck } from './instrument';

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

/** The satellite check of a place (instrument.ts): MERRA-2 against a NASA instrument over the instrument's years. */
export function InstrumentLine({ check }: { check: InstrumentCheck }) {
  return (
    <div className={`refcheck instcheck instcheck-${check.cls}`} data-inst-class={check.cls}>
      <span className="refcheck-label">{check.label}</span>
      <p className="refcheck-text">{check.sentence}</p>
      {check.note && <p className="refcheck-text refcheck-caveat">{check.note}</p>}
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
export function QualityBlock({ a, caveat, reference, countryNote, instrument }: { a: Analysis; caveat?: string; reference?: RefCheck | null; countryNote?: boolean; instrument?: InstrumentCheck | null }) {
  const q = a.quality;
  const grade = combineGrade(q.grade, reference ? reference.cls : null);
  const sentences = reasonSentences(q, a.years, rateUnitsLong(a.units));
  if (!sentences.length && !caveat && !reference && !countryNote && !instrument) return null;
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
      {instrument && <InstrumentLine check={instrument} />}
      {countryNote && <ReferenceCountryNote />}
      {caveat && <p className="quality-caveat">{caveat}</p>}
    </div>
  );
}
