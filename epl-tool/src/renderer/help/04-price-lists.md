# Creating price lists

**New Price List** (Dashboard or Price Lists) offers two ways. Both are available to Admins and Users, for the customers
they may change (see [Pricing management modes](help:pricing-modes)). Viewers don't see the button.

## Single customer (4 steps)

1. **Customer & dates** — only the customers you may price are listed. The app loads the customer's latest price list
   and proposes the next version. *Next* is refused if the customer already has a list with the same effective date and
   version.
2. **Pricing method** — % discount from the Standard EPL, net prices entered directly, % change or fixed amount change
   from the previous list. Optional overrides per product type and per product (product beats type beats all products).
3. **Products** — review and edit prices, remove products, add products from the Standard EPL.
4. **Save & export** — the list is saved as soon as you reach this step; then *Export to Excel* and/or *Email*.

## Mass update (4 steps)

1. **Customers** — choose USD or EUR, filter, tick the customers to reprice. Customers you can't change are shown with a
   lock and the reason; customers without a price list can't be selected.
2. **Change** — the same methods and overrides as the single wizard (or *Carry forward*), dates and comments.
3. **Preview** — per customer, previous → new prices.
4. **Create** — the lists are created one by one; a customer that fails (e.g. duplicate date/version) doesn't stop the
   others. *Export All* and *Email* at the end.

## After saving

- The price list page shows **who created it and when** (lists created before v0.6 have no creator).
- **Delete** is available where you may change the customer; you have to type the version to confirm.
- Every creation and deletion appears in the customer's **History** and in the [activity log](help:activity).
