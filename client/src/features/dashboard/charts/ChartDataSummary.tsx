/** One labelled row of the underlying data. */
export interface SummaryRow {
  label: string;
  value: string;
}

interface ChartDataSummaryProps {
  /** Names the chart, and is what a screen reader announces first. */
  caption: string;
  valueHeading: string;
  rows: SummaryRow[];
}

/**
 * The text alternative SPEC section 6 requires beside every chart.
 *
 * A `<canvas>` is opaque to assistive technology — there is no DOM inside it to
 * read — so the same numbers are rendered as a real table and hidden visually.
 * `sr-only` rather than `aria-hidden` or `display: none` is what keeps it in the
 * accessibility tree while staying out of the layout.
 */
export function ChartDataSummary({
  caption,
  valueHeading,
  rows,
}: ChartDataSummaryProps): JSX.Element {
  // The wrapper carries `sr-only`, not the table. `sr-only` pins width to 1px,
  // and a `display: table` box treats that as a minimum and grows to its
  // content anyway, so the table alone kept its full natural width. It stayed
  // clipped and invisible, but it widened the layout box it sat in.
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
