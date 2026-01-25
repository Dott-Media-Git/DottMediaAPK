import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

export const SetupFormScreen: React.FC = () => {
  const { submitCRMSetup, state } = useAuth();
  const { t } = useI18n();
  const [form, setForm] = useState({
    companyName: '',
    email: '',
    phone: '',
    instagram: '',
    facebook: '',
    linkedin: '',
    targetAudience: '',
    businessGoals: '',
    crmPrompt: ''
  });

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    await submitCRMSetup({
      companyName: form.companyName,
      email: form.email,
      phone: form.phone,
      instagram: form.instagram,
      facebook: form.facebook,
      linkedin: form.linkedin,
      targetAudience: form.targetAudience,
      businessGoals: form.businessGoals,
      crmPrompt: form.crmPrompt
    });
  };

  return (
    <ScrollView style={styles.wrapper} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('Set up your CRM')}</Text>
      <Text style={styles.subtitle}>
        {t(
          'Tell us about your business so we can configure the automation blueprint with the same curated feel from dott-media.com.'
        )}
      </Text>
      <DMTextInput
        label={t('Company name')}
        value={form.companyName}
        onChangeText={text => handleChange('companyName', text)}
      />
      <DMTextInput
        label={t('Primary email')}
        value={form.email}
        onChangeText={text => handleChange('email', text)}
        autoCapitalize="none"
      />
      <DMTextInput
        label={t('Phone number')}
        value={form.phone}
        onChangeText={text => handleChange('phone', text)}
        keyboardType="phone-pad"
      />
      <DMTextInput
        label={t('Instagram')}
        value={form.instagram}
        onChangeText={text => handleChange('instagram', text)}
        placeholder="https://instagram.com/yourbrand"
      />
      <DMTextInput
        label={t('Facebook')}
        value={form.facebook}
        onChangeText={text => handleChange('facebook', text)}
        placeholder="https://facebook.com/yourbrand"
      />
      <DMTextInput
        label={t('LinkedIn')}
        value={form.linkedin}
        onChangeText={text => handleChange('linkedin', text)}
        placeholder="https://linkedin.com/company/yourbrand"
      />
      <DMTextInput
        label={t('Target audience')}
        value={form.targetAudience}
        onChangeText={text => handleChange('targetAudience', text)}
        multiline
      />
      <DMTextInput
        label={t('Business goals')}
        value={form.businessGoals}
        onChangeText={text => handleChange('businessGoals', text)}
        multiline
      />
      <DMTextInput
        label={t('CRM prompt')}
        value={form.crmPrompt}
        onChangeText={text => handleChange('crmPrompt', text)}
        multiline
        helperText={t('Describe what the AI assistant should focus on.')}
      />
      <DMButton title={t('Submit configuration')} onPress={handleSubmit} loading={state.loading} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: colors.background
  },
  container: {
    padding: 24,
    paddingBottom: 80
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8
  },
  subtitle: {
    color: colors.subtext,
    marginBottom: 24
  }
});
