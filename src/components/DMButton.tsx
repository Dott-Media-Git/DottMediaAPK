import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@constants/colors';

type DMButtonProps = {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
};

export const DMButton: React.FC<DMButtonProps> = ({ title, onPress, style, disabled, loading }) => {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[styles.touchable, isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
    >
      <LinearGradient
        colors={[colors.accent, colors.accentSecondary]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.gradient}
      >
        {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.label}>{title}</Text>}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  touchable: {
    borderRadius: 18,
    overflow: 'hidden'
  },
  gradient: {
    paddingVertical: 16,
    alignItems: 'center'
  },
  disabled: {
    opacity: 0.65
  },
  label: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.2
  }
});
