import React from 'react';
import { StyleSheet, Text, View, ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@constants/colors';

type DMCardProps = ViewProps & {
  title?: string;
  subtitle?: string;
};

export const DMCard: React.FC<DMCardProps> = ({ title, subtitle, style, children, ...rest }) => (
  <LinearGradient
    colors={[colors.cardBorderStart, colors.cardBorderEnd]}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[styles.gradient, style]}
    {...rest}
  >
    <View style={styles.cardContent}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  </LinearGradient>
);

const styles = StyleSheet.create({
  gradient: {
    borderRadius: 24,
    padding: 1,
    marginVertical: 8
  },
  cardContent: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: colors.card
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 8
  },
  subtitle: {
    color: colors.subtext,
    fontSize: 14,
    marginBottom: 12
  }
});
