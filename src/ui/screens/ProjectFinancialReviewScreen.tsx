import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, LayoutAnimation, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { FinancialRepository } from '../../data/repositories/FinancialRepository';
import {
  groupSupplierTargets,
  projectAttentionTargets,
  projectPaymentEvents,
  type FinancialTarget,
  type PaymentEntry,
  type PaymentStatus,
  type ProjectFinancialSummary,
} from '../../domain/financials';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';
import {
  billingPeriodText,
  exclusionPhrase,
  formatMoney,
  formatQuantity,
  isProjectFinanciallyEmpty,
  plural,
  presentStatuses,
  statusGloss,
  statusTone,
} from './projectFinancialReviewPresentation';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Read-only project rollup opened from the Project Command Center. Three money directions are
 * presented as three separate ledger folders that are never summed: combining them would read as
 * profit while omitting labour, equipment and overhead, none of which DROMEX tracks. No payment,
 * correction, or cancellation action exists here; recording money stays in Financials.
 *
 * Motion note: sections and disclosures animate, numbers never do. An animated money value would
 * suggest the amount itself is moving.
 */
export function ProjectFinancialReview({ repository, projectId, projectName, customerName, projectStatus, onBack }: {
  repository: FinancialRepository; projectId: string; projectName: string; customerName: string; projectStatus: string; onBack: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['attention']));

  useEffect(() => {
    let active = true;
    setPhase('loading');
    setFailure(null);
    repository.getProjectFinancials(projectId)
      .then((value) => { if (!active) return; setSummary(value); setPhase('ready'); })
      .catch((cause) => { if (!active) return; setFailure(cause instanceof Error ? cause.message : 'Could not load this project financial review.'); setPhase('error'); });
    return () => { active = false; };
  }, [projectId, reloadToken, repository]);

  const toggle = (key: string) => {
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const attention = useMemo(() => summary ? projectAttentionTargets(summary.revenue.targets) : [], [summary]);
  const paymentEvents = useMemo(() => summary ? projectPaymentEvents(summary.revenue.targets) : [], [summary]);
  // Supplier -> material rollup for display only, derived from the priced deliveries already in the
  // payables block. The full delivered-quantity view (including unpriced) stays on Supplier Loads,
  // so this never becomes a second source of truth for delivered totals.
  const supplierGroups = useMemo(() => groupSupplierTargets(summary?.supplierPayables.targets ?? []), [summary]);

  if (phase === 'loading') {
    return (
      <View style={styles.screenState} accessibilityRole="text" accessibilityLabel={`Loading the financial review for ${projectName}`}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.screenStateBody}>Loading financial review…</Text>
      </View>
    );
  }

  if (phase === 'error' || !summary) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Hero projectName={projectName} customerName={customerName} projectStatus={projectStatus} onBack={onBack} />
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Could not load this review</Text>
          <Text style={styles.errorText} accessibilityRole="alert">{failure ?? 'Could not load this project financial review.'}</Text>
          <Text style={styles.helperOnSurface}>Nothing was changed. This screen only reads records, so it is safe to try again.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => setReloadToken((value) => value + 1)} accessibilityRole="button" accessibilityLabel={`Try loading the financial review for ${projectName} again`}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const empty = isProjectFinanciallyEmpty(summary);
  const revenueExcluded = exclusionPhrase(summary.revenue, 'load', 'loads');
  const supplierExcluded = exclusionPhrase(summary.supplierPayables, 'delivery', 'deliveries');
  const revenueStatuses = presentStatuses(summary.revenue.statusCounts);
  const supplierStatuses = presentStatuses(summary.supplierPayables.statusCounts);

  return (
    <Entrance reducedMotion={reducedMotion}>
      <Hero
        projectName={projectName}
        customerName={customerName}
        projectStatus={projectStatus}
        onBack={onBack}
        figures={empty ? null : {
          customerOutstanding: summary.revenue.outstandingUsd,
          supplierOutstanding: summary.supplierPayables.outstandingUsd,
          fuelCost: summary.fuel.costUsd,
        }}
      />

      <View style={styles.readOnlyBar} accessibilityRole="text" accessibilityLabel="Read only. Payments are recorded in Financials, not here.">
        <View style={styles.readOnlyMark}><Text style={styles.readOnlyMarkText}>i</Text></View>
        <Text style={styles.readOnlyText}>Read only. Payments are recorded in Financials.</Text>
      </View>

      <Disclosure
        title="Why these three are never added together"
        summary="What each section counts, and what DROMEX does not track"
        open={expanded.has('rationale')}
        onToggle={() => toggle('rationale')}
        reducedMotion={reducedMotion}
        prose
      >
        <Text style={styles.helperOnSurface}>
          Customer Revenue is what you billed for this project. Supplier Payables is what suppliers billed you. Project Costs is what the project consumed.
        </Text>
        <Text style={styles.helperOnSurface}>
          They are kept apart on purpose. DROMEX records no labour, equipment, or overhead, so subtracting one of these from another would produce a number that looks like profit but is not. No figure on this screen is project profit.
        </Text>
      </Disclosure>

      {empty ? (
        <View style={styles.emptyProject} accessibilityRole="text" accessibilityLabel={`Nothing has been recorded against ${projectName} yet. Customer revenue, supplier payables, and project costs will each appear here once records exist.`}>
          <Text style={styles.emptyTitle}>Nothing recorded yet</Text>
          <Text style={styles.helperOnSurface}>No loads, supplier deliveries, fuel fills, or recorded quantities exist for {projectName}. Each section will fill in as records are confirmed.</Text>
          <View style={styles.emptyList}>
            <EmptyExpectation number="01" title="Customer Revenue" body={`Priced loads billed to ${customerName} for this project.`} />
            <EmptyExpectation number="02" title="Supplier Payables" body="Priced supplier deliveries linked to this project." />
            <EmptyExpectation number="03" title="Project Costs" body="Equipment fuel fills, plus wall, pavement, and waste quantities." />
          </View>
        </View>
      ) : (
        <>
          <LedgerFolder
            number="01"
            title="Customer Revenue"
            purpose={`Company loads billed to ${customerName} for this project.`}
            headlineLabel="OUTSTANDING"
            headlineValue={formatMoney(summary.revenue.outstandingUsd)}
            accessibilityLabel={`Section 1, Customer Revenue. Outstanding from customer ${formatMoney(summary.revenue.outstandingUsd)}.`}
          >
            <View style={styles.tileRow}>
              <MoneyTile role="billed" label="Billed" value={summary.revenue.billedUsd} accessibilityLabel={`Billed to customer, ${formatMoney(summary.revenue.billedUsd)}`} />
              <MoneyTile role="paid" label="Paid" note="received" value={summary.revenue.paidUsd} accessibilityLabel={`Received from customer, ${formatMoney(summary.revenue.paidUsd)}`} />
            </View>
            <MoneyTile role="outstanding" label="Outstanding from customer" value={summary.revenue.outstandingUsd} wide accessibilityLabel={`Outstanding from customer, ${formatMoney(summary.revenue.outstandingUsd)}`} />
            {summary.revenue.overpaidUsd > 0 ? (
              <MoneyTile role="overpaid" label="Overpaid by customer" value={summary.revenue.overpaidUsd} wide note="payments exceed the amount billed" accessibilityLabel={`Overpaid by customer, ${formatMoney(summary.revenue.overpaidUsd)}. Payments recorded exceed the amount billed.`} />
            ) : null}

            <Text style={styles.metaLine}>{plural(summary.revenue.recordCount, 'record')} · {billingPeriodText(summary.revenue)}</Text>
            <StatusStrip statuses={revenueStatuses} noun="record" />
            {revenueExcluded ? <ExclusionStrip phrase={revenueExcluded} where="Load History" /> : null}

            {summary.revenue.recordCount === 0 ? (
              <Text style={styles.blockEmpty} accessibilityRole="text" accessibilityLabel={`No priced loads billed to ${customerName} for this project yet.`}>No priced loads billed to {customerName} for this project yet.</Text>
            ) : (
              <>
                <Disclosure
                  title="Needs attention"
                  summary={attention.length ? `${plural(attention.length, 'record')} with an outstanding balance` : 'Every record on this project is settled'}
                  open={expanded.has('attention')}
                  onToggle={() => toggle('attention')}
                  reducedMotion={reducedMotion}
                  tone={attention.length ? 'warning' : undefined}
                >
                  {attention.length
                    ? attention.map((target) => <RecordRow key={target.id} target={target} direction="revenue" />)
                    : <Text style={styles.blockEmpty}>Nothing outstanding on this project.</Text>}
                </Disclosure>
                <Disclosure
                  title="All financial records"
                  summary={plural(summary.revenue.targets.length, 'record')}
                  open={expanded.has('records')}
                  onToggle={() => toggle('records')}
                  reducedMotion={reducedMotion}
                >
                  {summary.revenue.targets.map((target) => <RecordRow key={target.id} target={target} direction="revenue" />)}
                </Disclosure>
                <Disclosure
                  title="Payment history"
                  summary={paymentEvents.length ? plural(paymentEvents.length, 'payment event') : 'No payments recorded'}
                  open={expanded.has('payments')}
                  onToggle={() => toggle('payments')}
                  reducedMotion={reducedMotion}
                >
                  {paymentEvents.length
                    ? paymentEvents.map(({ target, payment }) => <PaymentRow key={payment.id} target={target} payment={payment} />)
                    : <Text style={styles.blockEmpty}>No payments recorded against this project.</Text>}
                </Disclosure>
              </>
            )}
          </LedgerFolder>

          <LedgerFolder
            number="02"
            title="Supplier Payables"
            purpose="Supplier loads delivered to this project and billed to you. Never combined with customer revenue."
            headlineLabel="OUTSTANDING"
            headlineValue={formatMoney(summary.supplierPayables.outstandingUsd)}
            accessibilityLabel={`Section 2, Supplier Payables. Still owed to suppliers ${formatMoney(summary.supplierPayables.outstandingUsd)}.`}
          >
            <View style={styles.tileRow}>
              <MoneyTile role="billed" label="Billed to you" value={summary.supplierPayables.billedUsd} accessibilityLabel={`Billed to you by suppliers, ${formatMoney(summary.supplierPayables.billedUsd)}`} />
              <MoneyTile role="paid" label="Paid" note="settled" value={summary.supplierPayables.paidUsd} accessibilityLabel={`Paid to suppliers, ${formatMoney(summary.supplierPayables.paidUsd)}`} />
            </View>
            <MoneyTile role="outstanding" label="Still owed to suppliers" value={summary.supplierPayables.outstandingUsd} wide accessibilityLabel={`Still owed to suppliers, ${formatMoney(summary.supplierPayables.outstandingUsd)}`} />
            {summary.supplierPayables.overpaidUsd > 0 ? (
              <MoneyTile role="overpaid" label="Overpaid to suppliers" value={summary.supplierPayables.overpaidUsd} wide note="payments exceed the amount billed" accessibilityLabel={`Overpaid to suppliers, ${formatMoney(summary.supplierPayables.overpaidUsd)}. Payments recorded exceed the amount billed.`} />
            ) : null}

            <Text style={styles.metaLine}>{plural(summary.supplierPayables.recordCount, 'priced delivery', 'priced deliveries')}</Text>
            <StatusStrip statuses={supplierStatuses} noun="delivery" pluralNoun="deliveries" />
            {supplierExcluded ? <ExclusionStrip phrase={supplierExcluded} where="Supplier Loads" /> : null}

            {summary.supplierPayables.recordCount === 0 ? (
              <Text style={styles.blockEmpty} accessibilityRole="text" accessibilityLabel="No priced supplier deliveries linked to this project yet.">No priced supplier deliveries linked to this project yet.</Text>
            ) : (
              <>
                {/* DEC-405. One separated block per supplier rather than one continuous list, so two
                    suppliers can be compared by scanning a column instead of re-reading prose. */}
                <View style={styles.supplierHeading}>
                  <Text style={styles.supplierHeadingText}>{plural(supplierGroups.length, 'supplier')}</Text>
                  <Text style={styles.rowMeta}>Priced deliveries only</Text>
                </View>
                {supplierGroups.map((group) => (
                  <SupplierGroupBlock
                    key={group.supplier}
                    group={group}
                    records={summary.supplierPayables.targets.filter((target) => target.partyName === group.supplier)}
                    open={expanded.has(`supplier:${group.supplier}`)}
                    onToggle={() => toggle(`supplier:${group.supplier}`)}
                    reducedMotion={reducedMotion}
                  />
                ))}
                <Text style={styles.footnote}>Quantities here cover priced deliveries only. For every delivered quantity including unpriced ones, use Supplier Loads, then Delivery Summary.</Text>
                <Disclosure
                  title="All supplier records"
                  summary={plural(summary.supplierPayables.targets.length, 'delivery', 'deliveries')}
                  open={expanded.has('supplierRecords')}
                  onToggle={() => toggle('supplierRecords')}
                  reducedMotion={reducedMotion}
                >
                  {summary.supplierPayables.targets.map((target) => <RecordRow key={target.id} target={target} direction="supplier" />)}
                </Disclosure>
              </>
            )}
          </LedgerFolder>

          <LedgerFolder
            number="03"
            title="Project Costs"
            purpose="What the project consumed. A fuel delivery fills the shared tank, so fuel is consumption cost and never supplier debt."
            headlineLabel="FUEL COST"
            headlineValue={formatMoney(summary.fuel.costUsd)}
            accessibilityLabel={`Section 3, Project Costs. Fuel cost ${formatMoney(summary.fuel.costUsd)}.`}
          >
            {summary.fuel.fillCount === 0 ? (
              <Text style={styles.blockEmpty} accessibilityRole="text" accessibilityLabel="No fuel recorded against this project. Equipment fills linked to this project will appear here.">No fuel recorded against this project. Equipment fills linked to this project will appear here.</Text>
            ) : (
              <>
                <View style={styles.tileRow}>
                  <MoneyTile role="cost" label="Fuel cost" value={summary.fuel.costUsd} accessibilityLabel={`Fuel cost, ${formatMoney(summary.fuel.costUsd)}`} />
                  <QuantityTile label="Fuel used" value={summary.fuel.litres} unit="L" accessibilityLabel={`Fuel used, ${formatQuantity(summary.fuel.litres)} litres. This is a quantity, not money.`} />
                </View>
                <Text style={styles.metaLine}>Across {plural(summary.fuel.fillCount, 'equipment fill')} on this project.</Text>
                {summary.fuel.unpricedLitres > 0 ? (
                  <ExclusionStrip
                    phrase={`${formatQuantity(summary.fuel.unpricedLitres)} L recorded without a price`}
                    where="Fuel Ledger"
                    detail="Those litres are counted in Fuel used but contribute nothing to Fuel cost."
                  />
                ) : null}
              </>
            )}

            {summary.uncosted.length ? (
              <>
                <LabelledDivider label="NOT COSTED" />
                <View style={styles.uncostedBlock}>
                  <Text style={styles.uncostedTitle}>Recorded quantities, not costed</Text>
                  <Text style={styles.helperOnSurface}>
                    {plural(summary.uncosted.length, 'entry', 'entries')} recorded against this project. No price exists for these anywhere in DROMEX, so they are shown as quantities only and are never counted as money.
                  </Text>
                  {summary.uncosted.map((entry) => (
                    <View
                      key={`${entry.source}-${entry.label}`}
                      style={styles.uncostedRow}
                      accessibilityRole="text"
                      accessibilityLabel={`${entry.source}, ${entry.label}: ${formatQuantity(entry.quantity)} ${entry.unit}. No price recorded, not counted as money.`}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.uncostedName}>{entry.label}</Text>
                        <Text style={styles.rowMeta}>{entry.source}</Text>
                      </View>
                      <View style={styles.uncostedValueWrap}>
                        <Text style={styles.uncostedValue}>{formatQuantity(entry.quantity)}</Text>
                        <Text style={styles.uncostedUnit}>{entry.unit}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </LedgerFolder>
        </>
      )}
    </Entrance>
  );
}

// ---------------------------------------------------------------------------
// Screen-local presentation components
// ---------------------------------------------------------------------------

/** Matches the 280ms opacity-and-lift entrance the other Financials views already use. */
function Entrance({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(value, { toValue: 1, duration: reducedMotion ? 0 : 280, useNativeDriver: true }).start();
  }, [reducedMotion, value]);
  return (
    <Animated.ScrollView
      style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
      contentContainerStyle={styles.content}
    >
      {children}
    </Animated.ScrollView>
  );
}

function Hero({ projectName, customerName, projectStatus, onBack, figures }: {
  projectName: string; customerName: string; projectStatus: string; onBack: () => void;
  figures?: { customerOutstanding: number; supplierOutstanding: number; fuelCost: number } | null;
}) {
  const completed = projectStatus === 'completed';
  return (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity style={styles.heroBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to the project command center">
          <Text style={styles.heroBackText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.heroEyebrow}>FINANCIAL REVIEW</Text>
          <Text style={styles.heroTitle}>{projectName}</Text>
        </View>
      </View>
      <View style={styles.heroIdentityRow}>
        <Text style={styles.heroCustomer} accessibilityLabel={`Billed to ${customerName}`}>{customerName}</Text>
        <View style={[styles.heroStatusPill, completed && styles.heroStatusPillCompleted]}>
          <View style={[styles.heroStatusDot, completed && styles.heroStatusDotCompleted]} />
          <Text style={styles.heroStatusText}>{completed ? 'Completed' : 'Active'}</Text>
        </View>
      </View>
      {figures ? (
        <>
          <View style={styles.heroDivider} />
          <View
            style={styles.heroFigures}
            accessibilityRole="text"
            accessibilityLabel={`Three separate figures, never added together. Outstanding from customer ${formatMoney(figures.customerOutstanding)}. Owed to suppliers ${formatMoney(figures.supplierOutstanding)}. Fuel cost ${formatMoney(figures.fuelCost)}.`}
          >
            <View style={styles.heroFigure}><Text style={styles.heroFigureLabel}>OUTSTANDING{'\n'}FROM CUSTOMER</Text><Text style={styles.heroFigureValue}>{formatMoney(figures.customerOutstanding)}</Text></View>
            <View style={styles.heroFigure}><Text style={styles.heroFigureLabel}>OWED TO{'\n'}SUPPLIERS</Text><Text style={styles.heroFigureValue}>{formatMoney(figures.supplierOutstanding)}</Text></View>
            <View style={styles.heroFigure}><Text style={styles.heroFigureLabel}>FUEL{'\n'}COST</Text><Text style={styles.heroFigureValue}>{formatMoney(figures.fuelCost)}</Text></View>
          </View>
        </>
      ) : null}
    </View>
  );
}

/** A numbered navy header joined to a Ledger Cream body by the Signal Orange seam. */
function LedgerFolder({ number, title, purpose, headlineLabel, headlineValue, accessibilityLabel, children }: {
  number: string; title: string; purpose: string; headlineLabel: string; headlineValue: string; accessibilityLabel: string; children: ReactNode;
}) {
  return (
    <View style={styles.folder}>
      <View style={styles.folderTab}><Text style={styles.folderTabText}>{number}</Text></View>
      <View style={styles.folderHeader} accessibilityRole="header" accessibilityLabel={accessibilityLabel}>
        <View style={styles.folderHeaderRow}>
          <View style={styles.flex}>
            <Text style={styles.folderTitle}>{title}</Text>
          </View>
          <View style={styles.folderHeadline}>
            <Text style={styles.folderHeadlineLabel}>{headlineLabel}</Text>
            <Text style={styles.folderHeadlineValue}>{headlineValue}</Text>
          </View>
        </View>
        <Text style={styles.folderPurpose}>{purpose}</Text>
      </View>
      <View style={styles.folderSeam} />
      <View style={styles.folderBody}>{children}</View>
    </View>
  );
}

type MoneyRole = 'billed' | 'paid' | 'outstanding' | 'overpaid' | 'cost';

/** Each money role gets its own surface, rule colour, and value size, so the four are never peers. */
function MoneyTile({ role, label, value, note, wide = false, accessibilityLabel }: {
  role: MoneyRole; label: string; value: number; note?: string; wide?: boolean; accessibilityLabel: string;
}) {
  const emphasis = role === 'outstanding';
  return (
    <View
      style={[styles.tile, wide ? styles.tileWide : styles.tileHalf, role === 'billed' && styles.tileBilled, role === 'cost' && styles.tileCost, role === 'paid' && styles.tilePaid, emphasis && styles.tileOutstanding, role === 'overpaid' && styles.tileOverpaid]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.tileLabel, emphasis && styles.tileLabelOnNavy, role === 'overpaid' && styles.tileLabelOverpaid]}>{label}</Text>
      <Text style={[styles.tileValue, emphasis && styles.tileValueOnNavy, role === 'overpaid' && styles.tileValueOverpaid]}>{formatMoney(value)}</Text>
      {note ? (
        <View style={styles.tileNoteRow}>
          {role === 'paid' ? <View style={styles.tileNoteDot} /> : null}
          <Text style={[styles.tileNote, emphasis && styles.tileNoteOnNavy, role === 'overpaid' && styles.tileNoteOverpaid]}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Deliberately unlike MoneyTile: cream surface, no currency mark, and an explicit QUANTITY label. */
function QuantityTile({ label, value, unit, accessibilityLabel }: { label: string; value: number; unit: string; accessibilityLabel: string }) {
  return (
    <View style={[styles.tile, styles.tileHalf, styles.tileQuantity]} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.quantityValueRow}>
        <Text style={styles.quantityValue}>{formatQuantity(value)}</Text>
        <Text style={styles.quantityUnit}>{unit}</Text>
      </View>
      <Text style={styles.quantityMark}>QUANTITY, NOT MONEY</Text>
    </View>
  );
}

function StatusStrip({ statuses, noun, pluralNoun }: { statuses: { status: PaymentStatus; count: number }[]; noun: string; pluralNoun?: string }) {
  if (!statuses.length) return null;
  const glosses = statuses.map((entry) => statusGloss(entry.status)).filter(Boolean) as string[];
  return (
    <View style={styles.statusStripWrap}>
      <View style={styles.statusStrip}>
        {statuses.map(({ status, count }) => {
          const tone = statusTone(status);
          return (
            <View
              key={status}
              style={[styles.statusPill, tone === 'success' && styles.statusPillSuccess, tone === 'warning' && styles.statusPillWarning, tone === 'danger' && styles.statusPillDanger, tone === 'neutral' && styles.statusPillNeutral]}
              accessibilityRole="text"
              accessibilityLabel={`${count} ${count === 1 ? noun : (pluralNoun ?? `${noun}s`)} ${status}`}
            >
              <View style={[styles.statusDot, tone === 'success' && styles.statusDotSuccess, tone === 'warning' && styles.statusDotWarning, tone === 'danger' && styles.statusDotDanger, tone === 'neutral' && styles.statusDotNeutral]} />
              <Text style={[styles.statusPillText, tone === 'success' && styles.statusTextSuccess, tone === 'warning' && styles.statusTextWarning, tone === 'danger' && styles.statusTextDanger, tone === 'neutral' && styles.statusTextNeutral]}>
                {count} {status}
              </Text>
            </View>
          );
        })}
      </View>
      {glosses.map((gloss) => <Text key={gloss} style={styles.gloss}>{gloss}</Text>)}
    </View>
  );
}

/** Visually distinct from the explanatory footnotes: an outlined strip that names what was held out. */
function ExclusionStrip({ phrase, where, detail }: { phrase: string; where: string; detail?: string }) {
  return (
    <View style={styles.exclusion} accessibilityRole="text" accessibilityLabel={`Not included in these totals: ${phrase}. ${detail ?? `They stay visible in ${where}.`}`}>
      <Text style={styles.exclusionLabel}>NOT IN THESE TOTALS</Text>
      <Text style={styles.exclusionText}>{phrase}</Text>
      <Text style={styles.exclusionWhere}>{detail ?? `Still visible in ${where}.`}</Text>
    </View>
  );
}

function LabelledDivider({ label }: { label: string }) {
  return (
    <View style={styles.labelledDivider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.dividerRule} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.dividerRule} />
    </View>
  );
}

function Disclosure({ title, summary, open, onToggle, reducedMotion, tone, prose = false, children }: {
  title: string; summary: string; open: boolean; onToggle: () => void; reducedMotion: boolean; tone?: 'warning'; prose?: boolean; children: ReactNode;
}) {
  return (
    <View style={[styles.disclosure, tone === 'warning' && styles.disclosureWarning]}>
      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.disclosureHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${summary}`}
        accessibilityHint={open ? 'Hides these details' : 'Shows these details'}
      >
        <View style={styles.flex}>
          <Text style={[styles.disclosureTitle, tone === 'warning' && styles.disclosureTitleWarning]}>{title}</Text>
          <Text style={styles.disclosureSummary}>{open ? 'Tap to hide' : 'Tap to view'} · {summary}</Text>
        </View>
        <DisclosureMark open={open} reducedMotion={reducedMotion} />
      </TouchableOpacity>
      {open ? <View style={prose ? styles.disclosureProseBody : styles.disclosureBody}>{children}</View> : null}
    </View>
  );
}

function DisclosureMark({ open, reducedMotion }: { open: boolean; reducedMotion: boolean }) {
  const spin = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(spin, { toValue: open ? 1 : 0, duration: reducedMotion ? 0 : 180, useNativeDriver: true }).start();
  }, [open, reducedMotion, spin]);
  return (
    <Animated.Text style={[styles.disclosureMark, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }]}>+</Animated.Text>
  );
}

/** Money-in and money-out rows carry the documented two-hue accent so they can never be confused. */
function RecordRow({ target, direction }: { target: FinancialTarget; direction: 'revenue' | 'supplier' }) {
  const quantity = target.quantity != null ? `${formatQuantity(target.quantity)} ${target.unitSymbol ?? ''}`.trim() : null;
  const balance = target.overpaidUsd > 0
    ? { label: 'Overpaid', value: target.overpaidUsd }
    : target.remainingUsd > 0 ? { label: 'Outstanding', value: target.remainingUsd } : null;
  const tone = statusTone(target.status);
  return (
    <View
      style={[styles.recordRow, direction === 'revenue' ? styles.recordRowRevenue : styles.recordRowSupplier]}
      accessibilityRole="text"
      accessibilityLabel={`${target.reference}, ${target.recordDate.slice(0, 10)}${target.itemName ? `, ${target.itemName}` : ''}${quantity ? `, ${quantity}` : ''}. Billed ${formatMoney(target.totalUsd)}, paid ${formatMoney(target.paidUsd)}${balance ? `, ${balance.label.toLowerCase()} ${formatMoney(balance.value)}` : ''}. Status ${target.status}. ${plural(target.payments.length, 'payment event')}.`}
    >
      <View style={styles.recordTopRow}>
        <View style={styles.flex}>
          <Text style={styles.recordReference}>{target.reference}</Text>
          <Text style={styles.rowMeta}>{target.recordDate.slice(0, 10)}{target.itemName ? ` · ${target.itemName}` : ''}</Text>
          {quantity ? <Text style={styles.recordQuantity}>{quantity}</Text> : null}
        </View>
        <View style={styles.recordRight}>
          <Text style={styles.recordMoney}>{formatMoney(target.totalUsd)}</Text>
          <Text style={styles.recordMoneyLabel}>BILLED</Text>
        </View>
      </View>
      <View style={styles.recordBottomRow}>
        <View
          style={[styles.statusPill, tone === 'success' && styles.statusPillSuccess, tone === 'warning' && styles.statusPillWarning, tone === 'danger' && styles.statusPillDanger, tone === 'neutral' && styles.statusPillNeutral]}
        >
          <View style={[styles.statusDot, tone === 'success' && styles.statusDotSuccess, tone === 'warning' && styles.statusDotWarning, tone === 'danger' && styles.statusDotDanger, tone === 'neutral' && styles.statusDotNeutral]} />
          <Text style={[styles.statusPillText, tone === 'success' && styles.statusTextSuccess, tone === 'warning' && styles.statusTextWarning, tone === 'danger' && styles.statusTextDanger, tone === 'neutral' && styles.statusTextNeutral]}>{target.status}</Text>
        </View>
        <Text style={styles.rowMeta}>Paid {formatMoney(target.paidUsd)} of {formatMoney(target.totalUsd)}</Text>
      </View>
      {balance ? <Text style={styles.recordBalance}>{balance.label} {formatMoney(balance.value)}</Text> : null}
    </View>
  );
}

function PaymentRow({ target, payment }: { target: FinancialTarget; payment: PaymentEntry }) {
  const cancelled = payment.status === 'Cancelled';
  return (
    <View
      style={[styles.recordRow, cancelled ? styles.recordRowCancelled : styles.recordRowRevenue]}
      accessibilityRole="text"
      accessibilityLabel={`${formatMoney(payment.amountUsd)} on ${payment.paymentDate} against ${target.reference}. ${cancelled ? 'Cancelled, and not counted in any total.' : 'Active.'}${cancelled && payment.cancellationReason ? ` Reason: ${payment.cancellationReason}.` : ''}`}
    >
      <View style={styles.recordTopRow}>
        <View style={styles.flex}>
          <Text style={[styles.recordReference, cancelled && styles.strikethrough]}>{formatMoney(payment.amountUsd)}</Text>
          <Text style={styles.rowMeta}>{payment.paymentDate} · {target.reference}</Text>
        </View>
        <View style={[styles.statusPill, cancelled ? styles.statusPillDanger : styles.statusPillSuccess]}>
          <View style={[styles.statusDot, cancelled ? styles.statusDotDanger : styles.statusDotSuccess]} />
          <Text style={[styles.statusPillText, cancelled ? styles.statusTextDanger : styles.statusTextSuccess]}>{payment.status}</Text>
        </View>
      </View>
      {cancelled ? (
        <Text style={styles.cancelledNote}>
          Not counted in any total.{payment.cancellationReason ? ` Reason: ${payment.cancellationReason}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * DEC-405. One supplier per separated block: name, then billed / paid / outstanding in three fixed
 * columns so several suppliers compare by scanning straight down, then the materials, then the
 * delivery records behind a disclosure that is closed by default. The disclosure is a flat ruled row
 * inside the block rather than another bordered card, because card-in-card is prohibited here.
 */
function SupplierGroupBlock({ group, records, open, onToggle, reducedMotion }: {
  group: ReturnType<typeof groupSupplierTargets>[number];
  records: FinancialTarget[]; open: boolean; onToggle: () => void; reducedMotion: boolean;
}) {
  const owed = group.outstanding > 0;
  const label = `${group.supplier}. Billed ${formatMoney(group.billed)}. Paid ${formatMoney(group.paid)}. `
    + `${owed ? `Outstanding ${formatMoney(group.outstanding)}` : 'Nothing outstanding'}.`
    + `${group.overpaid > 0 ? ` Overpaid ${formatMoney(group.overpaid)}.` : ''}`
    + ` ${plural(group.deliveries, 'delivery', 'deliveries')}, ${plural(group.materials.length, 'material')}.`;
  return (
    <View style={styles.supplierBlock}>
      <View style={styles.supplierHeader} accessibilityRole="text" accessibilityLabel={label}>
        <Text style={styles.supplierName}>{group.supplier}</Text>
        <Text style={styles.rowMeta}>{plural(group.deliveries, 'delivery', 'deliveries')} · {plural(group.materials.length, 'material')}</Text>
      </View>

      <View style={styles.supplierTotals}>
        <SupplierTotal label="BILLED" value={formatMoney(group.billed)} />
        <SupplierTotal label="PAID" value={formatMoney(group.paid)} tone="paid" />
        <SupplierTotal label="OUTSTANDING" value={formatMoney(group.outstanding)} tone={owed ? 'owed' : undefined} />
      </View>
      {group.overpaid > 0 ? (
        <Text style={styles.supplierOverpaid} accessibilityRole="text" accessibilityLabel={`Overpaid ${formatMoney(group.overpaid)}. Payments recorded come to more than this supplier billed.`}>
          Overpaid {formatMoney(group.overpaid)} · payments recorded exceed what this supplier billed
        </Text>
      ) : null}

      <View style={styles.supplierMaterials}>
        {group.materials.map((material) => (
          <View
            key={material.key}
            style={styles.materialRow}
            accessibilityRole="text"
            accessibilityLabel={`${material.name}: ${formatQuantity(material.quantity)} ${material.unit} delivered across ${plural(material.deliveries, 'trip')}, billed ${formatMoney(material.billed)}.`}
          >
            <View style={styles.flex}>
              <Text style={styles.materialName}>{material.name}</Text>
              <Text style={styles.rowMeta}>{plural(material.deliveries, 'trip')}</Text>
            </View>
            <View style={styles.materialRight}>
              <Text style={styles.materialQuantity}>{formatQuantity(material.quantity)}&#160;{material.unit}</Text>
              <Text style={styles.materialMoney}>{formatMoney(material.billed)}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.supplierDisclosure}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${group.supplier} delivery records, ${plural(records.length, 'record')}`}
        accessibilityHint={open ? 'Hides these records' : 'Shows these records'}
      >
        <Text style={styles.supplierDisclosureText}>{open ? 'Tap to hide' : 'Tap to view'} · {plural(records.length, 'delivery record')}</Text>
        <DisclosureMark open={open} reducedMotion={reducedMotion} />
      </TouchableOpacity>
      {open ? (
        <View style={styles.supplierRecords}>
          {records.map((target) => <RecordRow key={target.id} target={target} direction="supplier" />)}
        </View>
      ) : null}
    </View>
  );
}

function SupplierTotal({ label, value, tone }: { label: string; value: string; tone?: 'paid' | 'owed' }) {
  return (
    <View style={styles.supplierTotal}>
      <Text style={styles.supplierTotalLabel}>{label}</Text>
      <Text style={[styles.supplierTotalValue, tone === 'owed' && styles.supplierTotalValueOwed, tone === 'paid' && styles.supplierTotalValuePaid]}>{value}</Text>
    </View>
  );
}

function EmptyExpectation({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <View style={styles.emptyExpectation}>
      <View style={styles.emptyMarker}><Text style={styles.emptyMarkerText}>{number}</Text></View>
      <View style={styles.flex}>
        <Text style={styles.emptyExpectationTitle}>{title}</Text>
        <Text style={styles.helperOnSurface}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  helperOnSurface: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  metaLine: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  rowMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 13, backgroundColor: colors.surface },

  screenState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  screenStateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 10 },
  panelTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  errorText: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },
  retryButton: { minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  retryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 24, fontWeight: '900', marginTop: 2 },
  heroIdentityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  heroCustomer: { color: '#D5E4EF', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  heroStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', flexShrink: 0 },
  heroStatusPillCompleted: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  heroStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8FD6B4' },
  heroStatusDotCompleted: { backgroundColor: '#D5E4EF' },
  heroStatusText: { color: '#FFF8ED', fontSize: 11, fontWeight: '900' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  heroFigures: { flexDirection: 'row', gap: 10 },
  heroFigure: { flex: 1, minWidth: 0, gap: 4 },
  heroFigureLabel: { color: '#D5E4EF', fontSize: 9, fontWeight: '800', letterSpacing: .5, lineHeight: 12 },
  heroFigureValue: { color: '#FFF8ED', fontSize: 16, fontWeight: '900' },

  readOnlyBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, paddingVertical: 11 },
  readOnlyMark: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#E8F0F6', alignItems: 'center', justifyContent: 'center' },
  readOnlyMarkText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  readOnlyText: { color: colors.ink, fontSize: 13, fontWeight: '700', flex: 1 },

  folder: { marginTop: 16 },
  folderTab: { position: 'absolute', top: -12, left: 16, zIndex: 2, elevation: 3, backgroundColor: colors.cream, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 4 },
  folderTabText: { color: colors.navy, fontSize: 12, fontWeight: '900', letterSpacing: .4 },
  folderHeader: { backgroundColor: colors.navy, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, gap: 6 },
  folderHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  folderTitle: { color: '#FFF8ED', fontSize: 19, fontWeight: '800' },
  folderHeadline: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  folderHeadlineLabel: { color: '#F2A184', fontSize: 9, fontWeight: '900', letterSpacing: .6 },
  folderHeadlineValue: { color: '#FFF8ED', fontSize: 18, fontWeight: '900' },
  folderPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },
  folderSeam: { height: 3, backgroundColor: colors.brand },
  folderBody: { backgroundColor: colors.cream, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderWidth: 1, borderTopWidth: 0, borderColor: '#E8DED0', padding: 14, gap: 12 },

  tileRow: { flexDirection: 'row', gap: 10 },
  tile: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, gap: 3, justifyContent: 'center' },
  tileHalf: { flex: 1, minWidth: 0 },
  tileWide: { width: '100%' },
  tileBilled: { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.navy },
  tileCost: { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.brandDark },
  tilePaid: { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.success },
  tileOutstanding: { backgroundColor: colors.navy, paddingVertical: 16 },
  tileOverpaid: { backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: colors.warning },
  tileQuantity: { backgroundColor: colors.creamSoft, borderWidth: 1, borderColor: '#E8DED0', borderStyle: 'dashed' },
  tileLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  tileLabelOnNavy: { color: '#D5E4EF' },
  // Warning-on-warning-tint measures 4.49:1, so only the large value and the border carry the hue
  // here; the small label and note stay high-contrast and the word "Overpaid" carries the meaning.
  tileLabelOverpaid: { color: colors.ink },
  tileValue: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  tileValueOnNavy: { color: '#FFF8ED', fontSize: 27 },
  tileValueOverpaid: { color: colors.warning },
  tileNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileNoteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  tileNote: { color: colors.muted, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  tileNoteOnNavy: { color: '#D5E4EF' },
  tileNoteOverpaid: { color: colors.muted },
  quantityValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  quantityValue: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  quantityUnit: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  quantityMark: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .5 },

  statusStripWrap: { gap: 8 },
  statusStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, flexShrink: 0 },
  statusPillSuccess: { backgroundColor: '#E5F3EC' },
  statusPillWarning: { backgroundColor: '#FFF3D8' },
  statusPillDanger: { backgroundColor: '#FCE8E6' },
  statusPillNeutral: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotSuccess: { backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  statusDotDanger: { backgroundColor: colors.danger },
  statusDotNeutral: { backgroundColor: colors.muted },
  statusPillText: { fontSize: 11, fontWeight: '900' },
  statusTextSuccess: { color: colors.success },
  statusTextWarning: { color: colors.warning },
  statusTextDanger: { color: colors.danger },
  statusTextNeutral: { color: colors.muted },
  gloss: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  // Helper text sits on a surface rather than on the page or cream ground, where `muted` measures
  // only 4.46:1 against the background.
  blockEmpty: { color: colors.muted, fontSize: 13, lineHeight: 19, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 13 },

  exclusion: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  exclusionLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  exclusionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  exclusionWhere: { color: colors.muted, fontSize: 12, lineHeight: 17 },

  labelledDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  dividerRule: { flex: 1, height: 1, backgroundColor: '#E0D6C6' },
  dividerLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .8 },

  disclosure: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  disclosureWarning: { borderColor: colors.warning, backgroundColor: '#FFFCF4' },
  disclosureHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  disclosureTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  disclosureTitleWarning: { color: colors.warning },
  disclosureSummary: { color: colors.muted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  disclosureMark: { color: colors.brandDark, fontSize: 24, fontWeight: '700', width: 24, textAlign: 'center' },
  // Record bodies use a tinted ground so the white rows separate; prose bodies stay on the surface
  // so `muted` body text keeps its 4.85:1 rather than dropping to 4.46:1 on the tint.
  disclosureBody: { borderTopWidth: 1, borderTopColor: colors.line, gap: 1, backgroundColor: colors.creamSoft, padding: 1 },
  disclosureProseBody: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, padding: 14, gap: 10 },

  recordRow: { backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 12, gap: 8, borderLeftWidth: 3 },
  recordRowRevenue: { borderLeftColor: colors.brand },
  recordRowSupplier: { borderLeftColor: colors.navy },
  recordRowCancelled: { borderLeftColor: colors.danger },
  recordTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  recordReference: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  recordQuantity: { color: colors.navy, fontSize: 13, fontWeight: '900', marginTop: 4 },
  recordRight: { alignItems: 'flex-end', flexShrink: 0, gap: 1 },
  recordMoney: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  recordMoneyLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .5 },
  recordBottomRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  recordBalance: { color: colors.warning, fontSize: 12, fontWeight: '800' },
  strikethrough: { textDecorationLine: 'line-through', color: colors.muted },
  cancelledNote: { color: colors.danger, fontSize: 12, lineHeight: 17 },

  supplierHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  supplierHeadingText: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  // One block per supplier, separated by real space and a boundary rather than nested inside a card.
  supplierBlock: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.navy, paddingVertical: 12, gap: 10 },
  supplierHeader: { paddingHorizontal: 13, gap: 2 },
  supplierName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  supplierTotals: { flexDirection: 'row', gap: 10, paddingHorizontal: 13 },
  supplierTotal: { flex: 1, minWidth: 0, gap: 2 },
  supplierTotalLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .5 },
  supplierTotalValue: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  supplierTotalValueOwed: { color: colors.warning },
  supplierTotalValuePaid: { color: colors.success },
  supplierOverpaid: { color: colors.warning, fontSize: 12, fontWeight: '700', lineHeight: 17, paddingHorizontal: 13 },
  supplierMaterials: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 2 },
  supplierDisclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 13, borderTopWidth: 1, borderTopColor: colors.line },
  supplierDisclosureText: { color: colors.brandDark, fontSize: 12, fontWeight: '800' },
  supplierRecords: { backgroundColor: colors.creamSoft, gap: 1, paddingTop: 1 },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  materialName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  materialRight: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  materialQuantity: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  materialMoney: { color: colors.muted, fontSize: 12, fontWeight: '700' },

  uncostedBlock: { borderWidth: 1, borderColor: '#D9CFBE', borderStyle: 'dashed', borderRadius: 14, padding: 13, gap: 10 },
  uncostedTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  uncostedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#E0D6C6', paddingTop: 10 },
  uncostedName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  uncostedValueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  uncostedValue: { color: colors.navy, fontSize: 16, fontWeight: '900' },
  uncostedUnit: { color: colors.navy, fontSize: 12, fontWeight: '700' },

  emptyProject: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 16, padding: 17, gap: 10, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  emptyList: { gap: 12, marginTop: 2 },
  emptyExpectation: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  emptyMarker: { minWidth: 28, height: 24, borderRadius: 7, backgroundColor: colors.creamSoft, alignItems: 'center', justifyContent: 'center' },
  emptyMarkerText: { color: colors.navy, fontSize: 11, fontWeight: '900' },
  emptyExpectationTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', marginBottom: 2 },
});
