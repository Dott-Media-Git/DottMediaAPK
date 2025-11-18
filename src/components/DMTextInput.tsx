import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors } from '@constants/colors';

type DMTextInputProps = TextInputProps & {
  label?: string;
  helperText?: string;
  error?: string;
};

export const DMTextInput: React.FC<DMTextInputProps> = ({ label, helperText, error, style, ...rest }) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputWrapper,
          focused && styles.inputWrapperFocused,
          error && styles.inputWrapperError
        ]}
      >
        <TextInput
          placeholderTextColor={colors.subtext}
          style={[styles.input, style]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16
  },
  label: {
    color: colors.subtext,
    marginBottom: 6,
    fontWeight: '600'
  },
  inputWrapper: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardOverlay
  },
  inputWrapperFocused: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }
  },
  inputWrapperError: {
    borderColor: colors.danger
  },
  input: {
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    fontSize: 16
  },
  helper: {
    color: colors.subtext,
    marginTop: 6
  },
  error: {
    color: colors.danger,
    marginTop: 6
  }
});
