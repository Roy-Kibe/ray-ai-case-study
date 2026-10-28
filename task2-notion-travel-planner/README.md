# Task 2 — Executive Travel Planner (Notion)

**Live page (view only, no login needed):** [Executive Travel Planner – Roy Githara](https://periodic-palm-1b4.notion.site/Executive-Travel-Planner-Roy-Githara-407ac8ae102b808f923ae2dc764bd9a2)

An EA logs each trip once. The founder gets a clean, phone-friendly Trip Brief before and during travel. The page can be copied into any Notion workspace with the **Duplicate** button at the top right.

## What's in it

| Part | Details |
|---|---|
| **Trips database** (single database) | One record per trip: Trip, Traveller(s), Dates (range), Status, Countdown, Destination, Visa / Entry, Flights, Hotel & Address, Transfers, Key Meetings, Confirmations, Emergency Contacts, Documents, Notes. |
| **Trip Brief template** | The default template, so every new trip opens with the brief already laid out: a day-by-day itinerary, emergency and primary contacts, a documents section and the EA's pre-trip checklist. |
| **All Trips** view | A table with the 7 facts the EA scans (who, when, status, countdown, where, visa), sorted by date. Full details live in each brief. |
| **Upcoming** view | A timeline of trips by date. Trips marked Done are hidden. |
| **By Status** view | A board with Planned / In-Progress / Done columns. Dragging a card updates its status. |
| **Sample data** | Four fictional trips, one for each situation. *London – Investor Roadshow* is a fully filled, founder-ready example brief. |

## Design choices

- **Two readers, two layers.** Properties hold the short facts the EA scans in the table. The brief page tells the founder the trip as a story, in time order.
- **The founder's questions first.** Properties on every brief are ordered the way a traveller asks: when, how soon, status, who, where, can I get in, then the bookings.
- **Built for a phone.** The itinerary uses day headings and short lines, not a wide table, so nothing scrolls sideways on a phone.
- **Risks stand out.** Visa / Entry is a coloured dropdown (Pending shows orange). A Countdown formula shows "In 12 days", "Tomorrow", "Today", "Travelling now" or "Completed" without anyone updating it.
- **Countdown is live; Status is set by the EA.** Countdown recalculates from the dates every day, so it can run ahead of a status the EA hasn't moved yet.
- **Safe to share.** All names, numbers and booking codes are fictional and labelled as sample data. The page is view-only and hidden from search engines.

## How the EA uses it

1. Click **New** in the Trips table. The Trip Brief layout appears automatically.
2. Fill in the properties at the top, then replace the `[placeholders]` in the itinerary and contacts.
3. Attach tickets and visa scans in **Documents**.
4. Work through the pre-trip checklist, then share the trip page with the founder.
5. Move the trip to **In-Progress** when travel starts and to **Done** when the founder is back.

<details>
<summary>Countdown formula</summary>

```
lets(
  d, dateBetween(dateStart(prop("Dates")), today(), "days"),
  e, dateBetween(dateEnd(prop("Dates")), today(), "days"),
  if(empty(prop("Dates")), "",
  if(d > 1, "In " + format(d) + " days",
  if(d == 1, "Tomorrow",
  if(d == 0, "Today",
  if(e >= 0, "Travelling now", "Completed")))))
)
```
</details>
