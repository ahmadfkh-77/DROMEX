# Backup and Disaster Recovery

Status: **planned. No backup of any kind exists.** There is no production
database to back up yet. Nothing in this document may be described as working
until a real restore has succeeded.

## Objectives

Governed by DEC-414.

| Objective | Target |
| --- | --- |
| Recovery point objective (RPO) | no more than **one hour** of central-server data loss |
| Recovery time objective (RTO) | service restored within **four hours** |

These are targets to be **proven, not claimed**. **OQ-158 is open**: whether the
actual VPS and the chosen off-site destination can meet them cannot be answered
from the repository. It depends on real disk throughput, storage headroom, and
network bandwidth to the backup destination. The figures are modest for a
dataset of this size, which is exactly why an inability to meet them would be a
signal worth escalating rather than a tuning exercise.

## A Docker volume is not a backup

A named volume protects against container replacement. It does not protect
against disk failure, filesystem corruption, an accidental `down -v`, ransomware,
or loss of the VPS. Production readiness requires copies **outside** the VPS.

## Planned design

- Automated **encrypted** PostgreSQL backups. Continuous WAL archiving is the
  mechanism that can actually deliver a one-hour RPO; a nightly dump alone
  cannot.
- Copies stored **off the VPS**, on separate infrastructure.
- **Separate** protected media backups (photos, logos, generated documents).
- Retention tiers: daily, weekly, monthly.
- A backup taken **before every migration**, automatically, not by memory.
- **Alerting on backup failure.** Silence must never be interpreted as success.
- A written recovery runbook with exact, verified commands.

## Relationship to the existing Android backup

The Android application already has a mature, tested, password-encrypted
`.dromexbackup` mechanism (AES-256-GCM with PBKDF2, staged restore, automatic
safety copy before replacement, integrity and foreign-key checks). That
mechanism is **unchanged** by this work and remains the device-level path.

It is not a substitute for server backups, and server backups are not a
substitute for it. They protect different things: one protects a phone's local
data, the other protects the shared central database.

Two ideas from it are worth carrying to the server side because they were
designed with the right instinct: the **automatic safety copy taken before a
destructive restore**, and **integrity verification before the restore is
allowed to proceed**.

## Verification requirement

The following are not complete until each has been demonstrated with evidence:

- [ ] a backup runs automatically on schedule,
- [ ] a backup is stored off the VPS,
- [ ] backup failure raises an alert that reaches a person,
- [ ] a **real restore** into a clean environment succeeds,
- [ ] the restored database passes integrity checks,
- [ ] the measured restore time meets the RTO,
- [ ] the measured data loss window meets the RPO,
- [ ] the recovery runbook was followed by a person, and every command in it
      worked as written.

Until every box is ticked with evidence, backups are described as **untested**,
never as working.
