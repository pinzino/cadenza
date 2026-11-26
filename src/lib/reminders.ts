import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type ReminderBlock = {
  task_id: string;
  title: string;
  block_date: string;
  start_time: string;
  reminder_enabled: boolean;
  reminder_minutes: number;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function dateForBlock(block: ReminderBlock) {
  return new Date(`${block.block_date}T${block.start_time}`);
}

export async function schedulePlanReminders(blocks: ReminderBlock[]) {
  if (Platform.OS === 'web') return { scheduled: 0, available: false };

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return { scheduled: 0, available: false };

  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  const upcoming = blocks
    .filter((block) => block.reminder_enabled)
    .map((block) => ({ block, reminderAt: new Date(dateForBlock(block).getTime() - block.reminder_minutes * 60 * 1000) }))
    .filter(({ reminderAt }) => reminderAt.getTime() > now)
    .sort((first, second) => first.reminderAt.getTime() - second.reminderAt.getTime())
    .slice(0, 120);

  await Promise.all(upcoming.map(({ block, reminderAt }) => Notifications.scheduleNotificationAsync({
    content: {
      title: block.reminder_minutes ? `Tra ${block.reminder_minutes} minuti: ${block.title}` : `Ora: ${block.title}`,
      body: 'Apri Cadenza per vedere il tuo piano.',
      data: { taskId: block.task_id, url: '/index' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderAt,
    },
  })));

  return { scheduled: upcoming.length, available: true };
}
