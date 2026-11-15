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

/** A screenshot of the site itself (web/public/about/, made by hand; the README shows the same files). */
function Shot({ file, alt, children }: { file: string; alt: string; children: string }) {
  return (
    <figure className="about-shot">
      <img src={`${import.meta.env.BASE_URL}about/${file}`} alt={alt} width={1280} height={720} loading="lazy" />
      <figcaption>{children}</figcaption>
    </figure>
  );
}


/**
 * "About": the one text that says what the site is, how to get around it and how to read what it shows. It opens from
 * the top bar. (The country view has its own short "How to read this view" for what is special there.)
 */
export default function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="about-title">About Trend Detective</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <h3>What this is</h3>
        <p>
          Trend Detective shows where the weather of the last 45 years has changed, by how much, and how far each change can be
          trusted. It covers ten variables: air temperature, the hottest temperature of the year, precipitation, soil moisture,
          evaporation from land, humidity, snow cover, sea ice, wind speed and the ozone layer. The numbers come from NASA&rsquo;s
          MERRA-2 record, as served by NASA POWER, for every year from 1981 to 2025.
        </p>
        <p>
          It was made for the NASA Space Apps Challenge 2026, challenge &ldquo;Be an Earth System Trend Detective&rdquo;, by Osman
          Sahin Guler (team HawkTeam). It is not affiliated with or endorsed by NASA.
        </p>
        <Shot file="globe.jpg" alt="The globe coloured by the trend in air temperature, with the menu beside it">
          The globe, coloured by the change in air temperature per decade. Red is warming, blue is cooling, and the plain map shows
          through where there is no significant trend.
        </Shot>

        <h3>Getting around</h3>
        <ul>
          <li>
            <strong>Click the globe.</strong> The country, sea or ocean under the click lifts out into a view of its own: its trend,
            every grid cell inside it, its provinces and cities, and all ten variables side by side.
          </li>
          <li>
            <strong>The menu</strong> has five parts, and a click on a name opens or folds it. <em>Data</em> chooses the variable.{' '}
            <em>Period</em> chooses the years. <em>Scale</em> explains the colours and can keep only the trends that independent
            records confirm. <em>Click</em> decides what a click opens: a whole country (Lift), one place (Point), or a box of 2, 5
            or 10 degrees. <em>Layers</em> switches the wind, the borders and the labels.
          </li>
          <li>
            <strong>The Detective</strong> answers in words. Type a place or a question, such as &ldquo;Turkey since 2000&rdquo; or
            &ldquo;what is changing in Europe?&rdquo;. It finds the place, sets the years, turns the globe and opens the view.
            Gemini, an AI model, reads the question: which place, which years, which variable. Every number in the answer is
            looked up from the statistics, never written by the AI.
          </li>
          <li>
            <strong>Take the tour</strong> in the top bar walks through all of this in about two minutes.
          </li>
        </ul>
        <Shot file="country.jpg" alt="Turkey lifted out of the map, with its trend, its grid cells and its provinces">
          A country lifted out of the map: the trend for the whole country, a map of its grid cells, and its provinces and cities.
        </Shot>
        <Shot file="place.jpg" alt="The panel of one place, with its yearly values, the trend line and the grade">
          One place (Click, then Point): every year, the trend line, the verdict, the grade and what independent records say.
        </Shot>
        <Shot file="detective.jpg" alt="The Detective answering a typed question about a place">
          The Detective: a question in words, how it was read, and the trends at that place.
        </Shot>

        <h3>What the map shows</h3>
        <p>
          Each grid cell of about 50 km is coloured by how fast its yearly average changed per decade. The colour shows the
          direction, and a stronger, more solid colour means faster change. Colours are blended smoothly between grid points that
          are about 50 km apart, so detail finer than that is not real. Each variable has its own colours; the Scale part of the
          menu says which end is which.
        </p>
        <p>
          The green-and-blue map underneath is only a backdrop of land and water. The trend is drawn over it like tinted clouds.
          Where the plain map shows through, there is no statistically significant trend.
        </p>
        <p>
          Three sizes appear on the site. The trends for 1981–2025 are worked out on grid cells of about 50 km. When you choose
          your own years, the map is worked out again in your browser on cells of about 100 km, and the Detective&rsquo;s rankings
          use that size too. The independent and satellite checks compare boxes of about 220 to 280 km, because that is the size
          of those records.
        </p>
        <p>
          With the Wind layer on, the moving white streaks show the average wind over 1981–2025 (direction and speed), not a trend.
        </p>

        <h3>What a &ldquo;trend&rdquo; is here</h3>
        <p>
          For each place we take one average per year and find the typical year-to-year slope (Theil–Sen: the median of the slopes
          between every pair of years, so one odd year cannot dominate). A country, a sea or a box averages many grid cells first,
          which smooths out local noise and can make a regional trend clearer.
        </p>

        <h3>&ldquo;Statistically significant&rdquo;</h3>
        <p>
          The Mann–Kendall test asks how likely such a consistent rise or fall would be if the years were just shuffled randomly. p
          &lt; 0.05 means &ldquo;significant&rdquo;; 0.05–0.10 means &ldquo;possible trend, needs more years&rdquo;; otherwise
          &ldquo;no clear trend&rdquo;. The 95% range is where the true rate plausibly lies.
        </p>
        <p>
          The map tests more than 200,000 places at once, so it uses a stricter rule (Benjamini–Hochberg false discovery control) to
          avoid being fooled by chance. That is why a place can be plain on the map and still significant when you open it on its
          own.
        </p>

        <h3>Choosing the period</h3>
        <p>
          The two sliders under Period choose the years; the map, the panel of a place and the country view then use only those
          years. Shorter periods have fewer years, so trends are noisier and harder to prove significant. Below about 15 years
          almost nothing passes the map&rsquo;s stricter rule. The map then draws every change, strong where a place is significant
          on its own and faded where it is not, and the Scale part of the menu says so. Read that as the direction of change, not as
          proof. The colour scale is a rate per decade; a rate measured over fewer years swings more, so the scale is wider for a
          short period, and the menu gives it as the total change over the chosen years too.
        </p>

        <h3>Robust, use with caution, doubtful</h3>
        <p>
          Next to every trend that is significant or possible we say how far it can be trusted. <strong>Robust</strong>: the change is
          gradual, not driven by one year, and the same in both halves of the record. <strong>Use with caution</strong>: one warning
          sign, for example a jump in one year (which can come from a change in the satellites feeding the dataset), the two halves
          disagreeing, or the direction flipping when the first or last five years are left out. <strong>Doubtful</strong>: the trend
          depends on a single unusual year, or there are several warning signs. In the Detective, a trend that is significant on its
          own but not after allowing for the many variables tested at one place is at best &ldquo;use with caution&rdquo;. These
          checks only catch patterns that are known signs of trouble; they cannot prove the data is right, and a robust trend can
          still be wrong.
        </p>

        <h3>Independent check</h3>
        <p>
          For temperature and rainfall we also compare MERRA-2 with records that are measured independently: NASA GISTEMP
          (thermometers and ships) and GHCN-CAMS (weather stations) for temperature over land, and GPCP, CMAP (both rain gauges and
          satellites), GPCC and PREC/L (both rain gauges, land only) for rainfall. MERRA-2 is averaged over the boxes of the records
          (about 220 and 280 km) and the trend in the box is compared with the trend of each record. The site says &ldquo;confirmed
          by k of n records&rdquo;, where n is the number of records that have data in the box and k the number that show a
          significant trend in the same direction. &ldquo;Confirmed&rdquo; means more than half of them do (and more than show the
          opposite); &ldquo;confirmed by only k of n&rdquo; means some do but fewer than half; &ldquo;not confirmed&rdquo; means
          none shows a significant change; &ldquo;contradicted&rdquo; means more records show the opposite than confirm.
        </p>
        <p>
          It is the only check here that tests the data against something other than itself, so a trend that is only partly or not
          confirmed is at best &ldquo;use with caution&rdquo; and a contradicted one is &ldquo;doubtful&rdquo;. The rainfall records
          disagree with each other, so treat MERRA-2 rainfall trends with care. The check covers 1981–2025 and is shown for single
          places, and for a whole country, sea or continent when the record covers at least half of it. &ldquo;Confirmed only&rdquo;
          under Scale keeps just the confirmed trends on the map.
        </p>

        <h3>Satellite check</h3>
        <p>
          Some variables can also be compared with a NASA instrument that measures them from space, or with NASA&rsquo;s GLDAS land
          model: {CHECKED_LIST}. These records start around 2000, so the comparison covers the record&rsquo;s own years, not
          1981–2025: both MERRA-2 and the record are averaged over a box of about 220 km and their trends over the same years are
          put side by side. The panel of a place says whether they agree. This does not change the grade, which is about the whole
          period. The snow check exists only where MODIS saw every month of the year, so it covers mid-latitude and mountain snow,
          not the Arctic. GLDAS is a model driven by observations, not a measurement, so its line is called a model check. MERRA-2
          takes in OMI&rsquo;s ozone measurements itself, so agreement with OMI is expected and is not an independent confirmation.
        </p>

        <h3>Honest limits</h3>
        <p>
          Year-to-year &ldquo;memory&rdquo; in climate data is only partly corrected for (lag-1 Hamed–Rao). MERRA-2 is a reanalysis
          (a weather model blended with observations), not direct measurements, so some regional trends, especially for
          precipitation and around sea ice, can reflect changes in the observing system rather than the climate. A trend is not a
          forecast.
        </p>

        <h3>Data and credits</h3>
        <p>
          Trends: NASA POWER (MERRA-2), monthly and annual values on a 0.5° × 0.625° grid, from the NASA Langley Research Center.
          Independent check: NASA GISTEMP, GHCN-CAMS, GPCP, CMAP, GPCC and PREC/L. Satellite check: GPM IMERG (via NASA POWER),
          MODIS (via NASA GIBS), AIRS, OMI and GLDAS (NASA GES DISC). Country, province and sea outlines: Natural Earth.
        </p>
        <p>
          The code and a longer account of the method are in the{' '}
          <a className="about-link" href="https://github.com/HawkOsm/NASA-Earth-System-Trend-Detective" target="_blank" rel="noopener noreferrer">
            project&rsquo;s repository
          </a>
          , including how AI was used to build the site.
        </p>
      </div>
    </div>
  );
}
