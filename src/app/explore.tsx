import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildAutomaticPlan, formatTimeInput, minutesToTime, PlannedBlock, PlannerSettings, PlannerTask, timeToMinutes, TimeWindow } from '@/lib/planner';
import { supabase } from '@/lib/supabase';

type DisplayBlock = PlannedBlock & { id: string; title: string; priority: string; category: string };
type PlannerDisplayTask = PlannerTask & { is_unscheduled: boolean; planning_note: string | null };

const defaultSettings: PlannerSettings = {
  workWindows: [{ start: '09:00', end: '18:00' }],
  personalWindows: [{ start: '18:00', end: '21:00' }],
  maxBlockMinutes: 60,
  breakMinutes: 15,
};

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(value: string) { return new Date(`${value}T12:00:00`); }
function addDays(date: Date, amount: number) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function formatPlanDate(value: string) { return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromKey(value)).replace(/^./, (letter) => letter.toUpperCase()); }
function formatShortDay(value: string) { return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(dateFromKey(value)).replace('.', ''); }
function formatCalendarMonth(date: Date) { return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(date).replace(/^./, (letter) => letter.toUpperCase()); }
function isValidTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim()); }

function getCalendarDays(cursor: Date) {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const numberOfDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((leadingEmptyDays + numberOfDays) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => {
    const day = index - leadingEmptyDays + 1;
    return day > 0 && day <= numberOfDays ? new Date(cursor.getFullYear(), cursor.getMonth(), day) : null;
  });
}

function blockFromRow(block: Omit<DisplayBlock, 'title' | 'priority' | 'category'>, taskById: Map<string, PlannerTask>): DisplayBlock {
  const task = taskById.get(block.task_id);
  return { ...block, title: task?.title ?? 'Task', priority: task?.priority ?? 'Media', category: task?.category ?? 'Personale' };
}

function formatBlockMeta(block: DisplayBlock) {
  const details = [
    `${block.duration_minutes} minuti`,
    block.total_blocks > 1 ? `Blocco ${block.block_index} di ${block.total_blocks}` : null,
    block.is_manual ? 'Spostato da te' : block.is_fixed ? 'Appuntamento fisso' : null,
    `Priorità ${block.priority.toLowerCase()}`,
  ].filter(Boolean);
  return details.join(' · ');
}

export default function PlanScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlannerSettings>(defaultSettings);
  const [tasks, setTasks] = useState<PlannerDisplayTask[]>([]);
  const [blocks, setBlocks] = useState<DisplayBlock[]>([]);
  const [selectedDate, setSelectedDate] = useState(toDateKey(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(new Date());
  const [movingBlock, setMovingBlock] = useState<DisplayBlock | null>(null);
  const [moveDate, setMoveDate] = useState(toDateKey(new Date()));
  const [moveTime, setMoveTime] = useState('');
  const [isSavingMove, setIsSavingMove] = useState(false);

  const loadPlanner = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    const [tasksResult, settingsResult, blocksResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, is_unscheduled, planning_note'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', currentUserId).maybeSingle(),
      supabase.from('task_blocks').select('id, task_id, block_date, start_time, end_time, duration_minutes, block_index, total_blocks, is_fixed, is_manual').order('block_date').order('start_time'),
    ]);
    if (tasksResult.error || settingsResult.error || blocksResult.error) {
      setErrorMessage('Completa gli aggiornamenti 002, 003, 004, 005, 006 e 007 in Supabase.');
      setIsLoading(false);
      return;
    }
    const loadedTasks = tasksResult.data as PlannerDisplayTask[];
    const taskById = new Map(loadedTasks.map((task) => [task.id, task]));
    setTasks(loadedTasks);
    if (settingsResult.data) setSettings({ workWindows: settingsResult.data.work_windows as TimeWindow[], personalWindows: settingsResult.data.personal_windows as TimeWindow[], maxBlockMinutes: settingsResult.data.max_block_minutes, breakMinutes: settingsResult.data.break_minutes });
    setBlocks((blocksResult.data ?? []).map((block) => blockFromRow(block as Omit<DisplayBlock, 'title' | 'priority' | 'category'>, taskById)));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => { if (isMounted) setUserId(data.session?.user.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => { isMounted = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { if (userId) void Promise.resolve().then(() => loadPlanner(userId)); }, [loadPlanner, userId]);

  const dateOptions = useMemo(() => Array.from({ length: 7 }, (_, index) => toDateKey(addDays(new Date(), index))), []);
  const agendaBlocks = useMemo(() => blocks.filter((block) => block.block_date === selectedDate), [blocks, selectedDate]);
  const unscheduledTasks = useMemo(() => tasks.filter((task) => !task.is_complete && task.is_unscheduled), [tasks]);

  function moveCalendarMonth(amount: number) { setCalendarCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }
  function chooseAgendaDate(date: Date) {
    const key = toDateKey(date);
    if (movingBlock) setMoveDate(key); else setSelectedDate(key);
    setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setIsCalendarOpen(false);
  }

  async function createPlan() {
    if (!userId) return;
    setIsPlanning(true);
    const [tasksResult, settingsResult, manualBlocksResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, is_unscheduled, planning_note'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', userId).maybeSingle(),
      supabase.from('task_blocks').select('task_id, block_date, start_time, end_time, duration_minutes, block_index, total_blocks, is_fixed, is_manual').eq('is_manual', true),
    ]);
    if (tasksResult.error || settingsResult.error || manualBlocksResult.error) {
      setIsPlanning(false); Alert.alert('Piano non disponibile', 'Controlla gli aggiornamenti Supabase e riprova.'); return;
    }
    const latestTasks = tasksResult.data as PlannerDisplayTask[];
    const latestSettings: PlannerSettings = settingsResult.data ? { workWindows: settingsResult.data.work_windows as TimeWindow[], personalWindows: settingsResult.data.personal_windows as TimeWindow[], maxBlockMinutes: settingsResult.data.max_block_minutes, breakMinutes: settingsResult.data.break_minutes } : defaultSettings;
    const result = buildAutomaticPlan(latestTasks, latestSettings, new Date(), (manualBlocksResult.data ?? []) as PlannedBlock[]);
    const automaticBlocks = result.blocks.filter((block) => !block.is_manual);
    const deleteResult = await supabase.from('task_blocks').delete().eq('user_id', userId).eq('is_manual', false);
    const insertResult = deleteResult.error || !automaticBlocks.length ? { error: deleteResult.error } : await supabase.from('task_blocks').insert(automaticBlocks.map((block) => ({ user_id: userId, ...block })));
    if (deleteResult.error || insertResult.error) {
      setIsPlanning(false); Alert.alert('Piano non salvato', 'Controlla gli aggiornamenti Supabase e riprova.'); return;
    }
    const clearStatusResult = await supabase.from('tasks').update({ is_unscheduled: false, planning_note: null }).eq('user_id', userId);
    const setUnscheduledResult = result.unscheduledTaskIds.length
      ? await supabase.from('tasks').update({ is_unscheduled: true, planning_note: 'Disponibilità insufficiente nei prossimi 90 giorni.' }).in('id', result.unscheduledTaskIds)
      : { error: null };
    if (clearStatusResult.error || setUnscheduledResult.error) {
      setIsPlanning(false); Alert.alert('Piano salvato', 'Il piano è stato creato, ma non riesco ad aggiornare la sezione Da sistemare. Esegui l’aggiornamento 006 in Supabase.'); return;
    }
    setSettings(latestSettings);
    await loadPlanner(userId);
    setIsPlanning(false);
    if (result.unscheduledTaskIds.length) Alert.alert('Piano parziale', `${result.unscheduledTaskIds.length} task non entrano nei prossimi 90 giorni.`);
  }

  function openMove(block: DisplayBlock) { setMovingBlock(block); setMoveDate(block.block_date); setMoveTime(block.start_time.slice(0, 5)); }

  function fitsCategoryAvailability(block: DisplayBlock, start: number, end: number) {
    const windows = block.category === 'Lavoro' ? settings.workWindows : settings.personalWindows;
    return windows.some((window) => timeToMinutes(window.start) <= start && timeToMinutes(window.end) >= end);
  }

  function requestSplitConfirmation(start: number, end: number) {
    if (!movingBlock) return;
    const movedManualBlock: PlannedBlock = {
      task_id: movingBlock.task_id,
      block_date: moveDate,
      start_time: minutesToTime(start),
      end_time: minutesToTime(end),
      duration_minutes: movingBlock.duration_minutes,
      block_index: movingBlock.block_index,
      total_blocks: movingBlock.total_blocks,
      is_fixed: movingBlock.is_fixed,
      is_manual: true,
    };
    const otherManualBlocks = blocks.filter((block) => block.is_manual && block.id !== movingBlock.id).map(({ id: _id, title: _title, priority: _priority, category: _category, ...block }) => block);
    const preview = buildAutomaticPlan(tasks, settings, new Date(), [...otherManualBlocks, movedManualBlock]);
    const currentBlockCounts = new Map<string, number>();
    blocks.forEach((block) => currentBlockCounts.set(block.task_id, (currentBlockCounts.get(block.task_id) ?? 0) + 1));
    const previewCounts = new Map<string, number>();
    preview.blocks.forEach((block) => previewCounts.set(block.task_id, (previewCounts.get(block.task_id) ?? 0) + 1));
    const tasksToSplit = tasks.filter((task) => task.id !== movingBlock.task_id && task.is_splittable && (previewCounts.get(task.id) ?? 0) > (currentBlockCounts.get(task.id) ?? 0));
    if (tasksToSplit.length) {
      const names = tasksToSplit.slice(0, 2).map((task) => `“${task.title}”`).join(' e ');
      const suffix = tasksToSplit.length > 2 ? ` e altri ${tasksToSplit.length - 2}` : '';
      Alert.alert('Il piano dovrà spezzare un task', `Per fare spazio, Cadenza dividerà ${names}${suffix} in più blocchi. “Non spezzare” lo sposta interamente e lo imposta come non divisibile.`, [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Non spezzare', onPress: () => void commitMove(start, end, tasksToSplit.map((task) => task.id)) },
        { text: 'Continua', onPress: () => void commitMove(start, end) },
      ]);
      return;
    }
    void commitMove(start, end);
  }

  async function commitMove(start: number, end: number, wholeTaskIds: string[] = []) {
    if (!movingBlock || !userId) return;
    setIsSavingMove(true);
    if (wholeTaskIds.length) {
      const { error: wholeTaskError } = await supabase.from('tasks').update({ is_splittable: false }).in('id', wholeTaskIds);
      if (wholeTaskError) {
        setIsSavingMove(false);
        Alert.alert('Aggiornamento non riuscito', 'Non riesco a impostare il task come non divisibile. Riprova tra poco.');
        return;
      }
    }
    const { error } = await supabase.from('task_blocks').update({ block_date: moveDate, start_time: minutesToTime(start), end_time: minutesToTime(end), is_manual: true }).eq('id', movingBlock.id).eq('user_id', userId);
    setIsSavingMove(false);
    if (error) { Alert.alert('Spostamento non salvato', 'Riprova dopo aver controllato l’aggiornamento 005 in Supabase.'); return; }
    setSelectedDate(moveDate);
    setMovingBlock(null);
    await createPlan();
  }

  function saveMove() {
    if (!movingBlock || !userId) return;
    const cleanTime = moveTime.trim();
    if (!isValidTime(cleanTime)) { Alert.alert('Orario non valido', 'Usa il formato HH:MM, ad esempio 14:30.'); return; }
    const start = timeToMinutes(cleanTime); const end = start + movingBlock.duration_minutes;
    if (end > 1440) { Alert.alert('Orario non valido', 'Il blocco terminerebbe dopo la mezzanotte.'); return; }
    const lockedConflict = blocks.find((block) => block.id !== movingBlock.id && block.block_date === moveDate && (block.is_manual || block.is_fixed) && start < timeToMinutes(block.end_time) && end > timeToMinutes(block.start_time));
    if (lockedConflict) { Alert.alert('Spazio bloccato', `Si sovrappone a “${lockedConflict.title}” (${lockedConflict.start_time.slice(0, 5)}–${lockedConflict.end_time.slice(0, 5)}), che ha un orario fissato.`); return; }
    if (!fitsCategoryAvailability(movingBlock, start, end)) {
      Alert.alert('Fuori disponibilità', `Questo blocco ${movingBlock.category.toLowerCase()} non rientra negli orari impostati. Vuoi fissarlo comunque?`, [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Fissa comunque', onPress: () => requestSplitConfirmation(start, end) },
      ]);
      return;
    }
    requestSplitConfirmation(start, end);
  }

  async function unlockBlock() {
    if (!movingBlock || !userId) return;
    setIsSavingMove(true);
    const { error } = await supabase.from('task_blocks').update({ is_manual: false }).eq('id', movingBlock.id).eq('user_id', userId);
    setIsSavingMove(false);
    if (error) { Alert.alert('Sblocco non riuscito', 'Riprova tra poco.'); return; }
    setMovingBlock(null);
    await createPlan();
  }

  if (!userId) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><Text style={styles.emptyTitle}>Accedi dalla scheda Oggi</Text><Text style={styles.emptyCopy}>Poi torna qui per creare il tuo piano.</Text></View></SafeAreaView>;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>PIANO</Text><Text style={styles.title}>Trova il ritmo giusto.</Text><Text style={styles.subtitle}>Ricalcola liberamente: gli spostamenti manuali restano al loro posto.</Text>
        <View style={styles.settingsSummary}><Text style={styles.summaryText}>Lavoro: {settings.workWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text><Text style={styles.summaryText}>Personale: {settings.personalWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text></View>
        <Pressable disabled={isPlanning || isLoading} onPress={() => void createPlan()} style={({ pressed }) => [styles.planButton, (pressed || isPlanning || isLoading) && styles.planButtonPressed]}>{isPlanning ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.planButtonText}>{blocks.length ? 'Ricalcola il piano' : 'Crea il piano'}</Text>}</Pressable>
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        <View style={styles.planHeader}><Text style={styles.sectionTitle}>La tua agenda</Text><Text style={styles.sectionCount}>{blocks.length} blocchi</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPicker}>{dateOptions.map((date) => <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dayChip, date === selectedDate && styles.dayChipSelected]}><Text style={[styles.dayChipText, date === selectedDate && styles.dayChipTextSelected]}>{date === toDateKey(new Date()) ? 'Oggi' : formatShortDay(date)}</Text></Pressable>)}<Pressable onPress={() => setIsCalendarOpen(true)} style={styles.calendarChip}><Text style={styles.calendarChipText}>Calendario</Text></Pressable></ScrollView>
        {isLoading ? <ActivityIndicator color="#305D4A" style={styles.loader} /> : <>
          <Text style={styles.selectedDayTitle}>{formatPlanDate(selectedDate)}</Text>
          {agendaBlocks.map((block) => {
            const isWork = block.category === 'Lavoro';
            return <Pressable key={block.id} onPress={() => openMove(block)} style={({ pressed }) => [styles.blockCard, isWork ? styles.workBlockCard : styles.personalBlockCard, pressed && styles.blockCardPressed]}>
              <View style={styles.blockTime}><Text style={[styles.blockTimeText, isWork ? styles.workBlockTimeText : styles.personalBlockTimeText]}>{block.start_time.slice(0, 5)}</Text><Text style={styles.blockEndText}>{block.end_time.slice(0, 5)}</Text></View>
              <View style={[styles.blockLine, isWork ? styles.workBlockLine : styles.personalBlockLine]} />
              <View style={styles.blockContent}><View style={styles.blockTitleRow}><Text style={styles.blockTitle}>{block.title}</Text><View style={[styles.categoryPill, isWork ? styles.workCategoryPill : styles.personalCategoryPill]}><Text style={[styles.categoryPillText, isWork ? styles.workCategoryPillText : styles.personalCategoryPillText]}>{block.category}</Text></View></View><Text style={styles.blockMeta}>{formatBlockMeta(block)}</Text></View>
            </Pressable>;
          })}
          {!agendaBlocks.length && <View style={styles.emptyDay}><Text style={styles.emptyTitle}>Qui c’è spazio.</Text><Text style={styles.emptyCopy}>Scegli un altro giorno o ricalcola il piano.</Text></View>}
          {unscheduledTasks.length > 0 && <View style={styles.unscheduledCard}><Text style={styles.unscheduledTitle}>Da sistemare</Text><Text style={styles.unscheduledCopy}>Non c’è abbastanza disponibilità libera nei prossimi 90 giorni.</Text>{unscheduledTasks.map((task) => <View key={task.id} style={styles.unscheduledTaskRow}><Text style={styles.unscheduledTask}>• {task.title}</Text><Text style={styles.unscheduledReason}>{task.planning_note ?? 'Disponibilità insufficiente nei prossimi 90 giorni.'}</Text></View>)}</View>}
        </>}
      </ScrollView>
      <Modal animationType="fade" transparent visible={isCalendarOpen} onRequestClose={() => setIsCalendarOpen(false)}><Pressable style={styles.overlay} onPress={() => setIsCalendarOpen(false)}><Pressable style={styles.calendarCard} onPress={(event) => event.stopPropagation()}><View style={styles.calendarHeader}><Pressable onPress={() => moveCalendarMonth(-1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>‹</Text></Pressable><Text style={styles.calendarTitle}>{formatCalendarMonth(calendarCursor)}</Text><Pressable onPress={() => moveCalendarMonth(1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>›</Text></Pressable></View><View style={styles.weekdayRow}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View><View style={styles.calendarGrid}>{getCalendarDays(calendarCursor).map((date, index) => { if (!date) return <View key={`empty-${index}`} style={styles.calendarDay} />; const key = toDateKey(date); const selected = key === selectedDate; return <Pressable key={key} onPress={() => chooseAgendaDate(date)} style={[styles.calendarDay, selected && styles.calendarDaySelected]}><Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{date.getDate()}</Text></Pressable>; })}</View></Pressable></Pressable></Modal>
      <Modal animationType="slide" transparent visible={!!movingBlock} onRequestClose={() => setMovingBlock(null)}><Pressable style={styles.moveOverlay} onPress={() => setMovingBlock(null)}><Pressable style={styles.moveCard} onPress={(event) => event.stopPropagation()}><View style={styles.modalHandle} /><Text style={styles.moveTitle}>Sposta blocco</Text><Text style={styles.moveCopy}>{movingBlock?.title}</Text><Text style={styles.fieldLabel}>GIORNO</Text><Pressable onPress={() => { setSelectedDate(moveDate); setCalendarCursor(dateFromKey(moveDate)); setIsCalendarOpen(true); }} style={styles.dateButton}><Text style={styles.dateButtonText}>{formatPlanDate(moveDate)}</Text><Text style={styles.dateButtonHint}>Scegli</Text></Pressable><Text style={styles.fieldLabel}>INIZIA ALLE</Text><TextInput autoFocus keyboardType="number-pad" maxLength={5} placeholder="HH:MM" placeholderTextColor="#938F8B" value={moveTime} onChangeText={(value) => setMoveTime(formatTimeInput(value))} style={styles.timeInput} /><Text style={styles.moveHint}>Questo blocco durerà {movingBlock?.duration_minutes ?? 0} minuti.{movingBlock?.is_manual ? ' Ora è bloccato finché non lo riaffidi al piano.' : ' Dopo il salvataggio resterà bloccato anche dopo un ricalcolo.'}</Text><Pressable disabled={isSavingMove} onPress={() => void saveMove()} style={[styles.saveButton, isSavingMove && styles.saveButtonDisabled]}>{isSavingMove ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>Salva spostamento</Text>}</Pressable>{movingBlock?.is_manual && <Pressable disabled={isSavingMove} onPress={() => void unlockBlock()} style={styles.unlockButton}><Text style={styles.unlockButtonText}>Riaffida al pianificatore</Text></Pressable>}</Pressable></Pressable></Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F5F1', flex: 1 }, content: { paddingBottom: 120, paddingHorizontal: 20, paddingTop: 16 }, center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 }, eyebrow: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 8 }, title: { color: '#252A26', fontSize: 30, fontWeight: '700', letterSpacing: -0.9 }, subtitle: { color: '#74716C', fontSize: 15, lineHeight: 21, marginTop: 8 }, settingsSummary: { backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderWidth: 1, gap: 6, marginTop: 21, padding: 14 }, summaryText: { color: '#68645E', fontSize: 12, fontWeight: '700', lineHeight: 18 }, planButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 12, minHeight: 53 }, planButtonPressed: { opacity: 0.72 }, planButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, errorText: { backgroundColor: '#FFF1E8', borderRadius: 12, color: '#9F3800', fontSize: 13, lineHeight: 19, marginTop: 15, padding: 12 },
  planHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, paddingTop: 30 }, sectionTitle: { color: '#2C302D', fontSize: 20, fontWeight: '800' }, sectionCount: { color: '#85817B', fontSize: 13, fontWeight: '700' }, dayPicker: { gap: 8, paddingBottom: 15 }, dayChip: { backgroundColor: '#FFFFFF', borderColor: '#E4E0D9', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, dayChipSelected: { backgroundColor: '#305D4A', borderColor: '#305D4A' }, dayChipText: { color: '#625E57', fontSize: 12, fontWeight: '800' }, dayChipTextSelected: { color: '#FFFFFF' }, calendarChip: { alignItems: 'center', borderColor: '#B8CDBD', borderRadius: 10, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 12 }, calendarChipText: { color: '#315D4A', fontSize: 12, fontWeight: '800' }, loader: { marginTop: 30 }, selectedDayTitle: { color: '#52705E', fontSize: 13, fontWeight: '800', marginBottom: 9 },
  blockCard: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 8, minHeight: 76, padding: 12 }, workBlockCard: { backgroundColor: '#EEF1FF', borderColor: '#B9C4F2' }, personalBlockCard: { backgroundColor: '#FFF0E7', borderColor: '#F1C8B1' }, blockCardPressed: { opacity: 0.74 }, blockTime: { alignItems: 'center', width: 47 }, blockTimeText: { fontSize: 14, fontWeight: '800' }, workBlockTimeText: { color: '#3850A3' }, personalBlockTimeText: { color: '#B45F31' }, blockEndText: { color: '#807A72', fontSize: 10, marginTop: 3 }, blockLine: { alignSelf: 'stretch', marginHorizontal: 12, width: 4 }, workBlockLine: { backgroundColor: '#7185DA' }, personalBlockLine: { backgroundColor: '#E58A5A' }, blockContent: { flex: 1 }, blockTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 }, blockTitle: { color: '#303430', flexShrink: 1, fontSize: 15, fontWeight: '800' }, categoryPill: { borderRadius: 7, marginLeft: 'auto', paddingHorizontal: 7, paddingVertical: 3 }, workCategoryPill: { backgroundColor: '#D7DEFF' }, personalCategoryPill: { backgroundColor: '#FFE0CF' }, categoryPillText: { fontSize: 9, fontWeight: '800' }, workCategoryPillText: { color: '#3850A3' }, personalCategoryPillText: { color: '#A64E22' }, blockMeta: { color: '#6F6961', fontSize: 11, lineHeight: 16, marginTop: 5 }, emptyDay: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, paddingHorizontal: 20, paddingVertical: 26 }, emptyTitle: { color: '#363A36', fontSize: 17, fontWeight: '800', textAlign: 'center' }, emptyCopy: { color: '#817D76', fontSize: 13, marginTop: 7, textAlign: 'center' }, unscheduledCard: { backgroundColor: '#FFF5DE', borderColor: '#F0D9A4', borderRadius: 16, borderWidth: 1, marginTop: 24, padding: 15 }, unscheduledTitle: { color: '#765D00', fontSize: 15, fontWeight: '800' }, unscheduledCopy: { color: '#8B7235', fontSize: 12, lineHeight: 17, marginTop: 4 }, unscheduledTaskRow: { borderTopColor: '#F0D9A4', borderTopWidth: 1, marginTop: 10, paddingTop: 9 }, unscheduledTask: { color: '#685520', fontSize: 13, fontWeight: '700' }, unscheduledReason: { color: '#8B7235', fontSize: 11, lineHeight: 16, marginTop: 3 },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(24, 28, 24, 0.42)', flex: 1, justifyContent: 'center', padding: 20 }, calendarCard: { backgroundColor: '#F8F7F3', borderRadius: 24, maxWidth: 420, padding: 20, width: '100%' }, calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }, calendarArrow: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 }, calendarArrowText: { color: '#305D4A', fontSize: 32, fontWeight: '300', lineHeight: 34 }, calendarTitle: { color: '#292D29', fontSize: 17, fontWeight: '800' }, weekdayRow: { flexDirection: 'row', marginBottom: 6 }, weekday: { color: '#88837C', flex: 1, fontSize: 11, fontWeight: '800', textAlign: 'center' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarDay: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', marginVertical: 2, width: '14.2857%' }, calendarDaySelected: { backgroundColor: '#305D4A' }, calendarDayText: { color: '#383C38', fontSize: 14, fontWeight: '700' }, calendarDayTextSelected: { color: '#FFFFFF' },
  moveOverlay: { backgroundColor: 'rgba(24, 28, 24, 0.38)', flex: 1, justifyContent: 'flex-end' }, moveCard: { backgroundColor: '#F8F7F3', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 38, paddingHorizontal: 22, paddingTop: 10 }, modalHandle: { alignSelf: 'center', backgroundColor: '#D3D0C9', borderRadius: 2, height: 4, marginBottom: 23, width: 38 }, moveTitle: { color: '#292D29', fontSize: 25, fontWeight: '700', letterSpacing: -0.5 }, moveCopy: { color: '#77736D', fontSize: 14, marginTop: 7 }, fieldLabel: { color: '#6C716B', fontSize: 10, fontWeight: '800', letterSpacing: 1.05, marginBottom: 8, marginTop: 18 }, dateButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 }, dateButtonText: { color: '#305D4A', fontSize: 14, fontWeight: '800' }, dateButtonHint: { color: '#77736D', fontSize: 12, fontWeight: '700' }, timeInput: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, color: '#292D29', fontSize: 16, paddingHorizontal: 14, paddingVertical: 13 }, moveHint: { color: '#817D76', fontSize: 12, lineHeight: 18, marginTop: 12 }, saveButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 53 }, saveButtonDisabled: { backgroundColor: '#A8BBAE' }, saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, unlockButton: { alignItems: 'center', marginTop: 13, paddingVertical: 10 }, unlockButtonText: { color: '#765D00', fontSize: 14, fontWeight: '800' },
});
