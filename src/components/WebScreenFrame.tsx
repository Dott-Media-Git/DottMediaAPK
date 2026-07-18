import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { colors } from '@constants/colors';

type Props = {
  children: React.ReactNode;
};

/**
 * Shared workspace boundary for every drawer route. Mobile screens keep their
 * existing behaviour; web receives a deliberate desktop canvas instead of a
 * phone layout stretched across the browser.
 */
export const WebScreenFrame: React.FC<Props> = ({ children }) => (
  <View style={styles.scene}>
    <View style={styles.canvas}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { paddingHorizontal: 18 } : null),
  },
  canvas: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    maxWidth: 1360,
    alignSelf: 'center',
    backgroundColor: colors.background,
  },
});


