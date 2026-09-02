# DROMEX Engineering Project Management Reference

This document distills the supplied Engineering Project Management course
material into implementation guidance for DROMEX. It is a reference for Claude,
not a replacement for a licensed engineer's judgment, contract requirements, or
the project specifications.

## Project model

A project is a temporary effort with a defined start, finish, deliverables,
resources, cost, and performance targets. DROMEX should represent the project
life cycle as definition, planning, execution, control, and closeout.

## Work Breakdown Structure (WBS)

The WBS is a hierarchy of deliverables and work packages. A construction project
may be organized by phase, area, trade, or responsibility. Activities should be
small enough to estimate, assign, measure, and update, but not so small that the
schedule becomes unmanageable.

Each activity should support:

- stable activity ID and name;
- WBS parent and project;
- duration and calendar;
- quantity and unit, when measurable;
- productivity and crew count, when estimated from production;
- responsible company/subcontractor and area;
- predecessors, relationship type, and lag;
- planned, baseline, and actual dates;
- progress method and percent complete;
- planned, earned, and actual cost where cost-loaded.

## Networks and dependencies

An activity-on-node network represents activities as nodes and dependencies as
arrows. The primary relationship types are:

- **FS (Finish-to-Start):** successor starts after predecessor finishes.
- **SS (Start-to-Start):** successor starts after predecessor starts, optionally
  with lag.
- **FF (Finish-to-Finish):** successor cannot finish before predecessor finishes.
- **SF (Start-to-Finish):** successor finishes after predecessor starts; uncommon
  in construction.

Lag may be positive or negative only when the project rules permit it. The user
interface must display relationship type and lag clearly and validate circular
dependencies.

## Calendar and duration rules

Durations use one consistent unit per schedule, normally workdays. Calendars must
support working days, weekends, holidays, shifts, and project-specific exceptions.
The finish date must be calculated from the selected calendar rather than by adding
calendar days blindly.

When productivity is known:

```text
Duration = Quantity / (Productivity per crew per period × Number of crews)
```

The calculation must retain the input quantity, productivity, crew count, and
rounding assumption so the estimate can be explained later.

## Critical Path Method (CPM)

CPM uses deterministic activity durations.

Forward pass:

```text
Early Start (ES) = maximum predecessor Early Finish, adjusted for relationship/lag
Early Finish (EF) = ES + duration
```

Backward pass:

```text
Late Finish (LF) = minimum successor Late Start, adjusted for relationship/lag
Late Start (LS) = LF - duration
```

For a start activity, ES is controlled by the project start date. For the final
activity, LF is controlled by the calculated project finish date.

```text
Total Float = LS - ES = LF - EF
```

Free float is the delay available before affecting the earliest start of a
successor. Activities with zero (or configured near-zero) total float form the
critical path. The engine must identify multiple critical paths when they exist.

The schedule must reject or visibly report missing predecessors, circular logic,
invalid dates, negative durations, and impossible relationship results.

## PERT estimates

PERT is useful when duration is uncertain. The user supplies:

- optimistic duration `O`;
- most likely duration `M`;
- pessimistic duration `P`.

```text
Expected duration = (O + 4M + P) / 6
Variance = ((P - O) / 6)^2
Standard deviation = √variance
```

PERT should be an optional planning mode. It should not overwrite an approved
deterministic baseline without explicit user action.

## Schedule compression and cost-time trade-off

Compression reduces duration without removing scope. Techniques include correcting
unnecessary logic, fast-tracking, overtime, additional crews/equipment, shifts,
special materials, incentives, and improved coordination.

For an activity with normal and crashed values:

```text
Cost slope = (Crash cost - Normal cost) / (Normal duration - Crash duration)
```

The usual decision sequence is to shorten the least-cost activity on the current
critical path, recalculate the network, and stop when the target date is reached
or no further economical reduction is possible. Total project cost should show:

```text
Total cost = Direct cost + Indirect cost
```

The application must show assumptions and warn that acceleration may introduce
quality, safety, procurement, or contractual risks.

## Resource allocation and leveling

Resources include labor, equipment, space, money, and materials. A schedule is
resource-feasible only when assigned demand does not exceed availability in any
period.

The system should show over-allocation by resource and time period. A leveling
heuristic may prioritize, in order:

1. least total float;
2. longest duration;
3. largest resource requirement.

Leveling may move noncritical activities and extend the project. It must preserve
dependencies, show the resulting finish-date change, and never silently alter the
approved baseline.

## Baselines and project control

A baseline is the approved time and cost plan. A status date is the date through
which actual progress is known. Control is a continuous loop:

```text
Monitor -> compare with baseline -> identify variance -> analyze cause -> correct
```

Progress methods include:

- units completed / total units;
- start-finish states for short activities;
- time ratio or cost ratio for continuous work.

DROMEX must store the actual entry timestamp separately from the effective work
date, because missed past days may be entered later.

## Earned Value Analysis (EVA)

Three values are required at the status date:

- **BCWS / PV:** budgeted cost of work scheduled;
- **BCWP / EV:** budgeted cost of work actually performed;
- **ACWP / AC:** actual cost incurred for performed work.

```text
Schedule variance (SV) = EV - PV
Cost variance (CV) = EV - AC
Schedule Performance Index (SPI) = EV / PV
Cost Performance Index (CPI) = EV / AC
Estimate at Completion (EAC) = BAC / CPI
Estimate to Complete (ETC) = EAC - AC
```

The system must handle zero denominators explicitly and label whether a value is
planned, earned, or actual. S-curves may plot PV, EV, and AC over time.

## Construction integration in DROMEX

The schedule must consume existing operational records rather than create a
parallel disconnected ledger. Examples:

- confirmed company or supplier loads update delivered quantities;
- daily-report material quantities update units complete;
- fuel fills contribute actual project/equipment cost;
- equipment, truck, worker, and subcontractor assignments provide resource usage;
- safety and issue records explain delay or productivity variance.

Every imported operational value must retain its source record ID, effective date,
and snapshot values. Corrections and cancellations must recalculate control totals
without erasing the audit history.

## Safety and engineering boundaries

Schedule calculations are planning aids. They do not replace approved drawings,
method statements, specifications, permits, inspection requirements, contractual
notices, or professional engineering review. Claude must label assumptions and
request project-specific inputs whenever a calculation affects safety, compliance,
or contractual entitlement.

## Recommended DROMEX implementation sequence

1. WBS, activity, calendar, and dependency data model.
2. CPM calculation engine with unit tests and circular-logic validation.
3. Activity tree, editor, dependency editor, and Gantt view.
4. Quantities, productivity, resources, and cost loading.
5. Baseline, status date, actual progress, and tracking view.
6. Earned-value metrics and S-curves.
7. Optional PERT, leveling, and compression scenarios.

Each phase must be approved, implemented, tested, and reviewed separately.
