import type { VariableMeta } from './data';
import { VARIABLES } from './demos';

interface PickerProps {
  metas: Record<string, VariableMeta>;
  value: string;
  onChange: (variable: string) => void;
}

export default function Picker({ metas, value, onChange }: PickerProps) {
  return (
    <div className="picker" role="radiogroup" aria-label="Variable">
      {VARIABLES.map((v) => {
        const m = metas[v];
        const selected = v === value;
        return (
          <label key={v} className={`picker-opt${selected ? ' selected' : ''}`}>
            <input
              type="radio"
              name="variable"
              value={v}
              checked={selected}
              onChange={() => onChange(v)}
            />
            <span className="picker-label">{m ? m.label : v}</span>
            {selected && m && <span className="picker-def">{m.definition}</span>}
          </label>
        );
      })}
    </div>
  );
}
