# Pricing management modes

Every customer has a **pricing management mode**. It decides who may change the customer's **price lists**, **email
addresses** and **master data**. Everybody can always view and export.

| Mode | Who can change this customer |
|---|---|
| **Open** | Every admin and user |
| **Managed by PBP** | Admins only |
| **Managed by** *named users* (one or several) | Those users and admins |

The mode is shown as a badge in the customer list and in the **Pricing management** card on the customer page.
**My customers** in the customer list shows the customers you manage.

## Changing the mode or the managers

| Who | Can do |
|---|---|
| **Admin** | Anything: any mode, any managers. |
| **Manager** of a *Managed by* customer | Add or remove co-managers (at least one must remain), switch the customer to *Open*, or hand it over to *Managed by PBP*. Handing it over means losing edit rights — the app warns you. |
| **Any user** on an *Open* customer | Can work on it, but **cannot change its mode**: an admin decides. |

Managers must be active Admins or Users. If every manager of a customer is deactivated, the customer behaves as
*Managed by PBP* until an admin reassigns it (the **Users** screen lists such customers).

## New customers

Admins and users can create customers with **New Customer** on the Customers screen:

- a **user**'s new customer starts as *Managed by* that user, who can add co-managers straight away;
- an **admin** chooses the mode (default: *Managed by PBP*).

Customers that existed before access rights were introduced (v0.6) all started as *Managed by PBP*.

## Hiding customers

Admins and the customer's managers can **hide** a customer. Only admins can **restore** or **permanently delete**
hidden customers (Settings → Hidden Customers).
