import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryTheme } from 'victory-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { fetchPlans, swapPlan } from '@services/admin/plansService';
import { fetchUsage } from '@services/admin/usageService';

export const PlansUsageScreen: React.FC = () => {
  const { orgId } = useAuth();
  const [plans, setPlans] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);

  useEffect(() => {
    fetchPlans().then(setPlans);
  }, []);

  useEffect(() => {
    if (!orgId) return;
    fetchUsage(orgId).then(setUsage);
  }, [orgId]);

  const changePlan = async (plan: string) => {
    if (!orgId) return;
    try {
      const session = await swapPlan(orgId, plan);
      Alert.alert('Stripe Checkout', session.checkoutUrl ?? 'Session created');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {plans.map(plan => (
        <View key={plan.id} style={styles.planCard}>
          <Text style={styles.planTitle}>{plan.name}</Text>
          <Text style={styles.planPrice}>${plan.price}/mo</Text>
          <Text style={styles.planLimits}>Leads/mo: {plan.limits?.leadsPerMo}</Text>
          <DMButton title="Select" onPress={() => changePlan(plan.name)} />
        </View>
      ))}

      <View style={styles.usageCard}>
        <Text style={styles.sectionTitle}>Usage</Text>
        <VictoryChart theme={VictoryTheme.material} domainPadding={12}>
          <VictoryBar
            data={usage.map(entry => ({ x: entry.date?.slice(-2), y: entry.leads ?? 0 }))}
            style={{ data: { fill: colors.accent } }}
          />
        </VictoryChart>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  planCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    backgroundColor: colors.backgroundAlt,
  },
  planTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  planPrice: { color: colors.accent, fontSize: 20, marginVertical: 6 },
  planLimits: { color: colors.subtext, marginBottom: 12 },
  usageCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    backgroundColor: colors.backgroundAlt,
  },
  sectionTitle: { color: colors.text, fontWeight: '700', marginBottom: 8 },
});
