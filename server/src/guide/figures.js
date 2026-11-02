// The screenshots in the picture guide: which section each sits under, the file, and its caption.
// Every picture was taken from the real app on made-up demo data (see scripts/demo-server.js and scripts/guide-shots.mjs).
export const FIGURES = {
  1: [
    { file: 'm-stocks', caption: 'Stocks: the Nifty 50, search, filters, and the two auto traders at the top with what they made today.' },
    { file: 'm-account', caption: 'Account: your money, then the tiles. P&L, Orders, Research, Day review, Limits, Entries and this guide.' },
    { file: 'm-limits', caption: 'Account > Limits: the stop, the profit lock and the closing time for shares and options.' },
  ],
  5: [
    { file: 'm-study-form', caption: 'Research > Options study: pick days, how many trades a day, real option prices and "trade like the live bot".' },
    { file: 'm-study-results', caption: 'The result for each way of reading the chart: money made, win rate, average win and loss.' },
    { file: 'm-score-floors', caption: 'Open a row to see calls against puts, the worst losing run, and what a minimum chart score would have done.' },
    { file: 'd-study-results', caption: 'The same screen on a computer.', wide: true },
  ],
  6: [
    { file: 'm-entries', caption: 'Account > Entries: which patterns and combinations the auto trader may buy, with their study results beside them.' },
    { file: 'm-entries-combos', caption: 'Scroll down to My combinations and tap New combination.' },
    { file: 'm-combo-new', caption: 'A new combination: give it a name, then search and tap the checks.' },
    { file: 'm-combo-built', caption: 'Three checks picked, all must hold together, calls only. Save it, then test it in the study.' },
  ],
  7: [
    { file: 'm-study-trades', caption: 'Every trade in a study has a View button.' },
    { file: 'm-view-popup', caption: 'View: why the entry happened, what happened next, and the numbers of the trade.' },
    { file: 'd-view-popup', caption: 'The View popup on a computer.', wide: true },
  ],
  9: [
    { file: 'm-pnl-top', caption: 'P&L: the running total and the profit or loss for each day, week or month.' },
    { file: 'm-pnl-charts', caption: 'Tap a bar for its numbers. Tables below: day by day, by weekday, by hour of entry and by symbol.' },
    { file: 'd-pnl-charts', caption: 'The P&L page on a computer.', wide: true },
  ],
};
