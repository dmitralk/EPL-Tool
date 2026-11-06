# Analysis & FX rates

The **Analysis** screen puts every price list line of the active customers next to the Standard EPL price, for any EPL
version. It is read-only and available to everybody.

- **USD / EUR** — only that currency; the difference to the EPL is exact.
- **All** — every currency; non-USD prices are converted to USD with FX rates and compared with the **USD** EPL. These
  converted figures (marked ≈) mix exchange rates with pricing: use them for a quick overview, and the USD / EUR tabs for
  exact analysis.
- Columns can be shown or hidden (*Columns*), and the visible grid exported to Excel.

## FX rates: defaults and your session rates

| | Who | Saved? |
|---|---|---|
| **Default rates** | Set by admins | Yes, shared by everybody |
| **Your rates (this session)** | Anybody, in the *FX rates* popover | No — kept until EPL Tool is closed |

- The popover starts from the default rates. As soon as you change one, it shows **Your rates (this session)** and
  *FX rates · yours*.
- **Reset to defaults** goes back to the shared rates.
- Admins also see **Save as default rates**, which makes the current rates the defaults for everybody (recorded in the
  [activity log](help:activity)).

FX rates are used only on this screen. They never change a price list.
