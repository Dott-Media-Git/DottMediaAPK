import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DMCard } from '@components/DMCard';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useAssistant } from '@context/AssistantContext';
import { addKnowledgeDocument, addKnowledgeUrl } from '@services/knowledgeBase';
import { useI18n } from '@context/I18nContext';

export const ControlsScreen: React.FC = () => {
  const { state, toggleCRM, updateCRMPrompt } = useAuth();
  const { enabled: assistantEnabled, toggleAssistant } = useAssistant();
  const { t } = useI18n();
  const crmData = state.crmData;
  const [prompt, setPrompt] = useState(crmData?.crmPrompt ?? '');
  const [assistantSwitchLoading, setAssistantSwitchLoading] = useState(false);
  const [goal, setGoal] = useState('Scale AI CRM demos to 20/mo');
  const [budget, setBudget] = useState(crmData?.businessGoals ?? '$2k - $5k');
  const [widgetSecret, setWidgetSecret] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');

  const handleAssistantToggle = async (value: boolean) => {
    setAssistantSwitchLoading(true);
    try {
      await toggleAssistant(value);
    } finally {
      setAssistantSwitchLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.badge}>{t('Orchestration')}</Text>
        <Text style={styles.title}>{t('Automation controls')}</Text>
        <Text style={styles.subtitle}>
          {t('Mirrors the gradient-heavy control panels on dott-media.com while letting you toggle AI infrastructure.')}
        </Text>
      </LinearGradient>
      <DMCard title={t('CRM status')} subtitle={t('Flip your Make.com stack on or off')}>
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{crmData?.isActive ? t('Active') : t('Paused')}</Text>
          <Switch
            value={crmData?.isActive ?? false}
            onValueChange={toggleCRM}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accentSecondary }}
          />
        </View>
      </DMCard>
      <DMCard title={t('AI prompt')} subtitle={t('Guide the assistant and campaign copy')}>
        <DMTextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={t('Outline what the CRM should focus on this week.')}
        />
        <DMButton title={t('Update prompt')} onPress={() => updateCRMPrompt(prompt)} loading={state.loading} />
      </DMCard>
      <DMCard title={t('Assistant overlay')} subtitle={t('Floating guidance across the app')}>
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{assistantEnabled ? t('Assistant On') : t('Assistant Off')}</Text>
          <Switch
            value={assistantEnabled}
            onValueChange={handleAssistantToggle}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accent }}
            disabled={assistantSwitchLoading}
          />
        </View>
        <Text style={styles.infoText}>{t('Tap the glowing orb to chat about metrics anywhere.')}</Text>
      </DMCard>
      <DMCard title={t('Business info')} subtitle={t('Data synced across your automations')}>
        <Text style={styles.infoText}>{t('Company: {{value}}', { value: crmData?.companyName ?? t('Not set') })}</Text>
        <Text style={styles.infoText}>{t('Primary email: {{value}}', { value: crmData?.email ?? t('Not set') })}</Text>
        <Text style={styles.infoText}>{t('Phone: {{value}}', { value: crmData?.phone ?? t('Not set') })}</Text>
        <Text style={styles.infoText}>{t('Instagram: {{value}}', { value: crmData?.instagram ?? t('Not linked') })}</Text>
        <Text style={styles.infoText}>{t('Facebook: {{value}}', { value: crmData?.facebook ?? t('Not linked') })}</Text>
        <Text style={styles.infoText}>{t('LinkedIn: {{value}}', { value: crmData?.linkedin ?? t('Not linked') })}</Text>
      </DMCard>
      <DMCard title={t('Lead Agent Config')} subtitle={t('Goals, budget, and widget secret for agentSetup')}>
        <DMTextInput
          label={t('North Star Goal')}
          value={goal}
          onChangeText={setGoal}
          placeholder={t('e.g., 30 demos booked')}
        />
        <DMTextInput
          label={t('Budget Range')}
          value={budget}
          onChangeText={setBudget}
          placeholder="$2k - $5k"
        />
        <DMTextInput
          label={t('Widget Secret')}
          value={widgetSecret}
          onChangeText={setWidgetSecret}
          placeholder={t('Matches WIDGET_SHARED_SECRET')}
        />
        <DMButton
          title={t('Save agent config')}
          onPress={() => {
            Alert.alert(t('Preferences saved'), t('Updated goals shared with the lead agent.'));
          }}
        />
      </DMCard>
      <DMCard title={t('Automation Knowledge Base')} subtitle={t('Teach Dotti using URLs or inline notes')}>
        <DMTextInput
          label={t('Reference URL')}
          value={resourceUrl}
          onChangeText={setResourceUrl}
          placeholder="https://dott-media.com/services"
        />
        <DMButton
          title={t('Add URL')}
          onPress={async () => {
            try {
              await addKnowledgeUrl(resourceUrl);
              Alert.alert(t('Knowledge updated'), t('URL ingested successfully.'));
              setResourceUrl('');
            } catch (error) {
              Alert.alert(t('Failed to add URL'), (error as Error).message);
            }
          }}
        />
        <View style={{ height: 12 }} />
        <DMTextInput
          label={t('Document title')}
          value={docTitle}
          onChangeText={setDocTitle}
          placeholder={t('Case study summary')}
        />
        <DMTextInput
          label={t('Document text')}
          value={docContent}
          onChangeText={setDocContent}
          placeholder={t('Paste notes or transcript...')}
          multiline
        />
        <DMButton
          title={t('Add document')}
          onPress={async () => {
            try {
              await addKnowledgeDocument(docTitle, docContent);
              Alert.alert(t('Knowledge updated'), t('Document added successfully.'));
              setDocTitle('');
              setDocContent('');
            } catch (error) {
              Alert.alert(t('Failed to add document'), (error as Error).message);
            }
          }}
        />
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
    padding: 20,
    paddingBottom: 40
  },
  hero: {
    borderRadius: 30,
    padding: 22,
    marginBottom: 18
  },
  badge: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 6
  },
  subtitle: {
    color: colors.background,
    opacity: 0.9,
    lineHeight: 20
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statusLabel: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 18
  },
  infoText: {
    color: colors.subtext,
    marginBottom: 6,
    marginTop: 8
  }
});
