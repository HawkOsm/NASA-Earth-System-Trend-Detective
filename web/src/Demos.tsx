import { DEMOS } from './demos';

export default function Demos({ onRun }: { onRun: (index: number) => void }) {
  return (
    <div className="demos" role="group" aria-label="Try an example">
      <span className="demos-label">Try:</span>
      {DEMOS.map((d, i) => (
        <button key={d.label} className="demo-btn" onClick={() => onRun(i)}>
          {d.label}
        </button>
      ))}
    </div>
  );
}
