# Saved feature ideas

## Sankey income and expenses chart — implemented on 2026-10-23

Originally deferred on 2026-10-22 while prioritizing the recurring-payments panel; now available on the dashboard.

- A full-width dashboard panel, **לאן הכסף זורם?**, with a month selector.
- Actual bank credits flow to bank expenses, mortgage, credit-card payments, and the period's surplus or calculated deficit. These are actual monthly movements, not current balances or future forecasts.
- Credit-card payments expand into their saved merchant categories.
- Ribbon widths represent amounts; hover shows the amount, percentage and contributing transactions. Categories can be clicked to inspect activity.
- Use Hebrew RTL labels and Shklops colors; SVG is sufficient for rendering.
- Count each card settlement once. Categorized card transactions explain that settlement and must not be added again as expenses. Unique matches require the same issuer, exact net amount and billing date within four days of bank posting; ambiguous and missing matches remain explicit. Refunds reduce their category; negative category nets stay unallocated.
- Use only selected accounts and completed ILS movements through today. The panel runs locally without an AI call. Mobile uses horizontal scrolling; amount privacy and transaction drilldown are supported.
