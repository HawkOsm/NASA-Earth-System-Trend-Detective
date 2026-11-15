import { useEffect } from 'react';
import { INSTRUMENT_VARIABLES } from '../evaluation/instrument';

/** What each variable of the satellite check is compared with (only the ones that are built are listed). */
const CHECKED_WITH: Record<string, string> = {
  PRECTOTCORR: 'rainfall with GPM',
  FRSNO: 'snow cover with MODIS',
  T2M: 'air temperature with AIRS',
  TO3: 'ozone with OMI',
  EVLAND: 'evaporation with GLDAS',
  GWETROOT: 'soil moisture with GLDAS',
};
const CHECKED_LIST = (INSTRUMENT_VARIABLES as readonly string[]).map((v) => CHECKED_WITH[v]).filter(Boolean).join(', ');

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
          The colour shows the direction, and a stronger, more solid colour means faster change. Colours are blended
          smoothly between grid points that are about 50 km apart, so fine detail smaller than that is not
          real.
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
        <p>
          Choosing a larger area averages many grid cells, which smooths out local noise and can make a regional
          trend clearer.
        </p>
        <h3>Choosing the period</h3>
        <p>
          You can choose the period with the two sliders in the Menu (bottom left of the map); the map, the side panel and the country view
          then use only those years. Shorter periods have fewer years, so trends are noisier and harder to prove
          significant. Below about 15 years almost nothing passes the test that allows for every place on the map being tested at
          once. The map then follows a different rule and says so: it draws every change, strong where a place is significant on
          its own and faded where it is not, the same way the country view does. Read that as the direction of change, not as proof.
        </p>
        <h3>&ldquo;Statistically significant&rdquo;</h3>
        <p>
          The Mann–Kendall test asks how likely such a consistent rise or fall would be if the years were just
          shuffled randomly. p &lt; 0.05 means &ldquo;significant&rdquo;; 0.05–0.10 means &ldquo;possible trend,
          needs more years&rdquo;; otherwise &ldquo;no clear trend&rdquo;. The 95% range is where the true rate
          plausibly lies.
        </p>
        <h3>Plain map, but significant in the panel?</h3>
        <p>
          The green-and-blue map underneath is only a backdrop (land and water). The trend is drawn over it like
          tinted clouds: the stronger and more certain the trend, the more solid the colour. Where the plain map
          shows through, there is no statistically significant trend.
        </p>
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
        <h3>Robust, use with caution, doubtful</h3>
        <p>
          Next to every trend that is significant or possible we say how far it can be trusted. <strong>Robust</strong>: the change
          is gradual, not driven by one year, and the same in both halves of the record. <strong>Use with caution</strong>: one warning
          sign, for example a jump in one year (which can come from a change in the satellites feeding the dataset), the two halves
          disagreeing, or the direction flipping when the first or last five years are left out. <strong>Doubtful</strong>: the trend
          depends on a single unusual year, or there are several warning signs. In the Detective, a trend that is significant on its own
          but not after allowing for the many variables tested at one place is at best &ldquo;use with caution&rdquo;. These checks only catch
          patterns that are known signs of trouble; they cannot prove the data is right, and a robust trend can still be wrong.
        </p>
        <h3>Independent check</h3>
        <p>
          For temperature and rainfall we also compare MERRA-2 with records that are measured independently: NASA GISTEMP (thermometers
          and ships) and GHCN-CAMS (weather stations) for temperature over land, and GPCP, CMAP (both rain gauges and satellites), GPCC and
          PREC/L (both rain gauges, land only) for rainfall. MERRA-2 is averaged over the boxes of the records (about 220 and 280 km) and
          the trend in the box is compared with the trend of each record. The site says &ldquo;confirmed by k of n records&rdquo;, where n
          is the number of records that have data in the box and k the number that show a significant trend in the same direction.
          &ldquo;Confirmed&rdquo; means more than half of them do (and more than show the opposite); &ldquo;confirmed by only k of n&rdquo;
          means some do but fewer than half; &ldquo;not confirmed&rdquo; means none shows a significant change; &ldquo;contradicted&rdquo;
          means more records show the opposite than confirm. It is the only check here that tests the data against something other than
          itself, so a trend that is only partly or not confirmed is at best &ldquo;use with caution&rdquo; and a contradicted one is
          &ldquo;doubtful&rdquo;. The rainfall records disagree with each other, so a rainfall trend that none of the four confirms is the
          strong signal that MERRA-2 may be wrong there, while one that some confirm and others do not is less clear-cut. Treat MERRA-2
          rainfall trends with care. The check is shown for single places (Point or a box), and for a whole country, sea or continent when the record covers at least half of it (the record and MERRA-2 are then both averaged over the same area), over 1981–2025.
        </p>
        <h3>Satellite check</h3>
        <p>
          Some variables can also be compared with a NASA instrument that measures them from space, or with NASA&rsquo;s GLDAS land
          model: {CHECKED_LIST}. These records start around 2000, so the comparison covers the record&rsquo;s own years, not 1981–2025:
          both MERRA-2 and the record are averaged over a box of about 220 km and their trends over the same years are put side by
          side. The panel of a place says whether they agree. This does not change the grade, which is about the whole period. The
          snow check exists only where MODIS saw every month of the year, so it covers mid-latitude and mountain snow, not the Arctic.
          GLDAS is a model driven by observations, not a measurement, so its line is called a model check. MERRA-2 takes in OMI&rsquo;s
          ozone measurements itself, so agreement with OMI is expected and is not an independent confirmation.
        </p>
        <h3>Data source</h3>
        <p>
          NASA POWER (MERRA-2), monthly/annual values, 0.5° × 0.625° grid. Satellite check: GPM IMERG (via NASA POWER), MODIS (via NASA
          GIBS), AIRS, OMI and GLDAS (NASA GES DISC).
        </p>
      </div>
    </div>
  );
}
