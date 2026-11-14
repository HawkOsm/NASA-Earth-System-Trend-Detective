import { useEffect } from 'react';

export default function HowToRead({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="howto-title">How to read this</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <h3>What the map shows</h3>
        <p>
          Each ~50 km grid cell is coloured by how fast its yearly average changed per decade, 1981–2025.
          The colour shows the direction, and a stronger colour means faster change.
        </p>
        <p>
          For wind speed, the moving white streaks show the average wind over 1981–2025 (direction and speed),
          not the trend. The colours underneath show how wind speed is changing.
        </p>
        <h3>What a &ldquo;trend&rdquo; is here</h3>
        <p>
          For each place we take one average per year (45 values) and find the typical year-to-year slope
          (Theil–Sen: the median of the slopes between every pair of years, so one odd year cannot dominate).
        </p>
        <h3>&ldquo;Statistically significant&rdquo;</h3>
        <p>
          The Mann–Kendall test asks how likely such a consistent rise or fall would be if the years were just
          shuffled randomly. p &lt; 0.05 means &ldquo;significant&rdquo;; 0.05–0.10 means &ldquo;possible trend,
          needs more years&rdquo;; otherwise &ldquo;no clear trend&rdquo;. The 95% range is where the true rate
          plausibly lies.
        </p>
        <h3>Pale on the map, significant in the panel?</h3>
        <p>
          The map tests 200,000+ places at once, so it uses a stricter rule (Benjamini–Hochberg false discovery
          control) to avoid being fooled by chance.
        </p>
        <h3>Honest limits</h3>
        <p>
          Year-to-year &ldquo;memory&rdquo; in climate data is only partly corrected for (lag-1 Hamed–Rao). The
          data is MERRA-2, a reanalysis (a weather model blended with observations), not direct measurements, so
          some regional trends, especially for precipitation and around sea ice, can reflect changes in the
          observing system rather than the climate. A trend is not a forecast.
        </p>
        <h3>Data source</h3>
        <p>NASA POWER (MERRA-2), monthly/annual values, 0.5° × 0.625° grid.</p>
      </div>
    </div>
  );
}
