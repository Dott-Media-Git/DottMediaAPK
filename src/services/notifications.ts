import * as Notifications from 'expo-notifications';

const ensurePermissions = async () => {
  const settings = await Notifications.getPermissionsAsync();
  if (!settings.granted) {
    await Notifications.requestPermissionsAsync();
  }
};

export const scheduleWelcomeNotification = async (name: string) => {
  try {
    await ensurePermissions();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Welcome to Dott Media CRM',
        body: `Hi ${name}, your AI assistant is ready to build automations.`
      },
      trigger: null
    });
  } catch (error) {
    console.warn('Notification scheduling skipped in mock environment', error);
  }
};

export const notifyLeadAlerts = async (payload: { pendingFollowUps: number; hotLeads: number }) => {
  try {
    if (payload.pendingFollowUps <= 0 && payload.hotLeads <= 0) return;
    await ensurePermissions();
    const notifications: Array<{ title: string; body: string }> = [];
    if (payload.hotLeads > 0) {
      notifications.push({
        title: 'Hot leads waiting',
        body: `${payload.hotLeads} high-intent prospects are ready for next steps.`
      });
    }
    if (payload.pendingFollowUps > 0) {
      notifications.push({
        title: 'Follow-ups pending',
        body: `You still have ${payload.pendingFollowUps} automation follow-ups queued.`
      });
    }
    await Promise.all(
      notifications.map(note =>
        Notifications.scheduleNotificationAsync({
          content: note,
          trigger: null
        })
      )
    );
  } catch (error) {
    console.warn('Lead alert notification skipped', error);
  }
};
