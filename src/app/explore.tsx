import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildAutomaticPlan, PlannedBlock, PlannerSettings, PlannerTask, TimeWindow } from '@/lib/planner';
import { supabase } from '@/lib/supabase';

type DisplayBlock = PlannedBlock & { id?: string; title: string; priority: string; category: string };

const defaultSettings: PlannerSettings = {
  workWindows: [{ start: '09:00', end: '18:00' }],
  personalWindows: [{ start: '18:00', end: '21:00' }],
  maxBlockMinutes: 60,
  breakMinutes: 15,
};

function formatPlanDate(value: string) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${value}T12:00:00`))
    .replace(/^./, (letter) => letter.toUpperCase());
}

export default function PlanScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlannerSettings>(defaultSettings);
  const [blocks, setBlocks] = useState<DisplayBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPlanner = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    const [tasksResult, settingsResult, blocksResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_time, is_complete'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', currentUserId).maybeSingle(),
      supabase.from('task_blocks').select('id, task_id, block_date, start_time, end_time, duration_minutes, block_index, total_blocks, is_fixed').order('block_date').order('start_time'),
    ]);

    if (tasksResult.error || settingsResult.error || blocksResult.error) {
      setErrorMessage('Completa gli aggiornamenti 002, 003 e 004 in Supabase.');
      setIsLoading(false);
      return;
    }

    const loadedTasks = tasksResult.data as PlannerTask[];
    const taskById = new Map(loadedTasks.map((task) => [task.id, task]));
    if (settingsResult.data) {
      setSettings({
        workWindows: settingsResult.data.work_windows as TimeWindow[],
        personalWindows: settingsResult.data.personal_windows as TimeWindow[],
        maxBlockMinutes: settingsResult.data.max_block_minutes,
        breakMinutes: settingsResult.data.break_minutes,
      });
    }

    setBlocks((blocksResult.data ?? []).map((block) => {
      const task = taskById.get(block.task_id);
      return { ...block, title: task?.title ?? 'Task', priority: task?.priority ?? 'Media', category: task?.category ?? 'Personale' } as DisplayBlock;
    }));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setUserId(data.session?.user.id ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (userId) void Promise.resolve().then(() => loadPlanner(userId));
  }, [loadPlanner, userId]);

  const groupedBlocks = useMemo(() => {
    const groups = new Map<string, DisplayBlock[]>();
    blocks.forEach((block) => groups.set(block.block_date, [...(groups.get(block.block_date) ?? []), block]));
    return Array.from(groups.entries());
  }, [blocks]);

  async function createPlan() {
    if (!userId) return;
    setIsPlanning(true);
    const [tasksResult, settingsResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_time, is_complete'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', userId).maybeSingle(),
    ]);

    if (tasksResult.error || settingsResult.error) {
      setIsPlanning(false);
      Alert.alert('Piano non disponibile', 'Controlla gli aggiornamenti Supabase e riprova.');
      return;
    }

    const latestTasks = tasksResult.data as PlannerTask[];
    const latestSettings: PlannerSettings = settingsResult.data ? {
      workWindows: settingsResult.data.work_windows as TimeWindow[],
      personalWindows: settingsResult.data.personal_windows as TimeWindow[],
      maxBlockMinutes: settingsResult.data.max_block_minutes,
      breakMinutes: settingsResult.data.break_minutes,
    } : defaultSettings;
    setSettings(latestSettings);
    const result = buildAutomaticPlan(latestTasks, latestSettings);

    const deleteResult = await supabase.from('task_blocks').delete().eq('user_id', userId);
    const insertResult = result.blocks.length
      ? await supabase.from('task_blocks').insert(result.blocks.map((block) => ({ user_id: userId, ...block })))
      : { error: null };

    if (deleteResult.error || insertResult.error) {
      setIsPlanning(false);
      Alert.alert('Piano non salvato', 'Controlla gli aggiornamenti Supabase e riprova.');
      return;
    }

    const taskById = new Map(latestTasks.map((task) => [task.id, task]));
    setBlocks(result.blocks.map((block) => ({
      ...block,
      title: taskById.get(block.task_id)?.title ?? 'Task',
      priority: taskById.get(block.task_id)?.priority ?? 'Media',
      category: taskById.get(block.task_id)?.category ?? 'Personale',
    })));
    setIsPlanning(false);

    if (result.unscheduledTaskIds.length) Alert.alert('Piano parziale', `${result.unscheduledTaskIds.length} task non entrano nei prossimi 90 giorni.`);
  }

  if (!userId) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><Text style={styles.emptyTitle}>Accedi dalla scheda Oggi</Text><Text style={styles.emptyCopy}>Poi torna qui per creare il tuo piano.</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>PIANO</Text>
        <Text style={styles.title}>Trova il ritmo giusto.</Text>
        <Text style={styles.subtitle}>Cadenza usa le disponibilità salvate nelle Impostazioni.</Text>

        <View style={styles.settingsSummary}>
          <Text style={styles.summaryText}>Lavoro: {settings.workWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text>
          <Text style={styles.summaryText}>Personale: {settings.personalWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text>
        </View>

        <Pressable disabled={isPlanning || isLoading} onPress={() => void createPlan()} style={({ pressed }) => [styles.planButton, (pressed || isPlanning || isLoading) && styles.planButtonPressed]}>
          {isPlanning ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.planButtonText}>{blocks.length ? 'Ricalcola il piano' : 'Crea il piano'}</Text>}
        </Pressable>

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        <View style={styles.planHeader}><Text style={styles.sectionTitle}>La tua agenda</Text><Text style={styles.sectionCount}>{blocks.length} blocchi</Text></View>
        {isLoading ? <ActivityIndicator color="#305D4A" style={styles.loader} /> : groupedBlocks.map(([date, dateBlocks]) => (
          <View key={date} style={styles.daySection}>
            <Text style={styles.dayTitle}>{formatPlanDate(date)}</Text>
            {dateBlocks.map((block, index) => (
              <View key={block.id ?? `${block.task_id}-${block.block_date}-${block.start_time}-${index}`} style={styles.blockCard}>
                <View style={styles.blockTime}><Text style={styles.blockTimeText}>{block.start_time.slice(0, 5)}</Text><Text style={styles.blockEndText}>{block.end_time.slice(0, 5)}</Text></View>
                <View style={styles.blockLine} />
                <View style={styles.blockContent}>
                  <Text style={styles.blockTitle}>{block.title}</Text>
                  <Text style={styles.blockMeta}>{block.category} · {block.is_fixed ? 'Orario fisso' : block.total_blocks > 1 ? `Blocco ${block.block_index} di ${block.total_blocks}` : `${block.duration_minutes} minuti`} · Priorità {block.priority.toLowerCase()}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
        {!isLoading && !blocks.length && <View style={styles.emptyPlan}><Text style={styles.emptyTitle}>Il palco è ancora vuoto.</Text><Text style={styles.emptyCopy}>Crea il primo piano quando vuoi.</Text></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F5F1', flex: 1 }, content: { paddingBottom: 120, paddingHorizontal: 20, paddingTop: 16 }, center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 }, eyebrow: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 8 }, title: { color: '#252A26', fontSize: 30, fontWeight: '700', letterSpacing: -0.9 }, subtitle: { color: '#74716C', fontSize: 15, lineHeight: 21, marginTop: 8 }, settingsSummary: { backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderWidth: 1, gap: 6, marginTop: 21, padding: 14 }, summaryText: { color: '#68645E', fontSize: 12, fontWeight: '700', lineHeight: 18 }, planButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 12, minHeight: 53 }, planButtonPressed: { opacity: 0.72 }, planButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  errorText: { backgroundColor: '#FFF1E8', borderRadius: 12, color: '#9F3800', fontSize: 13, lineHeight: 19, marginTop: 15, padding: 12 }, planHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, paddingTop: 30 }, sectionTitle: { color: '#2C302D', fontSize: 20, fontWeight: '800' }, sectionCount: { color: '#85817B', fontSize: 13, fontWeight: '700' }, loader: { marginTop: 30 }, daySection: { marginBottom: 21 }, dayTitle: { color: '#52705E', fontSize: 13, fontWeight: '800', marginBottom: 9 }, blockCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 8, minHeight: 76, padding: 12 }, blockTime: { alignItems: 'center', width: 47 }, blockTimeText: { color: '#2F604A', fontSize: 14, fontWeight: '800' }, blockEndText: { color: '#9A958D', fontSize: 10, marginTop: 3 }, blockLine: { alignSelf: 'stretch', backgroundColor: '#D5E4D8', marginHorizontal: 12, width: 3 }, blockContent: { flex: 1 }, blockTitle: { color: '#303430', fontSize: 15, fontWeight: '800' }, blockMeta: { color: '#837F78', fontSize: 11, marginTop: 5 }, emptyPlan: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 35 }, emptyTitle: { color: '#363A36', fontSize: 17, fontWeight: '800', textAlign: 'center' }, emptyCopy: { color: '#817D76', fontSize: 13, marginTop: 7, textAlign: 'center' },
});
