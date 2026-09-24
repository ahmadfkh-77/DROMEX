import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
 * presented as three separate cards that are never summed: combining them would read as profit while
 * omitting labour, equipment and overhead, none of which DROMEX tracks. No payment, correction, or
 * cancellation action exists here; recording money stays in Financials.
 *
 * Each card opens with + and closes with ×, closed by default, and keeps its headline figure in the
 * header so the essential number is readable without opening anything. Billed, Paid, Outstanding and
 * cost each have their own quiet box colour; every box is also labelled in words.
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const isOpen = (key: string) => expanded.has(key);

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
          <Text style={styles.helper}>Nothing was changed. This screen only reads records, so it is safe to try again.</Text>
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
        open={isOpen('rationale')}
        onToggle={() => toggle('rationale')}
        prose
      >
        <Text style={styles.helper}>
          Customer Revenue is what you billed for this project. Supplier Payables is what suppliers billed you. Project Costs is what the project consumed.
        </Text>
        <Text style={styles.helper}>
          They are kept apart on purpose. DROMEX records no labour, equipment, or overhead, so subtracting one of these from another would produce a number that looks like profit but is not. No figure on this screen is project profit.
        </Text>
      </Disclosure>

      {empty ? (
        <View style={styles.emptyProject} accessibilityRole="text" accessibilityLabel={`Nothing has been recorded against ${projectName} yet. Customer revenue, supplier payables, and project costs will each appear here once records exist.`}>
          <Text style={styles.emptyTitle}>Nothing recorded yet</Text>
          <Text style={styles.helper}>No loads, supplier deliveries, fuel fills, or recorded quantities exist for {projectName}. Each section will fill in as records are confirmed.</Text>
          <View style={styles.emptyList}>
            <EmptyExpectation title="Customer Revenue" body={`Priced loads billed to ${customerName} for this project.`} />
            <EmptyExpectation title="Supplier Payables" body="Priced supplier deliveries linked to this project." />
            <EmptyExpectation title="Project Costs" body="Equipment fuel fills, plus wall, pavement, and waste quantities." />
          </View>
        </View>
      ) : (
        <>
          <SectionCard
            title="Customer Revenue"
            purpose={`Company loads billed to ${customerName} for this project.`}
            headlineLabel="Outstanding"
            headlineValue={formatMoney(summary.revenue.outstandingUsd)}
            open={isOpen('revenue')}
            onToggle={() => toggle('revenue')}
          >
            <View style={styles.tileRow}>
              <MoneyTile role="billed" label="Billed" value={summary.revenue.billedUsd} accessibilityLabel={`Billed to customer, ${formatMoney(summary.revenue.billedUsd)}`} />
              <MoneyTile role="paid" label="Paid" note="received" value={summary.revenue.paidUsd} accessibilityLabel={`Received from customer, ${formatMoney(summary.revenue.paidUsd)}`} />
            </View>
            <MoneyTile role="outstanding" label="Outstanding from customer" value={summary.revenue.outstandingUsd} wide accessibilityLabel={`Outstanding from customer, ${formatMoney(summary.revenue.outstandingUsd)}`} />
            {summary.revenue.overpaidUsd > 0 ? (
              <MoneyTile role="overpaid" label="Overpaid by customer" value={summary.revenue.overpaidUsd} wide note="payments exceed the amount billed" accessibilityLabel={`Overpaid by customer, ${formatMoney(summary.revenue.overpaidUsd)}. Payments recorded exceed the amount billed.`} />
            ) : null}

            <PaidScopeNote />
            <Text style={styles.metaLine}>{plural(summary.revenue.recordCount, 'record')} · {billingPeriodText(summary.revenue)}</Text>
            <StatusStrip statuses={revenueStatuses} noun="record" />
            {revenueExcluded ? <ExclusionStrip phrase={revenueExcluded} where="Load History" /> : null}

            {summary.revenue.recordCount === 0 ? (
              <Text style={styles.blockEmpty} accessibilityRole="text" accessibilityLabel={`No priced loads billed to ${customerName} for this project yet.`}>No priced loads billed to {customerName} for this project yet.</Text>
            ) : (
              <>
                {/* Needs attention starts open once its section is opened: it is the reason to be here. */}
                <Disclosure
                  title="Needs attention"
                  summary={attention.length ? `${plural(attention.length, 'record')} with an outstanding balance` : 'Every record on this project is settled'}
                  open={!isOpen('attention:closed')}
                  onToggle={() => toggle('attention:closed')}
                  tone={attention.length ? 'warning' : undefined}
                >
                  {attention.length
                    ? attention.map((target) => <RecordRow key={target.id} target={target} />)
                    : <Text style={styles.blockEmpty}>Nothing outstanding on this project.</Text>}
                </Disclosure>
                <Disclosure
                  title="All financial records"
                  summary={plural(summary.revenue.targets.length, 'record')}
                  open={isOpen('records')}
                  onToggle={() => toggle('records')}
                >
                  {summary.revenue.targets.map((target) => <RecordRow key={target.id} target={target} />)}
                </Disclosure>
                <Disclosure
                  title="Payment history"
                  summary={paymentEvents.length ? plural(paymentEvents.length, 'payment event') : 'No payments recorded'}
                  open={isOpen('payments')}
                  onToggle={() => toggle('payments')}
                >
                  {paymentEvents.length
                    ? paymentEvents.map(({ target, payment }) => <PaymentRow key={payment.id} target={target} payment={payment} />)
                    : <Text style={styles.blockEmpty}>No payments recorded against this project.</Text>}
                </Disclosure>
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Supplier Payables"
            purpose="Supplier loads delivered to this project and billed to you. Never combined with customer revenue."
            headlineLabel="Still owed"
            headlineValue={formatMoney(summary.supplierPayables.outstandingUsd)}
            open={isOpen('suppliers')}
            onToggle={() => toggle('suppliers')}
          >
            <View style={styles.tileRow}>
              <MoneyTile role="billed" label="Billed to you" value={summary.supplierPayables.billedUsd} accessibilityLabel={`Billed to you by suppliers, ${formatMoney(summary.supplierPayables.billedUsd)}`} />
              <MoneyTile role="paid" label="Paid" note="settled" value={summary.supplierPayables.paidUsd} accessibilityLabel={`Paid to suppliers, ${formatMoney(summary.supplierPayables.paidUsd)}`} />
            </View>
            <MoneyTile role="outstanding" label="Still owed to suppliers" value={summary.supplierPayables.outstandingUsd} wide accessibilityLabel={`Still owed to suppliers, ${formatMoney(summary.supplierPayables.outstandingUsd)}`} />
            {summary.supplierPayables.overpaidUsd > 0 ? (
              <MoneyTile role="overpaid" label="Overpaid to suppliers" value={summary.supplierPayables.overpaidUsd} wide note="payments exceed the amount billed" accessibilityLabel={`Overpaid to suppliers, ${formatMoney(summary.supplierPayables.overpaidUsd)}. Payments recorded exceed the amount billed.`} />
            ) : null}

            <PaidScopeNote />
            <Text style={styles.metaLine}>{plural(summary.supplierPayables.recordCount, 'priced delivery', 'priced deliveries')}</Text>
            <StatusStrip statuses={supplierStatuses} noun="delivery" pluralNoun="deliveries" />
            {supplierExcluded ? <ExclusionStrip phrase={supplierExcluded} where="Supplier Loads" /> : null}

            {summary.supplierPayables.recordCount === 0 ? (
              <Text style={styles.blockEmpty} accessibilityRole="text" accessibilityLabel="No priced supplier deliveries linked to this project yet.">No priced supplier deliveries linked to this project yet.</Text>
            ) : (
              <>
                {/* DEC-405. One separated card per supplier, so two suppliers compare by scanning. */}
                <View style={styles.subheadRow}>
                  <Text style={styles.subhead}>{plural(supplierGroups.length, 'supplier')}</Text>
                  <Text style={styles.metaLine}>Priced deliveries only</Text>
                </View>
                <View style={styles.cardStack}>
                  {supplierGroups.map((group) => (
                    <SupplierCard
                      key={group.supplier}
                      group={group}
                      records={summary.supplierPayables.targets.filter((target) => target.partyName === group.supplier)}
                      open={isOpen(`supplier:${group.supplier}`)}
                      onToggle={() => toggle(`supplier:${group.supplier}`)}
                      recordsOpen={isOpen(`supplierRecords:${group.supplier}`)}
                      onToggleRecords={() => toggle(`supplierRecords:${group.supplier}`)}
                    />
                  ))}
                </View>
                <Text style={styles.footnote}>Quantities here cover priced deliveries only. For every delivered quantity including unpriced ones, use Supplier Loads, then Delivery Summary.</Text>
                <Disclosure
                  title="All supplier records"
                  summary={plural(summary.supplierPayables.targets.length, 'delivery', 'deliveries')}
                  open={isOpen('supplierRecords')}
                  onToggle={() => toggle('supplierRecords')}
                >
                  {summary.supplierPayables.targets.map((target) => <RecordRow key={target.id} target={target} />)}
                </Disclosure>
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Project Costs"
            purpose="What the project consumed. A fuel delivery fills the shared tank, so fuel is consumption cost and never supplier debt."
            headlineLabel="Fuel cost"
            headlineValue={formatMoney(summary.fuel.costUsd)}
            open={isOpen('costs')}
            onToggle={() => toggle('costs')}
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
              <View style={styles.uncostedBlock}>
                <Text style={styles.subhead}>Recorded quantities, not costed</Text>
                <Text style={styles.helper}>
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
                      <Text style={styles.rowTitle}>{entry.label}</Text>
                      <Text style={styles.metaLine}>{entry.source}</Text>
                    </View>
                    <Text style={styles.quantityInline}>{formatQuantity(entry.quantity)}&#160;{entry.unit}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </SectionCard>
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
        <View
          style={styles.heroFigures}
          accessibilityRole="text"
          accessibilityLabel={`Three separate figures, never added together. Outstanding from customer ${formatMoney(figures.customerOutstanding)}. Owed to suppliers ${formatMoney(figures.supplierOutstanding)}. Fuel cost ${formatMoney(figures.fuelCost)}.`}
        >
          <HeroFigure label="Customer owes" value={formatMoney(figures.customerOutstanding)} />
          <HeroFigure label="Owed to suppliers" value={formatMoney(figures.supplierOutstanding)} />
          <HeroFigure label="Fuel cost" value={formatMoney(figures.fuelCost)} />
        </View>
      ) : null}
    </View>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroFigure}>
      <Text style={styles.heroFigureLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.heroFigureValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
    </View>
  );
}

/** The + / × control used by every card and list that opens on this screen. */
function Toggle({ open }: { open: boolean }) {
  return (
    <View style={[styles.toggle, open && styles.toggleOpen]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[styles.toggleGlyph, open && styles.toggleGlyphOpen]}>{open ? '×' : '+'}</Text>
    </View>
  );
}

/** One money direction: a bordered card whose header always shows its headline figure. */
function SectionCard({ title, purpose, headlineLabel, headlineValue, open, onToggle, children }: {
  title: string; purpose: string; headlineLabel: string; headlineValue: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.sectionHeader, pressed && styles.pressed]}
        android_ripple={{ color: '#EFE9DF' }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${headlineLabel} ${headlineValue}.`}
        accessibilityHint={open ? 'Hides the details' : 'Shows the details'}
      >
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionPurpose}>{purpose}</Text>
        </View>
        <View style={styles.sectionHeadline}>
          <Text style={styles.sectionHeadlineLabel}>{headlineLabel}</Text>
          <Text style={styles.sectionHeadlineValue}>{headlineValue}</Text>
        </View>
        <Toggle open={open} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

type MoneyRole = 'billed' | 'paid' | 'outstanding' | 'overpaid' | 'cost';

/**
 * Each money role has its own quiet box: Billed blue-grey, Paid soft green, Outstanding outlined in
 * navy with the largest value, cost warm cream, Overpaid the warning tint. The label always names it.
 */
function MoneyTile({ role, label, value, note, wide = false, compact = false, accessibilityLabel }: {
  role: MoneyRole; label: string; value: number; note?: string; wide?: boolean; compact?: boolean; accessibilityLabel: string;
}) {
  return (
    <View
      style={[styles.tile, wide ? styles.tileWide : styles.tileHalf, compact && styles.tileCompact,
        role === 'billed' && styles.tileBilled, role === 'paid' && styles.tilePaid, role === 'outstanding' && styles.tileOutstanding,
        role === 'cost' && styles.tileCost, role === 'overpaid' && styles.tileOverpaid]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.tileLabel, role === 'billed' && styles.tileLabelBilled, role === 'paid' && styles.tileLabelPaid, role === 'outstanding' && styles.tileLabelOutstanding, role === 'cost' && styles.tileLabelCost]} numberOfLines={2}>{label}</Text>
      <Text style={[styles.tileValue, compact && styles.tileValueCompact, role === 'outstanding' && !compact && styles.tileValueOutstanding, role === 'overpaid' && styles.tileValueOverpaid]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatMoney(value)}</Text>
      {note ? <Text style={styles.tileNote}>{note}</Text> : null}
    </View>
  );
}

/** Deliberately unlike MoneyTile: dashed outline, no currency mark, and an explicit quantity label. */
function QuantityTile({ label, value, unit, accessibilityLabel }: { label: string; value: number; unit: string; accessibilityLabel: string }) {
  return (
    <View style={[styles.tile, styles.tileHalf, styles.tileQuantity]} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.quantityValueRow}>
        <Text style={styles.quantityValue}>{formatQuantity(value)}</Text>
        <Text style={styles.quantityUnit}>{unit}</Text>
      </View>
      <Text style={styles.tileNote}>Quantity, not money</Text>
    </View>
  );
}

function StatusPill({ status, label }: { status: PaymentStatus | 'Active' | 'Cancelled'; label?: string }) {
  const tone = status === 'Cancelled' ? 'danger' : status === 'Active' ? 'success' : statusTone(status);
  return (
    <View style={[styles.statusPill, tone === 'success' && styles.statusPillSuccess, tone === 'warning' && styles.statusPillWarning, tone === 'danger' && styles.statusPillDanger, tone === 'neutral' && styles.statusPillNeutral]}>
      <View style={[styles.statusDot, tone === 'success' && styles.statusDotSuccess, tone === 'warning' && styles.statusDotWarning, tone === 'danger' && styles.statusDotDanger, tone === 'neutral' && styles.statusDotNeutral]} />
      <Text style={[styles.statusPillText, tone === 'success' && styles.statusTextSuccess, tone === 'warning' && styles.statusTextWarning, tone === 'danger' && styles.statusTextDanger, tone === 'neutral' && styles.statusTextNeutral]}>{label ?? status}</Text>
    </View>
  );
}

function StatusStrip({ statuses, noun, pluralNoun }: { statuses: { status: PaymentStatus; count: number }[]; noun: string; pluralNoun?: string }) {
  if (!statuses.length) return null;
  const glosses = statuses.map((entry) => statusGloss(entry.status)).filter(Boolean) as string[];
  return (
    <View style={styles.statusStripWrap}>
      <View style={styles.statusStrip}>
        {statuses.map(({ status, count }) => (
          <View key={status} accessible accessibilityRole="text" accessibilityLabel={`${count} ${count === 1 ? noun : (pluralNoun ?? `${noun}s`)} ${status}`}>
            <StatusPill status={status} label={`${count} ${status}`} />
          </View>
        ))}
      </View>
      {glosses.map((gloss) => <Text key={gloss} style={styles.metaLine}>{gloss}</Text>)}
    </View>
  );
}

/** Visually distinct from the explanatory footnotes: an outlined strip that names what was held out. */
function ExclusionStrip({ phrase, where, detail }: { phrase: string; where: string; detail?: string }) {
  return (
    <View style={styles.exclusion} accessibilityRole="text" accessibilityLabel={`Not included in these totals: ${phrase}. ${detail ?? `They stay visible in ${where}.`}`}>
      <Text style={styles.exclusionLabel}>Not in these totals</Text>
      <Text style={styles.exclusionText}>{phrase}</Text>
      <Text style={styles.metaLine}>{detail ?? `Still visible in ${where}.`}</Text>
    </View>
  );
}

function Disclosure({ title, summary, open, onToggle, tone, prose = false, children }: {
  title: string; summary: string; open: boolean; onToggle: () => void; tone?: 'warning'; prose?: boolean; children: ReactNode;
}) {
  return (
    <View style={[styles.disclosure, tone === 'warning' && styles.disclosureWarning]}>
      <Pressable
        style={({ pressed }) => [styles.disclosureHeader, pressed && styles.pressed]}
        onPress={onToggle}
        android_ripple={{ color: '#EFE9DF' }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${summary}`}
        accessibilityHint={open ? 'Hides these details' : 'Shows these details'}
      >
        <View style={styles.flex}>
          <Text style={[styles.disclosureTitle, tone === 'warning' && styles.disclosureTitleWarning]}>{title}</Text>
          <Text style={styles.metaLine}>{summary}</Text>
        </View>
        <Toggle open={open} />
      </Pressable>
      {open ? <View style={prose ? styles.disclosureProseBody : styles.disclosureBody}>{children}</View> : null}
    </View>
  );
}

/** One financial record as its own small card: reference and billed amount first, then status and balance. */
function RecordRow({ target }: { target: FinancialTarget }) {
  const quantity = target.quantity != null ? `${formatQuantity(target.quantity)} ${target.unitSymbol ?? ''}`.trim() : null;
  const balance = target.overpaidUsd > 0
    ? { label: 'Overpaid', value: target.overpaidUsd }
    : target.remainingUsd > 0 ? { label: 'Outstanding', value: target.remainingUsd } : null;
  return (
    <View
      style={styles.recordCard}
      accessibilityRole="text"
      accessibilityLabel={`${target.reference}, ${target.recordDate.slice(0, 10)}${target.itemName ? `, ${target.itemName}` : ''}${quantity ? `, ${quantity}` : ''}. Billed ${formatMoney(target.totalUsd)}, paid ${formatMoney(target.paidUsd)}${balance ? `, ${balance.label.toLowerCase()} ${formatMoney(balance.value)}` : ''}. Status ${target.status}. ${plural(target.payments.length, 'payment event')}.`}
    >
      <View style={styles.recordTopRow}>
        <View style={styles.flex}>
          <Text style={styles.rowTitle}>{target.reference}</Text>
          <Text style={styles.metaLine}>{target.recordDate.slice(0, 10)}{target.itemName ? ` · ${target.itemName}` : ''}</Text>
          {quantity ? <Text style={styles.quantityInline}>{quantity}</Text> : null}
        </View>
        <View style={styles.recordRight}>
          <Text style={styles.recordMoney}>{formatMoney(target.totalUsd)}</Text>
          <Text style={styles.metaLine}>billed</Text>
        </View>
      </View>
      <View style={styles.recordBottomRow}>
        <StatusPill status={target.status} />
        <Text style={styles.metaLine}>Paid {formatMoney(target.paidUsd)} of {formatMoney(target.totalUsd)}</Text>
      </View>
      {balance ? <Text style={styles.recordBalance}>{balance.label} {formatMoney(balance.value)}</Text> : null}
    </View>
  );
}

function PaymentRow({ target, payment }: { target: FinancialTarget; payment: PaymentEntry }) {
  const cancelled = payment.status === 'Cancelled';
  return (
    <View
      style={[styles.recordCard, cancelled && styles.recordCardCancelled]}
      accessibilityRole="text"
      accessibilityLabel={`${formatMoney(payment.amountUsd)} on ${payment.paymentDate} against ${target.reference}. ${cancelled ? 'Cancelled, and not counted in any total.' : 'Active.'}${cancelled && payment.cancellationReason ? ` Reason: ${payment.cancellationReason}.` : ''}`}
    >
      <View style={styles.recordTopRow}>
        <View style={styles.flex}>
          <Text style={[styles.recordMoney, cancelled && styles.strikethrough]}>{formatMoney(payment.amountUsd)}</Text>
          <Text style={styles.metaLine}>{payment.paymentDate} · {target.reference}</Text>
        </View>
        <StatusPill status={cancelled ? 'Cancelled' : 'Active'} label={payment.status} />
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
 * DEC-405. One supplier per separated card. Closed, it reads as the supplier's name with its billed,
 * paid and outstanding figures in one line; opened (+), it shows the three money boxes, the materials,
 * and the delivery records behind their own + / ×.
 */
function SupplierCard({ group, records, open, onToggle, recordsOpen, onToggleRecords }: {
  group: ReturnType<typeof groupSupplierTargets>[number];
  records: FinancialTarget[]; open: boolean; onToggle: () => void; recordsOpen: boolean; onToggleRecords: () => void;
}) {
  const owed = group.outstanding > 0;
  const label = `${group.supplier}. Billed ${formatMoney(group.billed)}. Paid ${formatMoney(group.paid)}. `
    + `${owed ? `Outstanding ${formatMoney(group.outstanding)}` : 'Nothing outstanding'}.`
    + `${group.overpaid > 0 ? ` Overpaid ${formatMoney(group.overpaid)}.` : ''}`
    + ` ${plural(group.deliveries, 'delivery', 'deliveries')}, ${plural(group.materials.length, 'material')}.`;
  return (
    <View style={styles.supplierCard}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.supplierHeader, pressed && styles.pressed]}
        android_ripple={{ color: '#EFE9DF' }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        accessibilityHint={open ? 'Hides this supplier' : 'Shows this supplier\'s totals, materials and records'}
      >
        <View style={styles.flex}>
          <Text style={styles.supplierName}>{group.supplier}</Text>
          <Text style={styles.metaLine}>{plural(group.deliveries, 'delivery', 'deliveries')} · {plural(group.materials.length, 'material')}</Text>
        </View>
        <View style={styles.sectionHeadline}>
          <Text style={styles.sectionHeadlineLabel}>{owed ? 'Outstanding' : 'Settled'}</Text>
          <Text style={[styles.supplierOwed, !owed && styles.supplierSettled]}>{formatMoney(group.outstanding)}</Text>
        </View>
        <Toggle open={open} />
      </Pressable>

      {open ? (
        <View style={styles.supplierBody}>
          <View style={styles.tileRowWrap}>
            <MoneyTile role="billed" label="Billed" value={group.billed} compact accessibilityLabel={`Billed by ${group.supplier}, ${formatMoney(group.billed)}`} />
            <MoneyTile role="paid" label="Paid" value={group.paid} compact accessibilityLabel={`Paid to ${group.supplier}, ${formatMoney(group.paid)}`} />
            <MoneyTile role="outstanding" label="Outstanding" value={group.outstanding} compact accessibilityLabel={`Outstanding to ${group.supplier}, ${formatMoney(group.outstanding)}`} />
          </View>
          {group.overpaid > 0 ? (
            <MoneyTile role="overpaid" label="Overpaid" value={group.overpaid} wide note="payments recorded exceed what this supplier billed" accessibilityLabel={`Overpaid ${formatMoney(group.overpaid)}. Payments recorded come to more than this supplier billed.`} />
          ) : null}

          <Text style={styles.subhead}>Materials</Text>
          <View style={styles.materialList}>
            {group.materials.map((material, index) => (
              <View
                key={material.key}
                style={[styles.materialRow, index > 0 && styles.materialRowDivided]}
                accessibilityRole="text"
                accessibilityLabel={`${material.name}: ${formatQuantity(material.quantity)} ${material.unit} delivered across ${plural(material.deliveries, 'trip')}, billed ${formatMoney(material.billed)}.`}
              >
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{material.name}</Text>
                  <Text style={styles.metaLine}>{plural(material.deliveries, 'trip')}</Text>
                </View>
                <View style={styles.recordRight}>
                  <Text style={styles.quantityInline}>{formatQuantity(material.quantity)}&#160;{material.unit}</Text>
                  <Text style={styles.metaLine}>{formatMoney(material.billed)} billed</Text>
                </View>
              </View>
            ))}
          </View>

          <Disclosure
            title="Delivery records"
            summary={plural(records.length, 'delivery record')}
            open={recordsOpen}
            onToggle={onToggleRecords}
          >
            {records.map((target) => <RecordRow key={target.id} target={target} />)}
          </Disclosure>
        </View>
      ) : null}
    </View>
  );
}

/**
 * DEC-482. Paid here counts only amounts applied to this project's records. An account payment left
 * unallocated is attached to no record, so it belongs to no project and appears only in Payments &
 * Balances; that account's total Paid can therefore be higher than any project's Paid.
 */
function PaidScopeNote() {
  return (
    <Text style={styles.scopeNote}>
      Paid here counts only payments applied to this project's records. Unallocated payments belong to no project, so the account's total Paid in Payments & Balances can be higher.
    </Text>
  );
}

function EmptyExpectation({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyExpectation}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.helper}>{body}</Text>
    </View>
  );
}

const CARD_BORDER = '#D9CFBE';
const SOFT_BORDER = '#E3DBCD';
const BODY_TEXT = '#5A6570';

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: '#F7F4EE' },
  helper: { color: BODY_TEXT, fontSize: 13, lineHeight: 19 },
  metaLine: { color: BODY_TEXT, fontSize: 12, lineHeight: 17 },
  scopeNote: { color: BODY_TEXT, fontSize: 12, lineHeight: 17, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: SOFT_BORDER, paddingHorizontal: 11, paddingVertical: 9 },
  footnote: { color: BODY_TEXT, fontSize: 12, lineHeight: 18, padding: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: SOFT_BORDER },
  subheadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  subhead: { color: colors.navy, fontSize: 13, fontWeight: '700', marginTop: 4 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  quantityInline: { color: colors.navy, fontSize: 14, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },

  screenState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  screenStateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, padding: 17, gap: 10 },
  panelTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  errorText: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },
  retryButton: { minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  retryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 24, fontWeight: '800', marginTop: 2 },
  heroIdentityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  heroCustomer: { color: '#D5E4EF', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  heroStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', flexShrink: 0 },
  heroStatusPillCompleted: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  heroStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8FD6B4' },
  heroStatusDotCompleted: { backgroundColor: '#D5E4EF' },
  heroStatusText: { color: '#FFF8ED', fontSize: 12, fontWeight: '700' },
  heroFigures: { flexDirection: 'row', gap: 8 },
  heroFigure: { flex: 1, minWidth: 0, gap: 4, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10 },
  heroFigureLabel: { color: '#D5E4EF', fontSize: 11, fontWeight: '600', lineHeight: 14 },
  heroFigureValue: { color: '#FFF8ED', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },

  readOnlyBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: SOFT_BORDER, paddingHorizontal: 13, paddingVertical: 11 },
  readOnlyMark: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#EEF3F8', alignItems: 'center', justifyContent: 'center' },
  readOnlyMarkText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  readOnlyText: { color: colors.ink, fontSize: 13, fontWeight: '600', flex: 1 },

  toggle: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  toggleOpen: { backgroundColor: colors.navy, borderColor: colors.navy },
  toggleGlyph: { color: colors.navy, fontSize: 22, lineHeight: 24, fontWeight: '500' },
  toggleGlyphOpen: { color: '#FFF8ED' },

  // One bordered card per money direction; the headline figure stays in the header when closed.
  sectionCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden', shadowColor: '#17212B', shadowOpacity: .07, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  sectionHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, paddingVertical: 14 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  sectionPurpose: { color: BODY_TEXT, fontSize: 12, lineHeight: 17, marginTop: 3 },
  sectionHeadline: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '42%' },
  sectionHeadlineLabel: { color: BODY_TEXT, fontSize: 11, fontWeight: '600' },
  sectionHeadlineValue: { color: colors.navy, fontSize: 17, fontWeight: '800', marginTop: 1, fontVariant: ['tabular-nums'] },
  sectionBody: { borderTopWidth: 1, borderTopColor: SOFT_BORDER, backgroundColor: '#FAF8F4', padding: 12, gap: 12 },

  tileRow: { flexDirection: 'row', gap: 10 },
  tileRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, gap: 3, justifyContent: 'center' },
  tileHalf: { flex: 1, minWidth: 0 },
  tileWide: { width: '100%' },
  tileCompact: { flexGrow: 1, flexBasis: 96, paddingHorizontal: 11, paddingVertical: 10 },
  tileBilled: { backgroundColor: '#EEF3F8' },
  tilePaid: { backgroundColor: '#E8F3EC' },
  tileOutstanding: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.navy },
  tileCost: { backgroundColor: '#F6F0E6' },
  tileOverpaid: { backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: colors.warning },
  tileQuantity: { backgroundColor: colors.surface, borderWidth: 1, borderColor: CARD_BORDER, borderStyle: 'dashed' },
  tileLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  tileLabelBilled: { color: colors.navy },
  tileLabelPaid: { color: '#1F6446' },
  tileLabelOutstanding: { color: colors.navy },
  tileLabelCost: { color: '#6E4B1F' },
  tileValue: { color: colors.ink, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileValueCompact: { fontSize: 16 },
  tileValueOutstanding: { fontSize: 24, color: colors.navy },
  tileValueOverpaid: { color: colors.warning },
  tileNote: { color: BODY_TEXT, fontSize: 11, fontWeight: '600' },
  quantityValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  quantityValue: { color: colors.navy, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  quantityUnit: { color: colors.navy, fontSize: 13, fontWeight: '700' },

  statusStripWrap: { gap: 6 },
  statusStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, flexShrink: 0 },
  statusPillSuccess: { backgroundColor: '#E5F3EC' },
  statusPillWarning: { backgroundColor: '#FFF3D8' },
  statusPillDanger: { backgroundColor: '#FCE8E6' },
  statusPillNeutral: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotSuccess: { backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  statusDotDanger: { backgroundColor: colors.danger },
  statusDotNeutral: { backgroundColor: colors.muted },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusTextSuccess: { color: colors.success },
  // Warning text on its tint measures 4.49:1; the deeper brown keeps small text above AA.
  statusTextWarning: { color: '#7A500E' },
  statusTextDanger: { color: colors.danger },
  statusTextNeutral: { color: BODY_TEXT },
  blockEmpty: { color: BODY_TEXT, fontSize: 13, lineHeight: 19, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: SOFT_BORDER, padding: 13 },

  exclusion: { borderWidth: 1, borderColor: SOFT_BORDER, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  exclusionLabel: { color: BODY_TEXT, fontSize: 11, fontWeight: '700' },
  exclusionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },

  disclosure: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: SOFT_BORDER, overflow: 'hidden' },
  disclosureWarning: { borderColor: '#E2C58C', backgroundColor: '#FFFCF4' },
  disclosureHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 10, paddingVertical: 10 },
  disclosureTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  disclosureTitleWarning: { color: '#7A500E' },
  disclosureBody: { borderTopWidth: 1, borderTopColor: SOFT_BORDER, backgroundColor: '#FAF8F4', padding: 10, gap: 8 },
  disclosureProseBody: { borderTopWidth: 1, borderTopColor: SOFT_BORDER, backgroundColor: colors.surface, padding: 14, gap: 10 },

  recordCard: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: SOFT_BORDER, paddingHorizontal: 13, paddingVertical: 12, gap: 8 },
  recordCardCancelled: { backgroundColor: '#FDF6F5', borderColor: '#EFC9C4' },
  recordTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  recordRight: { alignItems: 'flex-end', flexShrink: 0, gap: 1 },
  recordMoney: { color: colors.ink, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  recordBottomRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  recordBalance: { color: '#7A500E', fontSize: 12, fontWeight: '700' },
  strikethrough: { textDecorationLine: 'line-through', color: colors.muted },
  cancelledNote: { color: colors.danger, fontSize: 12, lineHeight: 17 },

  cardStack: { gap: 10 },
  supplierCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
  supplierHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 10, paddingVertical: 12 },
  supplierName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  supplierOwed: { color: colors.navy, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  supplierSettled: { color: '#1F6446' },
  supplierBody: { borderTopWidth: 1, borderTopColor: SOFT_BORDER, backgroundColor: '#FAF8F4', padding: 10, gap: 10 },
  materialList: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: SOFT_BORDER, overflow: 'hidden' },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 11 },
  materialRowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },

  uncostedBlock: { borderWidth: 1, borderColor: CARD_BORDER, borderStyle: 'dashed', borderRadius: 12, padding: 13, gap: 10, backgroundColor: colors.surface },
  uncostedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 10 },

  emptyProject: { borderWidth: 1, borderColor: CARD_BORDER, borderStyle: 'dashed', borderRadius: 16, padding: 17, gap: 10, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  emptyList: { gap: 12, marginTop: 2 },
  emptyExpectation: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
