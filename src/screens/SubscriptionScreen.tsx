import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { DMTextInput } from '@components/DMTextInput';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import {
  BillingOverview,
  FinancialAllocation,
  BillingPlan,
  fetchBillingOverview,
  fetchFinancialLedger,
  fetchBillingPlans,
  startPlanCheckout,
} from '@services/billing';

const formatPrice = (cents: number | null) => {
  if (cents === null) return 'Custom';
  if (cents === 0) return '$0';
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: cents % 100 ? 2 : 0 })}/mo`;
};

const usageKeys = [
  ['aiReplies', 'AI replies'],
  ['images', 'Images'],
  ['basicVideos', 'Basic videos'],
  ['proVideos', 'Pro videos'],
  ['scheduledPosts', 'Scheduled posts'],
] as const;

const formatCents = (cents = 0, currency = 'usd') =>
  `${currency.toUpperCase()} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const fallbackPlans: BillingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Strict trial plan with limited AI and no video generation.',
    priceMonthlyCents: 0,
    stripeConfigured: true,
    limits: { aiReplies: 10, images: 1, basicVideos: 0, proVideos: 0, scheduledPosts: 5 },
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'Entry plan for creators and small teams.',
    priceMonthlyCents: 2000,
    stripeConfigured: false,
    limits: { aiReplies: 500, images: 25, basicVideos: 2, proVideos: 0, scheduledPosts: 100 },
  },
  {
    id: 'creator',
    name: 'Creator',
    description: 'Main creator plan with meaningful AI and media capacity.',
    priceMonthlyCents: 4900,
    stripeConfigured: false,
    limits: { aiReplies: 2000, images: 100, basicVideos: 10, proVideos: 0, scheduledPosts: 500 },
  },
  {
    id: 'business',
    name: 'Business',
    description: 'For active brands needing higher posting and content capacity.',
    priceMonthlyCents: 9900,
    stripeConfigured: false,
    limits: { aiReplies: 5000, images: 300, basicVideos: 20, proVideos: 0, scheduledPosts: 1500 },
  },
  {
    id: 'agency',
    name: 'Agency',
    description: 'High-volume plan for agencies managing multiple brands.',
    priceMonthlyCents: 39900,
    stripeConfigured: false,
    limits: { aiReplies: 15000, images: 1000, basicVideos: 50, proVideos: 10, scheduledPosts: 5000 },
  },
];

export const SubscriptionScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [plans, setPlans] = useState<BillingPlan[]>(fallbackPlans);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [allocations, setAllocations] = useState<FinancialAllocation[]>([]);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'flutterwave_mobile_money'>('stripe');
  const [mobileMoneyPhone, setMobileMoneyPhone] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.allSettled([fetchBillingPlans(), fetchBillingOverview(), fetchFinancialLedger()]).then(results => {
      if (!active) return;
      const [plansResult, overviewResult, ledgerResult] = results;
      if (plansResult.status === 'fulfilled' && plansResult.value.length) setPlans(plansResult.value);
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
      if (ledgerResult.status === 'fulfilled') setAllocations(ledgerResult.value);
    });
    return () => {
      active = false;
    };
  }, []);

  const currentPlanId = useMemo(() => overview?.plan?.id ?? (state.subscriptionStatus === 'active' ? 'creator' : 'free'), [
    overview?.plan?.id,
    state.subscriptionStatus,
  ]);

  const handleCheckout = async (plan: BillingPlan) => {
    if (plan.id === currentPlanId) {
      Alert.alert(t('Current plan'), t('You are already on this plan.'));
      return;
    }
    if (plan.id === 'free') {
      Alert.alert(t('Free plan'), t('Your free plan is active by default.'));
      return;
    }
    if (plan.id === 'enterprise' || plan.priceMonthlyCents === null) {
      Alert.alert(t('Enterprise'), t('Contact Dott Media for a custom contract.'));
      return;
    }
    const usingMobileMoney = paymentMethod === 'flutterwave_mobile_money';
    if (usingMobileMoney && !plan.mobileMoneyConfigured) {
      Alert.alert(t('Checkout not configured'), t('Mobile money is not configured yet.'));
      return;
    }
    if (!usingMobileMoney && !plan.stripeConfigured) {
      Alert.alert(t('Checkout not configured'), t('Stripe price IDs must be added before this plan can accept payment.'));
      return;
    }
    if (usingMobileMoney && !mobileMoneyPhone.trim()) {
      Alert.alert(t('Phone number required'), t('Enter the mobile money phone number before checkout.'));
      return;
    }
    setLoadingPlan(plan.id);
    try {
      const session = await startPlanCheckout(plan.id, {
        provider: paymentMethod,
        phoneNumber: usingMobileMoney ? mobileMoneyPhone.trim() : undefined,
      });
      if (!session.checkoutUrl) throw new Error('Checkout URL was not returned');
      if (typeof window !== 'undefined') {
        window.location.assign(session.checkoutUrl);
      } else {
        await Linking.openURL(session.checkoutUrl);
      }
    } catch (error: any) {
      Alert.alert(t('Checkout failed'), error?.message ?? t('Please try again.'));
    } finally {
      setLoadingPlan(null);
    }
  };

  const renderLimit = (plan: BillingPlan, key: string, label: string) => {
    const value = plan.limits?.[key];
    const display = value === null ? 'Custom' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? 0);
    return (
      <View key={key} style={styles.limitRow}>
        <Text style={styles.limitLabel}>{t(label)}</Text>
        <Text style={styles.limitValue}>{display}</Text>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.badge}>{t('Packages')}</Text>
        <Text style={styles.title}>{t('Dott Media Packaging')}</Text>
        <Text style={styles.subtitle}>
          {t('Choose a plan with clear AI, image, video, posting, and automation limits. Heavy media usage is handled with credits.')}
        </Text>
      </LinearGradient>

      <DMCard title={t('Payment method')} subtitle={t('Choose how you want to pay for your package.')}>
        <View style={styles.paymentMethodRow}>
          <TouchableOpacity
            style={[styles.paymentMethodOption, paymentMethod === 'stripe' && styles.paymentMethodOptionActive]}
            onPress={() => setPaymentMethod('stripe')}
            activeOpacity={0.85}
          >
            <Text style={styles.paymentMethodTitle}>{t('Card')}</Text>
            <Text style={styles.paymentMethodSubtitle}>{t('Stripe checkout')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentMethodOption, paymentMethod === 'flutterwave_mobile_money' && styles.paymentMethodOptionActive]}
            onPress={() => setPaymentMethod('flutterwave_mobile_money')}
            activeOpacity={0.85}
          >
            <Text style={styles.paymentMethodTitle}>{t('Mobile money')}</Text>
            <Text style={styles.paymentMethodSubtitle}>{t('MTN or Airtel')}</Text>
          </TouchableOpacity>
        </View>
        {paymentMethod === 'flutterwave_mobile_money' ? (
          <DMTextInput
            label={t('Mobile money number')}
            value={mobileMoneyPhone}
            onChangeText={setMobileMoneyPhone}
            keyboardType="phone-pad"
            placeholder="+256..."
            helperText={t('Flutterwave will send the mobile money approval prompt.')}
          />
        ) : null}
      </DMCard>

      {overview ? (
        <DMCard title={t('Current usage')} subtitle={t('Monthly limits reset automatically.')}>
          <Text style={styles.currentPlan}>{t('Current plan')}: {overview.plan.name}</Text>
          {usageKeys.map(([key, label]) => {
            const used = overview.usage?.[key] ?? 0;
            const limit = overview.plan.limits?.[key];
            const limitText = limit === null ? 'Custom' : String(limit ?? 0);
            return (
              <View key={key} style={styles.usageRow}>
                <Text style={styles.usageLabel}>{t(label)}</Text>
                <Text style={styles.usageValue}>{used} / {limitText}</Text>
              </View>
            );
          })}
        </DMCard>
      ) : null}

      <View style={styles.planGrid}>
        {plans.filter(plan => plan.id !== 'enterprise').map(plan => (
          <DMCard
            key={plan.id}
            title={t(plan.name)}
            subtitle={t(plan.description)}
            style={styles.planCard}
          >
            <View style={styles.planHeader}>
              <Text style={styles.price}>{formatPrice(plan.priceMonthlyCents)}</Text>
              {plan.id === currentPlanId ? <Text style={styles.currentBadge}>{t('Current')}</Text> : null}
            </View>
            {usageKeys.map(([key, label]) => renderLimit(plan, key, label))}
            <DMButton
              title={
                plan.id === currentPlanId
                  ? t('Current plan')
                  : t(plan.priceMonthlyCents === 0 ? 'Start free' : paymentMethod === 'flutterwave_mobile_money' ? 'Pay mobile money' : 'Pay by card')
              }
              onPress={() => handleCheckout(plan)}
              loading={loadingPlan === plan.id}
              disabled={loadingPlan !== null || plan.id === currentPlanId}
              style={styles.planButton}
            />
            {paymentMethod === 'stripe' && !plan.stripeConfigured && plan.priceMonthlyCents ? (
              <Text style={styles.setupNote}>{t('Stripe price not configured yet.')}</Text>
            ) : null}
            {paymentMethod === 'flutterwave_mobile_money' && !plan.mobileMoneyConfigured && plan.priceMonthlyCents ? (
              <Text style={styles.setupNote}>{t('Mobile money not configured yet.')}</Text>
            ) : null}
          </DMCard>
        ))}
      </View>

      <DMCard title={t('Credit add-ons')} subtitle={t('Use credits after your monthly package allowance is finished.')}>
        <View style={styles.creditRow}>
          <Text style={styles.creditTitle}>{t('Extra basic video')}</Text>
          <Text style={styles.creditPrice}>$2</Text>
        </View>
        <View style={styles.creditRow}>
          <Text style={styles.creditTitle}>{t('Extra 1080p pro video')}</Text>
          <Text style={styles.creditPrice}>$10-$15</Text>
        </View>
        <View style={styles.creditRow}>
          <Text style={styles.creditTitle}>{t('Extra 30 images')}</Text>
          <Text style={styles.creditPrice}>$5</Text>
        </View>
      </DMCard>

      {allocations.length ? (
        <DMCard title={t('Revenue allocation')} subtitle={t('Estimated provider cost reserves and remaining profit from paid invoices.')}>
          {allocations.slice(0, 5).map(allocation => (
            <View key={allocation.id} style={styles.allocationBlock}>
              <Text style={styles.allocationTitle}>{allocation.planName}</Text>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>{t('Revenue')}</Text>
                <Text style={styles.usageValue}>{formatCents(allocation.grossRevenueCents, allocation.currency)}</Text>
              </View>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>{t('Provider reserve')}</Text>
                <Text style={styles.usageValue}>{formatCents(allocation.directCostReserveCents, allocation.currency)}</Text>
              </View>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>{t('Operations reserve')}</Text>
                <Text style={styles.usageValue}>{formatCents(allocation.operatingReserveCents, allocation.currency)}</Text>
              </View>
              <View style={styles.usageRow}>
                <Text style={styles.usageLabel}>{t('Estimated net profit')}</Text>
                <Text style={styles.usageValue}>{formatCents(allocation.netProfitCents, allocation.currency)}</Text>
              </View>
            </View>
          ))}
        </DMCard>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: 24
  },
  hero: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 20
  },
  badge: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 6
  },
  subtitle: {
    color: colors.background,
    opacity: 0.9,
    lineHeight: 20
  },
  currentPlan: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 12
  },
  paymentMethodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14
  },
  paymentMethodOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.cardOverlay
  },
  paymentMethodOptionActive: {
    borderColor: colors.accent
  },
  paymentMethodTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 3
  },
  paymentMethodSubtitle: {
    color: colors.subtext,
    fontSize: 12
  },
  usageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  usageLabel: {
    color: colors.subtext
  },
  usageValue: {
    color: colors.text,
    fontWeight: '700'
  },
  planGrid: {
    gap: 16
  },
  planCard: {
    marginBottom: 0
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14
  },
  price: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900'
  },
  currentBadge: {
    color: colors.background,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '800'
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  limitLabel: {
    color: colors.subtext
  },
  limitValue: {
    color: colors.text,
    fontWeight: '700'
  },
  planButton: {
    marginTop: 12
  },
  setupNote: {
    color: colors.accentMuted,
    fontSize: 12,
    marginTop: 10
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  creditTitle: {
    color: colors.text,
    fontWeight: '700'
  },
  creditPrice: {
    color: colors.accent,
    fontWeight: '900'
  },
  allocationBlock: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  allocationTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 8
  }
});
