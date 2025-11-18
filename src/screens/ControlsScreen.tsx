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

export const ControlsScreen: React.FC = () => {
  const { state, toggleCRM, updateCRMPrompt } = useAuth();
  const { enabled: assistantEnabled, toggleAssistant } = useAssistant();
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
        <Text style={styles.badge}>Orchestration</Text>
        <Text style={styles.title}>Automation controls</Text>
        <Text style={styles.subtitle}>
          Mirrors the gradient-heavy control panels on dott-media.com while letting you toggle AI infrastructure.
        </Text>
      </LinearGradient>
      <DMCard title="CRM status" subtitle="Flip your Make.com stack on or off">
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{crmData?.isActive ? 'Active' : 'Paused'}</Text>
          <Switch
            value={crmData?.isActive ?? false}
            onValueChange={toggleCRM}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accentSecondary }}
          />
        </View>
      </DMCard>
      <DMCard title="AI prompt" subtitle="Guide the assistant and campaign copy">
        <DMTextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder="Outline what the CRM should focus on this week."
        />
        <DMButton title="Update prompt" onPress={() => updateCRMPrompt(prompt)} loading={state.loading} />
      </DMCard>
      <DMCard title="Assistant overlay" subtitle="Floating guidance across the app">
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{assistantEnabled ? 'Assistant On' : 'Assistant Off'}</Text>
          <Switch
            value={assistantEnabled}
            onValueChange={handleAssistantToggle}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accent }}
            disabled={assistantSwitchLoading}
          />
        </View>
        <Text style={styles.infoText}>Tap the glowing orb to chat about metrics anywhere.</Text>
      </DMCard>
      <DMCard title="Business info" subtitle="Data synced across your automations">
        <Text style={styles.infoText}>Company: {crmData?.companyName ?? 'Not set'}</Text>
        <Text style={styles.infoText}>Primary email: {crmData?.email ?? 'Not set'}</Text>
        <Text style={styles.infoText}>Phone: {crmData?.phone ?? 'Not set'}</Text>
        <Text style={styles.infoText}>Instagram: {crmData?.instagram ?? 'Not linked'}</Text>
        <Text style={styles.infoText}>Facebook: {crmData?.facebook ?? 'Not linked'}</Text>
        <Text style={styles.infoText}>LinkedIn: {crmData?.linkedin ?? 'Not linked'}</Text>
      </DMCard>
      <DMCard title="Lead Agent Config" subtitle="Goals, budget, and widget secret for agentSetup">
        <DMTextInput label="North Star Goal" value={goal} onChangeText={setGoal} placeholder="e.g., 30 demos booked" />
        <DMTextInput label="Budget Range" value={budget} onChangeText={setBudget} placeholder="$2k - $5k" />
        <DMTextInput
          label="Widget Secret"
          value={widgetSecret}
          onChangeText={setWidgetSecret}
          placeholder="Matches WIDGET_SHARED_SECRET"
        />
        <DMButton
          title="Save agent config"
          onPress={() => {
            Alert.alert('Preferences saved', 'Updated goals shared with the lead agent.');
          }}
        />
      </DMCard>
      <DMCard title="Automation Knowledge Base" subtitle="Teach Dotti using URLs or inline notes">
        <DMTextInput
          label="Reference URL"
          value={resourceUrl}
          onChangeText={setResourceUrl}
          placeholder="https://dott-media.com/services"
        />
        <DMButton
          title="Add URL"
          onPress={async () => {
            try {
              await addKnowledgeUrl(resourceUrl);
              Alert.alert('Knowledge updated', 'URL ingested successfully.');
              setResourceUrl('');
            } catch (error) {
              Alert.alert('Failed to add URL', (error as Error).message);
            }
          }}
        />
        <View style={{ height: 12 }} />
        <DMTextInput label="Document title" value={docTitle} onChangeText={setDocTitle} placeholder="Case study summary" />
        <DMTextInput
          label="Document text"
          value={docContent}
          onChangeText={setDocContent}
          placeholder="Paste notes or transcript..."
          multiline
        />
        <DMButton
          title="Add document"
          onPress={async () => {
            try {
              await addKnowledgeDocument(docTitle, docContent);
              Alert.alert('Knowledge updated', 'Document added successfully.');
              setDocTitle('');
              setDocContent('');
            } catch (error) {
              Alert.alert('Failed to add document', (error as Error).message);
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
