import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

const features = [
  'Custom Make.com scenarios provisioned automatically',
  'Analytics dashboard with live CRM data',
  'Priority WhatsApp support'
];

const paymentOptions = [
  {
    label: 'Stripe (Card, Apple Pay)',
    description: 'Instant activation via Visa, Mastercard, Apple Pay, Google Pay.'
  },
  {
    label: 'PayPal Business',
    description: 'Use your PayPal balance or linked bank account.'
  },
  {
    label: 'Wire Transfer (USD)',
    description: 'ACH/SWIFT instructions delivered to your inbox the moment you choose this option.'
  }
];

export const SubscriptionScreen: React.FC = () => {
  const { startSubscription, state } = useAuth();
  const { t } = useI18n();

  const handleAlternatePayment = (method: string) => {
    Alert.alert(method, t('A Dott Media success manager will send the instructions right away.'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.badge}>{t('Activate')}</Text>
        <Text style={styles.title}>{t('Dott Media Automation Suite')}</Text>
        <Text style={styles.subtitle}>{t('Premium gradients, realtime telemetry, and fully managed AI pipelines.')}</Text>
      </LinearGradient>
      <DMCard title={t('Plan details')} subtitle={t('Everything you need to launch AI-driven campaigns.')}>
        {features.map(feature => (
          <View key={feature} style={styles.feature}>
            <Text style={styles.bullet}>-</Text>
            <Text style={styles.featureText}>{t(feature)}</Text>
          </View>
        ))}
        <View style={styles.priceBlock}>
          <Text style={styles.pricePrimary}>{t('$199 / month')}</Text>
          <Text style={styles.priceSecondary}>{t('$1000 one-time installation')}</Text>
        </View>
        <DMButton title={t('Activate via Care Team')} onPress={startSubscription} loading={state.loading} />
      </DMCard>
      <DMCard title={t('Payment options')} subtitle={t('Choose the method that suits your finance stack.')}>
        {paymentOptions.map(option => (
          <View key={option.label} style={styles.paymentRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentLabel}>{t(option.label)}</Text>
              <Text style={styles.paymentDescription}>{t(option.description)}</Text>
            </View>
            <DMButton
              title={t('Select')}
              style={styles.paymentButton}
              onPress={() => handleAlternatePayment(t(option.label))}
            />
          </View>
        ))}
        <Text style={styles.helpText}>
          {t('All transactions are denominated in USD. Need a custom invoice? Tap any option above.')}
        </Text>
      </DMCard>
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
    borderRadius: 32,
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
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10
  },
  bullet: {
    color: colors.accentMuted,
    marginRight: 8,
    fontSize: 18,
    lineHeight: 18
  },
  featureText: {
    color: colors.subtext,
    flex: 1
  },
  priceBlock: {
    marginVertical: 16
  },
  pricePrimary: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 24
  },
  priceSecondary: {
    color: colors.accentMuted,
    fontSize: 14,
    marginTop: 6
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  paymentLabel: {
    color: colors.text,
    fontWeight: '700'
  },
  paymentDescription: {
    color: colors.subtext,
    marginTop: 4
  },
  paymentButton: {
    marginLeft: 12,
    minWidth: 110
  },
  helpText: {
    color: colors.subtext,
    marginTop: 12,
    fontSize: 12
  }
});
