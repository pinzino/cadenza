import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { AuthScreen } from '@/components/auth-screen';
import { buildAutomaticPlan, formatTimeInput, isBlockExpired, minutesToTime, PlannedBlock, PlannerBusyInterval, PlannerSettings, PlannerTask, timeToMinutes, TimeWindow } from '@/lib/planner';
import { schedulePlanReminders } from '@/lib/reminders';
import { Alert } from '@/lib/app-alert';
import { supabase } from '@/lib/supabase';
import { useCurrentTime } from '@/lib/use-current-time';

type DisplayBlock = PlannedBlock & { id: string; title: string; priority: string; category: string; reminder_enabled: boolean; reminder_minutes: number };
type PlannerDisplayTask = PlannerTask & { is_unscheduled: boolean; planning_note: string | null; reminder_enabled: boolean; reminder_minutes: number };
type GoogleCalendarEvent = { id: string; title: string; starts_at: string; ends_at: string; is_all_day: boolean; blocks_time: boolean; is_complete: boolean };

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
function formatDayChip(value: string, index: number) {
  if (index > 2) return formatShortDay(value);
  const date = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(dateFromKey(value));
  return `${['Oggi', 'Domani', 'Dopodomani'][index]} ${date}`;
}
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

function blockFromRow(block: Omit<DisplayBlock, 'title' | 'priority' | 'category'>, taskById: Map<string, PlannerDisplayTask>): DisplayBlock {
  const task = taskById.get(block.task_id);
  return { ...block, title: task?.title ?? 'Task', priority: task?.priority ?? 'Media', category: task?.category ?? 'Personale', reminder_enabled: task?.reminder_enabled ?? true, reminder_minutes: task?.reminder_minutes ?? 10 };
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

function localTime(value: Date) { return minutesToTime(value.getHours() * 60 + value.getMinutes()); }
function eventOccursOnDate(event: GoogleCalendarEvent, date: string) {
  if (event.is_all_day) return event.starts_at.slice(0, 10) <= date && date < event.ends_at.slice(0, 10);
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);
  return new Date(event.starts_at) < dayEnd && new Date(event.ends_at) > dayStart;
}
function eventDateKeyForSort(event: GoogleCalendarEvent, date: string) {
  const start = new Date(event.starts_at);
  return start < new Date(`${date}T00:00:00`) ? 0 : start.getHours() * 60 + start.getMinutes();
}
function eventEndMinutesOnDate(event: GoogleCalendarEvent, date: string) {
  const end = new Date(event.ends_at);
  return end >= addDays(new Date(`${date}T00:00:00`), 1) ? 1440 : end.getHours() * 60 + end.getMinutes();
}
function eventTime(value: string) { const date = new Date(value); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }

function NowLine({ label, fraction }: { label: string; fraction?: number }) {
  return <View pointerEvents="none" style={fraction === undefined ? styles.nowLineRow : [styles.nowLineRow, styles.nowLineInside, { top: `${fraction * 100}%` }]}>
    <Text style={styles.nowLineLabel}>{label}</Text><View style={styles.nowLineStroke} />
  </View>;
}

function CompletionControl({ isComplete, onPress, accessibilityLabel, disabled = false }: { isComplete: boolean; onPress: () => void; accessibilityLabel: string; disabled?: boolean }) {
  return <View style={styles.completionControl}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={(event) => { event.stopPropagation(); onPress(); }} style={[styles.completeBlockButton, styles.completionCircle, isComplete && styles.googleCompleteButtonDone, disabled && styles.googleControlDisabled]}><Text style={styles.completeBlockText}>{isComplete ? '✓' : ''}</Text></Pressable>
    <Text style={[styles.completionLabel, isComplete && styles.completionLabelDone]}>{isComplete ? 'Eseguito' : 'Completa'}</Text>
  </View>;
}

function GoogleEventCard({ event, selectedDate, isPast = false, nowFraction, nowLabel, isUpdating, onToggleBlocking, onToggleComplete }: { event: GoogleCalendarEvent; selectedDate: string; isPast?: boolean; nowFraction?: number; nowLabel?: string; isUpdating: boolean; onToggleBlocking: () => void; onToggleComplete: () => void }) {
  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);
  const start = event.is_all_day ? 'Tutto' : new Date(event.starts_at) < dayStart ? '00:00' : eventTime(event.starts_at);
  const end = event.is_all_day ? 'il giorno' : new Date(event.ends_at) >= dayEnd ? '24:00' : eventTime(event.ends_at);
  return <View style={[styles.blockCard, styles.googleEventCard]}>
    <View style={[styles.blockTime, event.is_all_day && styles.googleAllDayTime]}>
      <Text style={[styles.googleEventTime, (isPast || event.is_complete) && styles.pastText]}>{start}</Text>
      <Text style={[styles.blockEndText, (isPast || event.is_complete) && styles.pastText]}>{end}</Text>
      {event.is_all_day && <>
        <Pressable accessibilityRole="button" accessibilityLabel={event.blocks_time ? `Non bloccare più la giornata per ${event.title}` : `Blocca la giornata per ${event.title}`} disabled={isUpdating} onPress={onToggleBlocking} style={[styles.googleBlockCircle, event.blocks_time && styles.googleBlockCircleSelected, isUpdating && styles.googleControlDisabled]}><Text style={styles.googleBlockCircleText}>{event.blocks_time ? '✓' : ''}</Text></Pressable>
        <Text style={styles.googleBlockHint}>{event.blocks_time ? 'Blocca' : 'Libero'}</Text>
      </>}
    </View>
    <View style={[styles.blockLine, styles.googleEventLine]} />
    <View style={styles.blockContent}><View style={styles.blockTitleRow}><Text style={[styles.blockTitle, (isPast || event.is_complete) && styles.pastText, event.is_complete && styles.googleCompletedTitle]}>{event.title}</Text><View style={styles.googleEventPill}><Text style={[styles.googleEventPillText, (isPast || event.is_complete) && styles.pastText]}>Google</Text></View></View><Text style={[styles.blockMeta, (isPast || event.is_complete) && styles.pastText]}>{event.is_all_day ? event.blocks_time ? 'Blocca la giornata' : 'Non blocca le fasce orarie' : 'Appuntamento fisso · non modificabile da Cadenza'}</Text></View>
    <CompletionControl isComplete={event.is_complete} accessibilityLabel={event.is_complete ? `Segna ${event.title} come da fare` : `Completa ${event.title}`} disabled={isUpdating} onPress={onToggleComplete} />
    {nowFraction !== undefined && nowLabel && <NowLine label={nowLabel} fraction={nowFraction} />}
  </View>;
}

async function loadGoogleBusyIntervals(userId: string) {
  const { data: calendars, error: calendarError } = await supabase.from('google_calendars').select('id').eq('user_id', userId).eq('is_enabled', true);
  if (calendarError || !calendars?.length) return { intervals: [] as PlannerBusyInterval[], error: calendarError };
  const { data: events, error: eventError } = await supabase.from('google_calendar_events').select('starts_at, ends_at, is_all_day, blocks_time').in('calendar_id', calendars.map((calendar) => calendar.id));
  if (eventError) return { intervals: [] as PlannerBusyInterval[], error: eventError };
  const intervals = (events ?? []).flatMap((event) => {
    if (event.is_all_day) {
      if (!event.blocks_time) return [];
      const result: PlannerBusyInterval[] = [];
      const endDate = event.ends_at.slice(0, 10);
      for (let day = dateFromKey(event.starts_at.slice(0, 10)); toDateKey(day) < endDate; day = addDays(day, 1)) result.push({ block_date: toDateKey(day), start_time: '00:00:00', end_time: '24:00:00' });
      return result;
    }
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return [];
    const result: PlannerBusyInterval[] = [];
    let cursor = new Date(start);
    while (cursor < end) {
      const nextDay = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      const intervalEnd = end < nextDay ? end : nextDay;
      result.push({ block_date: toDateKey(cursor), start_time: localTime(cursor), end_time: intervalEnd === nextDay ? '24:00:00' : localTime(intervalEnd) });
      cursor = nextDay;
    }
    return result;
  });
  return { intervals, error: null };
}

export default function PlanScreen() {
  const now = useCurrentTime();
  const [userId, setUserId] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
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
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [calendarView, setCalendarView] = useState<'agenda' | 'week' | 'month'>('agenda');
  const [isSchedulingReminders, setIsSchedulingReminders] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [updatingGoogleEventIds, setUpdatingGoogleEventIds] = useState<Set<string>>(new Set());

  const loadGoogleEvents = useCallback(async (currentUserId: string) => {
    const { data: calendars, error: calendarsError } = await supabase.from('google_calendars').select('id').eq('user_id', currentUserId).eq('is_enabled', true);
    if (calendarsError || !calendars?.length) { setGoogleEvents([]); return; }
    const { data, error } = await supabase.from('google_calendar_events').select('id, title, starts_at, ends_at, is_all_day, blocks_time, is_complete').in('calendar_id', calendars.map((calendar) => calendar.id)).order('starts_at');
    if (error) setErrorMessage('Non riesco a leggere le preferenze degli eventi Google. Esegui la migrazione 016 in Supabase.');
    else setGoogleEvents((data ?? []) as GoogleCalendarEvent[]);
  }, []);

  async function updateGoogleEvent(event: GoogleCalendarEvent, field: 'blocks_time' | 'is_complete') {
    if (!userId || updatingGoogleEventIds.has(event.id)) return;
    const nextValue = !event[field];
    setUpdatingGoogleEventIds((current) => new Set(current).add(event.id));
    setGoogleEvents((current) => current.map((item) => item.id === event.id ? { ...item, [field]: nextValue } : item));
    const { error } = await supabase.from('google_calendar_events').update({ [field]: nextValue }).eq('id', event.id).eq('user_id', userId);
    if (error) {
      setGoogleEvents((current) => current.map((item) => item.id === event.id ? { ...item, [field]: event[field] } : item));
      Alert.alert('Modifica non salvata', 'Controlla di aver eseguito la migrazione 016 in Supabase e riprova.');
    }
    setUpdatingGoogleEventIds((current) => { const next = new Set(current); next.delete(event.id); return next; });
  }

  const loadPlanner = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    const [tasksResult, settingsResult, blocksResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_date_kind, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, is_unscheduled, planning_note, reminder_enabled, reminder_minutes'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', currentUserId).maybeSingle(),
      supabase.from('task_blocks').select('id, task_id, block_date, start_time, end_time, duration_minutes, block_index, total_blocks, is_fixed, is_manual').order('block_date').order('start_time'),
    ]);
    if (tasksResult.error || settingsResult.error || blocksResult.error) {
      setErrorMessage('Completa le migrazioni Supabase, inclusa la 015, per leggere il piano.');
      setIsLoading(false);
      return;
    }
    const loadedTasks = tasksResult.data as PlannerDisplayTask[];
    const taskById = new Map(loadedTasks.map((task) => [task.id, task]));
    setTasks(loadedTasks);
    if (settingsResult.data) setSettings({ workWindows: settingsResult.data.work_windows as TimeWindow[], personalWindows: settingsResult.data.personal_windows as TimeWindow[], maxBlockMinutes: settingsResult.data.max_block_minutes, breakMinutes: settingsResult.data.break_minutes });
    setBlocks((blocksResult.data ?? []).map((block) => blockFromRow(block as Omit<DisplayBlock, 'title' | 'priority' | 'category'>, taskById)));
    void loadGoogleEvents(currentUserId);
    setIsLoading(false);
  }, [loadGoogleEvents]);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => { if (isMounted) { setUserId(data.session?.user.id ?? null); setIsCheckingSession(false); } }).catch(() => { if (isMounted) setIsCheckingSession(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { setUserId(session?.user.id ?? null); setIsCheckingSession(false); });
    return () => { isMounted = false; data.subscription.unsubscribe(); };
  }, []);
  useFocusEffect(useCallback(() => {
    if (userId) void loadPlanner(userId);
  }, [loadPlanner, userId]));

  const dateOptions = useMemo(() => Array.from({ length: 7 }, (_, index) => toDateKey(addDays(now, index))), [now]);
  const agendaBlocks = useMemo(() => blocks.filter((block) => block.block_date === selectedDate), [blocks, selectedDate]);
  const agendaGoogleEvents = useMemo(() => googleEvents.filter((event) => eventOccursOnDate(event, selectedDate)), [googleEvents, selectedDate]);
  const allDayGoogleEvents = useMemo(() => agendaGoogleEvents.filter((event) => event.is_all_day), [agendaGoogleEvents]);
  const timedAgenda = useMemo(() => [
    ...agendaBlocks.map((block) => ({ kind: 'block' as const, block, start: timeToMinutes(block.start_time), end: timeToMinutes(block.end_time) })),
    ...agendaGoogleEvents.filter((event) => !event.is_all_day).map((event) => ({ kind: 'google' as const, event, start: eventDateKeyForSort(event, selectedDate), end: eventEndMinutesOnDate(event, selectedDate) })),
  ].sort((first, second) => first.start - second.start), [agendaBlocks, agendaGoogleEvents, selectedDate]);
  const currentDate = toDateKey(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentTimeLabel = minutesToTime(currentMinutes).slice(0, 5);
  const showingToday = selectedDate === currentDate;
  const activeEntryIndex = showingToday ? timedAgenda.findIndex((entry) => entry.start <= currentMinutes && currentMinutes < entry.end) : -1;
  const nowLineIndex = !showingToday ? -1 : activeEntryIndex >= 0 ? activeEntryIndex : timedAgenda.findIndex((entry) => entry.start > currentMinutes);
  const unscheduledTasks = useMemo(() => tasks.filter((task) => !task.is_complete && task.is_unscheduled), [tasks]);
  const tasksNeedingPlacement = useMemo(() => tasks.filter((task) => !task.is_complete && (task.is_unscheduled || !blocks.some((block) => block.task_id === task.id))), [blocks, tasks]);
  const completedTaskIds = useMemo(() => new Set(tasks.filter((task) => task.is_complete).map((task) => task.id)), [tasks]);
  const activeBlocks = useMemo(() => blocks.filter((block) => !completedTaskIds.has(block.task_id)), [blocks, completedTaskIds]);
  const overdueTaskIds = useMemo(() => {
    const activeIds = new Set(tasks.filter((task) => !task.is_complete).map((task) => task.id));
    return new Set(blocks.filter((block) => activeIds.has(block.task_id) && isBlockExpired(block, now)).map((block) => block.task_id));
  }, [blocks, now, tasks]);
  const weekDates = useMemo(() => {
    const selected = dateFromKey(selectedDate);
    const mondayOffset = (selected.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => toDateKey(addDays(selected, index - mondayOffset)));
  }, [selectedDate]);
  const stats = useMemo(() => ({
    workMinutes: tasks.filter((task) => task.category === 'Lavoro').reduce((total, task) => total + task.duration_minutes, 0),
    personalMinutes: tasks.filter((task) => task.category === 'Personale').reduce((total, task) => total + task.duration_minutes, 0),
    completed: tasks.filter((task) => task.is_complete).length,
    active: tasks.filter((task) => !task.is_complete).length,
  }), [tasks]);

  function moveCalendarMonth(amount: number) { setCalendarCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }
  function chooseAgendaDate(date: Date) {
    const key = toDateKey(date);
    if (movingBlock) setMoveDate(key); else setSelectedDate(key);
    setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setIsCalendarOpen(false);
  }

  function formatMinutes(minutes: number) {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return hours ? `${hours} h${remaining ? ` ${remaining} min` : ''}` : `${remaining} min`;
  }

  async function refreshReminders() {
    setIsSchedulingReminders(true);
    try {
      const result = await schedulePlanReminders(activeBlocks.map((block) => ({ task_id: block.task_id, title: block.title, block_date: block.block_date, start_time: block.start_time, reminder_enabled: block.reminder_enabled, reminder_minutes: block.reminder_minutes })));
      Alert.alert(result.available ? 'Promemoria aggiornati' : 'Permesso necessario', result.available ? `${result.scheduled} promemoria impostati, 10 minuti prima del blocco.` : 'Consenti le notifiche nelle impostazioni del telefono per ricevere i promemoria.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert('Promemoria non disponibili', `Non riesco ancora a programmarli su questo telefono. Dettaglio: ${detail}`);
    } finally { setIsSchedulingReminders(false); }
  }

  async function toggleTaskFromPlan(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextCompleted = !task.is_complete;
    if (nextCompleted) {
      const checklistResult = await supabase.from('task_checklist_items').select('id, is_complete').eq('task_id', taskId);
      if (checklistResult.error) { Alert.alert('Aggiornamento non riuscito', 'Controlla gli aggiornamenti SQL in Supabase e riprova.'); return; }
      if (checklistResult.data.some((item) => !item.is_complete)) { Alert.alert('Checklist da completare', 'Spunta tutti i punti della checklist prima di completare il task.'); return; }
    }
    const { error } = await supabase.from('tasks').update({ is_complete: nextCompleted }).eq('id', taskId);
    if (error) { Alert.alert('Aggiornamento non riuscito', 'Riprova tra poco.'); return; }
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, is_complete: nextCompleted } : item));
  }

  async function createPlan() {
    if (!userId) return;
    setIsPlanning(true);
    const [tasksResult, settingsResult, blocksResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, priority, duration_minutes, scheduled_date, scheduled_date_kind, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, is_unscheduled, planning_note, reminder_enabled, reminder_minutes'),
      supabase.from('planner_settings').select('work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', userId).maybeSingle(),
      supabase.from('task_blocks').select('id, task_id, block_date, start_time, end_time, duration_minutes, block_index, total_blocks, is_fixed, is_manual').eq('user_id', userId),
    ]);
    if (tasksResult.error || settingsResult.error || blocksResult.error) {
      setIsPlanning(false); Alert.alert('Piano non disponibile', 'Controlla gli aggiornamenti Supabase e riprova.'); return;
    }
    const latestTasks = tasksResult.data as PlannerDisplayTask[];
    const latestSettings: PlannerSettings = settingsResult.data ? { workWindows: settingsResult.data.work_windows as TimeWindow[], personalWindows: settingsResult.data.personal_windows as TimeWindow[], maxBlockMinutes: settingsResult.data.max_block_minutes, breakMinutes: settingsResult.data.break_minutes } : defaultSettings;
    const googleBusyResult = await loadGoogleBusyIntervals(userId);
    if (googleBusyResult.error) {
      setIsPlanning(false); Alert.alert('Google Calendar non disponibile', 'Non posso verificare gli appuntamenti Google. Controlla la migrazione 016 e aggiorna i calendari dalle Impostazioni.'); return;
    }
    const planningTime = new Date();
    const existingBlocks = (blocksResult.data ?? []) as (PlannedBlock & { id: string })[];
    const activeTaskIds = new Set(latestTasks.filter((task) => !task.is_complete).map((task) => task.id));
    const completedTaskIds = new Set(latestTasks.filter((task) => task.is_complete).map((task) => task.id));
    const expiredTaskIds = new Set(existingBlocks.filter((block) => activeTaskIds.has(block.task_id) && isBlockExpired(block, planningTime)).map((block) => block.task_id));
    const expiredManualIds = existingBlocks.filter((block) => activeTaskIds.has(block.task_id) && block.is_manual && isBlockExpired(block, planningTime)).map((block) => block.id);
    const currentManualBlocks = existingBlocks.filter((block) => activeTaskIds.has(block.task_id) && block.is_manual && !isBlockExpired(block, planningTime));
    const completedBusyIntervals = existingBlocks.filter((block) => completedTaskIds.has(block.task_id)).map((block) => ({ block_date: block.block_date, start_time: block.start_time, end_time: block.end_time }));
    const activeAutomaticIds = existingBlocks.filter((block) => activeTaskIds.has(block.task_id) && !block.is_manual).map((block) => block.id);
    const planningTasks = latestTasks.map((task) => expiredTaskIds.has(task.id) ? { ...task, scheduled_date: null, scheduled_time: null } : task);
    const result = buildAutomaticPlan(planningTasks, latestSettings, planningTime, currentManualBlocks, [...googleBusyResult.intervals, ...completedBusyIntervals]);
    const automaticBlocks = result.blocks.filter((block) => !block.is_manual);
    if (expiredManualIds.length) {
      const expiredManualDelete = await supabase.from('task_blocks').delete().eq('user_id', userId).in('id', expiredManualIds);
      if (expiredManualDelete.error) {
        setIsPlanning(false); Alert.alert('Piano non salvato', 'Non riesco a liberare i blocchi scaduti. Riprova tra poco.'); return;
      }
    }
    const deleteResult = activeAutomaticIds.length
      ? await supabase.from('task_blocks').delete().eq('user_id', userId).in('id', activeAutomaticIds)
      : { error: null };
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
    const titleByTask = new Map(latestTasks.map((task) => [task.id, task.title]));
    const reminderByTask = new Map(latestTasks.map((task) => [task.id, { enabled: task.reminder_enabled, minutes: task.reminder_minutes }]));
    void schedulePlanReminders(result.blocks.map((block) => ({ task_id: block.task_id, title: titleByTask.get(block.task_id) ?? 'Task', block_date: block.block_date, start_time: block.start_time, reminder_enabled: reminderByTask.get(block.task_id)?.enabled ?? true, reminder_minutes: reminderByTask.get(block.task_id)?.minutes ?? 10 }))).catch(() => undefined);
    setSettings(latestSettings);
    await loadPlanner(userId);
    setIsPlanning(false);
    const overdueNotRescheduled = result.unscheduledTaskIds.filter((id) => expiredTaskIds.has(id));
    if (overdueNotRescheduled.length) {
      Alert.alert('Task scaduti da sistemare', `${overdueNotRescheduled.length} ${overdueNotRescheduled.length === 1 ? 'task scaduto non è stato ripianificato' : 'task scaduti non sono stati ripianificati'} completamente: manca spazio disponibile nei prossimi 90 giorni.`);
    } else if (result.unscheduledTaskIds.length) {
      Alert.alert('Piano parziale', `${result.unscheduledTaskIds.length} task non entrano nei prossimi 90 giorni.`);
    }
  }

  function openMove(block: DisplayBlock) { setMovingBlock(block); setMoveDate(block.block_date); setMoveTime(block.start_time.slice(0, 5)); }
  function editMovingTask() {
    if (!movingBlock || isDeletingTask) return;
    const taskId = movingBlock.task_id;
    setMovingBlock(null);
    router.push({ pathname: '/planify', params: { editTaskId: taskId } });
  }

  function confirmDeleteMovingTask() {
    if (!movingBlock || isSavingMove || isDeletingTask) return;
    const { task_id: taskId, title } = movingBlock;
    Alert.alert(
      'Elimina task',
      `Vuoi eliminare “${title}” e tutti i suoi blocchi dall’agenda? Questa azione non può essere annullata.`,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Elimina task', style: 'destructive', onPress: () => void deleteMovingTask(taskId) },
      ],
    );
  }

  async function deleteMovingTask(taskId: string) {
    if (!userId || isDeletingTask) return;
    setIsDeletingTask(true);
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId).eq('user_id', userId);
      if (error) {
        Alert.alert('Eliminazione non riuscita', 'Riprova tra poco.');
        return;
      }
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setBlocks((current) => current.filter((block) => block.task_id !== taskId));
      setMovingBlock(null);
      void schedulePlanReminders(activeBlocks.filter((block) => block.task_id !== taskId).map((block) => ({ task_id: block.task_id, title: block.title, block_date: block.block_date, start_time: block.start_time, reminder_enabled: block.reminder_enabled, reminder_minutes: block.reminder_minutes }))).catch(() => undefined);
    } catch {
      Alert.alert('Eliminazione non riuscita', 'Riprova tra poco.');
    } finally {
      setIsDeletingTask(false);
    }
  }

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

  if (isCheckingSession) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator color="#305D4A" size="large" /></View></SafeAreaView>;
  if (!userId) return <AuthScreen />;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>AGENDA</Text><Text style={styles.title}>Trova il ritmo giusto.</Text><Text style={styles.subtitle}>Gli spostamenti manuali futuri restano al loro posto; i task scaduti vengono ripianificati.</Text>
        <View style={styles.settingsSummary}><Text style={styles.summaryText}>Lavoro: {settings.workWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text><Text style={styles.summaryText}>Personale: {settings.personalWindows.map((window) => `${window.start}–${window.end}`).join(', ')}</Text></View>
        <Pressable disabled={isPlanning || isLoading} onPress={() => void createPlan()} style={({ pressed }) => [styles.planButton, tasksNeedingPlacement.length > 0 ? styles.planButtonWarning : overdueTaskIds.size > 0 && styles.planButtonOverdue, (pressed || isPlanning || isLoading) && styles.planButtonPressed]}>{isPlanning ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.planButtonText, { textAlign: 'center', paddingHorizontal: 12 }]}>{blocks.length ? 'Ricalcola il piano' : 'Crea il piano'}{tasksNeedingPlacement.length > 0 ? ` · ${tasksNeedingPlacement.length} da posizionare` : ''}{overdueTaskIds.size > 0 ? ` · ${overdueTaskIds.size} ${overdueTaskIds.size === 1 ? 'scaduto' : 'scaduti'}` : ''}</Text>}</Pressable>
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        <View style={styles.planHeader}><Text style={styles.sectionTitle}>La tua agenda</Text><Text style={styles.sectionCount}>{blocks.length} blocchi</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPicker}>{dateOptions.map((date, index) => <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dayChip, date === selectedDate && styles.dayChipSelected]}><Text style={[styles.dayChipText, date === selectedDate && styles.dayChipTextSelected]}>{formatDayChip(date, index)}</Text></Pressable>)}<Pressable onPress={() => setIsCalendarOpen(true)} style={styles.calendarChip}><Text style={styles.calendarChipText}>Calendario</Text></Pressable></ScrollView>
        <View style={styles.viewSwitcher}>{([['agenda', 'Agenda'], ['week', 'Settimana'], ['month', 'Mese']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setCalendarView(value)} style={[styles.viewSwitchButton, calendarView === value && styles.viewSwitchButtonSelected]}><Text style={[styles.viewSwitchText, calendarView === value && styles.viewSwitchTextSelected]}>{label}</Text></Pressable>)}</View>
        {calendarView === 'week' && <View style={styles.weekCard}>{weekDates.map((date) => { const dayBlocks = blocks.filter((block) => block.block_date === date); const dayGoogleEvents = googleEvents.filter((event) => eventOccursOnDate(event, date)); const work = dayBlocks.filter((block) => block.category === 'Lavoro').length; const personal = dayBlocks.length - work; const completed = dayGoogleEvents.filter((event) => event.is_complete).length + dayBlocks.filter((block) => completedTaskIds.has(block.task_id)).length; const total = dayBlocks.length + dayGoogleEvents.length; return <Pressable key={date} onPress={() => { setSelectedDate(date); setCalendarView('agenda'); }} style={[styles.weekDay, date === selectedDate && styles.weekDaySelected]}><Text style={styles.weekDayName}>{formatShortDay(date)}</Text><Text style={styles.weekDayCount}>{total || '–'}</Text><View style={styles.weekDots}>{work > 0 && <View style={styles.workDot} />}{personal > 0 && <View style={styles.personalDot} />}{dayGoogleEvents.length > 0 && <View style={styles.googleDot} />}</View>{completed > 0 && <Text style={styles.weekDayCompleted}>✓ {completed}</Text>}</Pressable>; })}</View>}
        {calendarView === 'month' && <View style={styles.monthCard}><Text style={styles.monthTitle}>{formatCalendarMonth(calendarCursor)}</Text><View style={styles.monthWeekdays}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.monthWeekday}>{day}</Text>)}</View><View style={styles.monthGrid}>{getCalendarDays(calendarCursor).map((date, index) => { if (!date) return <View key={`empty-${index}`} style={styles.monthDay} />; const key = toDateKey(date); const dayGoogleEvents = googleEvents.filter((event) => eventOccursOnDate(event, key)); const dayBlocks = blocks.filter((block) => block.block_date === key); const count = dayBlocks.length + dayGoogleEvents.length; const completed = dayGoogleEvents.filter((event) => event.is_complete).length + dayBlocks.filter((block) => completedTaskIds.has(block.task_id)).length; return <Pressable key={key} onPress={() => { setSelectedDate(key); setCalendarView('agenda'); }} style={[styles.monthDay, key === selectedDate && styles.monthDaySelected]}><Text style={[styles.monthDayText, key === selectedDate && styles.monthDayTextSelected]}>{date.getDate()}</Text>{count > 0 && <Text style={[styles.monthDayCount, key === selectedDate && styles.monthDayTextSelected]}>{count}{completed > 0 ? ` · ✓${completed}` : ''}</Text>}</Pressable>; })}</View></View>}
        {calendarView === 'agenda' && (isLoading ? <ActivityIndicator color="#305D4A" style={styles.loader} /> : <>
          <Text style={styles.selectedDayTitle}>{formatPlanDate(selectedDate)}</Text>
          {allDayGoogleEvents.length > 0 && <>
            <Text style={styles.allDayTitle}>TUTTO IL GIORNO</Text>
            <Text style={styles.googleDayHint}>Cerchio sotto l’orario: vuoto lascia libera la giornata, spuntato la blocca. Ricalcola il piano dopo una modifica.</Text>
            {allDayGoogleEvents.map((event) => <GoogleEventCard key={event.id} event={event} selectedDate={selectedDate} isPast={selectedDate < currentDate} isUpdating={updatingGoogleEventIds.has(event.id)} onToggleBlocking={() => void updateGoogleEvent(event, 'blocks_time')} onToggleComplete={() => void updateGoogleEvent(event, 'is_complete')} />)}
          </>}
          {allDayGoogleEvents.length > 0 && timedAgenda.length > 0 && <View style={styles.agendaDivider}><View style={styles.agendaDividerLine} /><Text style={styles.agendaDividerLabel}>A ORARIO</Text><View style={styles.agendaDividerLine} /></View>}
          {timedAgenda.map((entry, index) => {
            const key = entry.kind === 'google' ? `google-${entry.event.id}` : entry.block.id;
            const isPast = selectedDate < currentDate || (showingToday && entry.end <= currentMinutes);
            const nowFraction = index === activeEntryIndex ? (currentMinutes - entry.start) / Math.max(1, entry.end - entry.start) : undefined;
            if (entry.kind === 'google') return <Fragment key={key}>
              {showingToday && index === nowLineIndex && activeEntryIndex < 0 && <NowLine label={currentTimeLabel} />}
              <GoogleEventCard event={entry.event} selectedDate={selectedDate} isPast={isPast} nowFraction={nowFraction} nowLabel={currentTimeLabel} isUpdating={updatingGoogleEventIds.has(entry.event.id)} onToggleBlocking={() => void updateGoogleEvent(entry.event, 'blocks_time')} onToggleComplete={() => void updateGoogleEvent(entry.event, 'is_complete')} />
            </Fragment>;
            const block = entry.block;
            const isWork = block.category === 'Lavoro';
            const isComplete = completedTaskIds.has(block.task_id);
            const isMuted = isPast || isComplete;
            return <Fragment key={key}>
              {showingToday && index === nowLineIndex && activeEntryIndex < 0 && <NowLine label={currentTimeLabel} />}
              <Pressable onPress={() => openMove(block)} style={({ pressed }) => [styles.blockCard, isWork ? styles.workBlockCard : styles.personalBlockCard, isPast && overdueTaskIds.has(block.task_id) && styles.overdueBlockCard, pressed && styles.blockCardPressed]}>
              <View style={styles.blockTime}><Text style={[styles.blockTimeText, isWork ? styles.workBlockTimeText : styles.personalBlockTimeText, isMuted && styles.pastText]}>{block.start_time.slice(0, 5)}</Text><Text style={[styles.blockEndText, isMuted && styles.pastText]}>{block.end_time.slice(0, 5)}</Text></View>
              <View style={[styles.blockLine, isWork ? styles.workBlockLine : styles.personalBlockLine]} />
              <View style={styles.blockContent}><View style={styles.blockTitleRow}><Text style={[styles.blockTitle, isMuted && styles.pastText]}>{block.title}</Text><View style={[styles.categoryPill, isWork ? styles.workCategoryPill : styles.personalCategoryPill]}><Text style={[styles.categoryPillText, isWork ? styles.workCategoryPillText : styles.personalCategoryPillText, isMuted && styles.pastText]}>{block.category}</Text></View></View><Text style={[styles.blockMeta, isMuted && styles.pastText]}>{formatBlockMeta(block)}</Text></View><CompletionControl isComplete={isComplete} accessibilityLabel={isComplete ? `Segna ${block.title} come da fare` : `Completa ${block.title}`} onPress={() => void toggleTaskFromPlan(block.task_id)} />
              {nowFraction !== undefined && <NowLine label={currentTimeLabel} fraction={nowFraction} />}
              </Pressable>
            </Fragment>;
          })}
          {showingToday && nowLineIndex < 0 && activeEntryIndex < 0 && <NowLine label={currentTimeLabel} />}
          {!agendaBlocks.length && !agendaGoogleEvents.length && <View style={styles.emptyDay}><Text style={styles.emptyTitle}>Qui c’è spazio.</Text><Text style={styles.emptyCopy}>Scegli un altro giorno o ricalcola il piano.</Text></View>}
        </>) }
        {Platform.OS !== 'web' && <Pressable disabled={isSchedulingReminders || !activeBlocks.length} onPress={() => void refreshReminders()} style={[styles.reminderButton, (!activeBlocks.length || isSchedulingReminders) && styles.reminderButtonDisabled]}>{isSchedulingReminders ? <ActivityIndicator color="#315D4A" /> : <Text style={styles.reminderButtonText}>🔔 Aggiorna promemoria</Text>}</Pressable>}
        <View style={styles.statsCard}><Text style={styles.statsTitle}>Le tue statistiche</Text><View style={styles.statsRow}><View style={styles.statItem}><Text style={styles.workStatValue}>{formatMinutes(stats.workMinutes)}</Text><Text style={styles.statLabel}>Lavoro pianificato</Text></View><View style={styles.statItem}><Text style={styles.personalStatValue}>{formatMinutes(stats.personalMinutes)}</Text><Text style={styles.statLabel}>Personale pianificato</Text></View></View><Text style={styles.completedStat}>✓ {stats.completed} task completati · {stats.active} ancora attivi</Text></View>
        {unscheduledTasks.length > 0 && <View style={styles.unscheduledCard}><Text style={styles.unscheduledTitle}>Da sistemare</Text><Text style={styles.unscheduledCopy}>Non c’è abbastanza disponibilità libera nei prossimi 90 giorni.</Text>{unscheduledTasks.map((task) => <View key={task.id} style={styles.unscheduledTaskRow}><Text style={styles.unscheduledTask}>• {task.title}</Text><Text style={styles.unscheduledReason}>{task.planning_note ?? 'Disponibilità insufficiente nei prossimi 90 giorni.'}</Text></View>)}</View>}
      </ScrollView>
      <Modal animationType="fade" transparent visible={isCalendarOpen} onRequestClose={() => setIsCalendarOpen(false)}><Pressable style={styles.overlay} onPress={() => setIsCalendarOpen(false)}><Pressable style={styles.calendarCard} onPress={(event) => event.stopPropagation()}><View style={styles.calendarHeader}><Pressable onPress={() => moveCalendarMonth(-1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>‹</Text></Pressable><Text style={styles.calendarTitle}>{formatCalendarMonth(calendarCursor)}</Text><Pressable onPress={() => moveCalendarMonth(1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>›</Text></Pressable></View><View style={styles.weekdayRow}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View><View style={styles.calendarGrid}>{getCalendarDays(calendarCursor).map((date, index) => { if (!date) return <View key={`empty-${index}`} style={styles.calendarDay} />; const key = toDateKey(date); const selected = key === selectedDate; return <Pressable key={key} onPress={() => chooseAgendaDate(date)} style={[styles.calendarDay, selected && styles.calendarDaySelected]}><Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{date.getDate()}</Text></Pressable>; })}</View></Pressable></Pressable></Modal>
      <Modal animationType="slide" transparent visible={!!movingBlock} onRequestClose={() => setMovingBlock(null)}>
        <Pressable style={[styles.moveOverlay, Platform.OS === 'web' && styles.webMoveOverlay]} onPress={() => setMovingBlock(null)}>
          <Pressable style={[styles.moveCard, Platform.OS === 'web' && styles.webMoveCard]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.moveHeader}><Text style={styles.moveTitle}>Sposta blocco</Text></View>
            <View style={styles.moveActionRow}>
              <Pressable disabled={isSavingMove || isDeletingTask} onPress={editMovingTask}><Text style={styles.editTaskText}>Modifica task</Text></Pressable>
              <Pressable disabled={isSavingMove || isDeletingTask} onPress={confirmDeleteMovingTask}><Text style={styles.deleteTaskText}>{isDeletingTask ? 'Eliminazione…' : 'Elimina task'}</Text></Pressable>
            </View>
            <Text style={styles.moveCopy}>{movingBlock?.title}</Text>
            <Text style={styles.fieldLabel}>GIORNO</Text>
            <Pressable onPress={() => { setSelectedDate(moveDate); setCalendarCursor(dateFromKey(moveDate)); setIsCalendarOpen(true); }} style={styles.dateButton}><Text style={styles.dateButtonText}>{formatPlanDate(moveDate)}</Text><Text style={styles.dateButtonHint}>Scegli</Text></Pressable>
            <Text style={styles.fieldLabel}>INIZIA ALLE</Text>
            <TextInput autoFocus keyboardType="number-pad" maxLength={5} placeholder="HH:MM" placeholderTextColor="#938F8B" value={moveTime} onChangeText={(value) => setMoveTime(formatTimeInput(value))} style={styles.timeInput} />
            <Text style={styles.moveHint}>Questo blocco durerà {movingBlock?.duration_minutes ?? 0} minuti.{movingBlock?.is_manual ? ' Ora è bloccato finché non lo riaffidi al piano.' : ' Dopo il salvataggio resterà bloccato anche dopo un ricalcolo.'}</Text>
            <Pressable disabled={isSavingMove || isDeletingTask} onPress={() => void saveMove()} style={[styles.saveButton, (isSavingMove || isDeletingTask) && styles.saveButtonDisabled]}>{isSavingMove ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>Salva spostamento</Text>}</Pressable>
            {movingBlock?.is_manual && <Pressable disabled={isSavingMove || isDeletingTask} onPress={() => void unlockBlock()} style={styles.unlockButton}><Text style={styles.unlockButtonText}>Riaffida al pianificatore</Text></Pressable>}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  webContent: { alignSelf: 'center', maxWidth: 920, paddingHorizontal: 0, width: '90%' },
  webMoveOverlay: { justifyContent: 'center', padding: 20 },
  webMoveCard: { alignSelf: 'center', borderRadius: 24, maxWidth: 580, width: '90%' },
  moveHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  moveActionRow: { flexDirection: 'row', gap: 20, marginTop: 12 },
  editTaskText: { color: '#305D4A', fontSize: 13, fontWeight: '800' },
  deleteTaskText: { color: '#B33932', fontSize: 13, fontWeight: '800' },
  completionControl: { alignItems: 'center', marginLeft: 8, width: 54 },
  completionCircle: { marginLeft: 0 },
  completionLabel: { color: '#2F6A49', fontSize: 9, fontWeight: '800', marginTop: 4 },
  completionLabelDone: { color: '#91918F' },
  googleAllDayTime: { width: 60 },
  googleBlockCircle: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#9276DB', borderRadius: 13, borderWidth: 2, height: 26, justifyContent: 'center', marginTop: 10, width: 26 },
  googleBlockCircleSelected: { backgroundColor: '#6953A8' },
  googleBlockCircleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  googleBlockHint: { color: '#6953A8', fontSize: 9, fontWeight: '800', marginTop: 3 },
  googleCompleteButtonDone: { backgroundColor: '#DDF0E2' },
  googleCompletedTitle: { textDecorationLine: 'line-through' },
  googleControlDisabled: { opacity: 0.45 },
  googleDayHint: { color: '#756A8C', fontSize: 11, lineHeight: 16, marginBottom: 12 },
  weekDayCompleted: { color: '#437455', fontSize: 9, fontWeight: '800', marginTop: 3 },
  googleDot: { backgroundColor: '#9276DB', borderRadius: 3, height: 6, width: 6 },
  planButtonOverdue: { backgroundColor: '#9B7114' },
  overdueBlockCard: { borderColor: '#E2AF24', borderWidth: 2 },
  safeArea: { backgroundColor: '#F7F5F1', flex: 1 }, content: { paddingBottom: 120, paddingHorizontal: 20, paddingTop: 16 }, center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 }, eyebrow: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 8 }, title: { color: '#252A26', fontSize: 30, fontWeight: '700', letterSpacing: -0.9 }, subtitle: { color: '#74716C', fontSize: 15, lineHeight: 21, marginTop: 8 }, settingsSummary: { backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderWidth: 1, gap: 6, marginTop: 21, padding: 14 }, summaryText: { color: '#68645E', fontSize: 12, fontWeight: '700', lineHeight: 18 }, planButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 12, minHeight: 53 }, planButtonWarning: { backgroundColor: '#C7443E' }, planButtonPressed: { opacity: 0.72 }, planButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, errorText: { backgroundColor: '#FFF1E8', borderRadius: 12, color: '#9F3800', fontSize: 13, lineHeight: 19, marginTop: 15, padding: 12 },
  planHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, paddingTop: 30 }, sectionTitle: { color: '#2C302D', fontSize: 20, fontWeight: '800' }, sectionCount: { color: '#85817B', fontSize: 13, fontWeight: '700' }, dayPicker: { gap: 8, paddingBottom: 15 }, dayChip: { backgroundColor: '#FFFFFF', borderColor: '#E4E0D9', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, dayChipSelected: { backgroundColor: '#305D4A', borderColor: '#305D4A' }, dayChipText: { color: '#625E57', fontSize: 12, fontWeight: '800' }, dayChipTextSelected: { color: '#FFFFFF' }, calendarChip: { alignItems: 'center', borderColor: '#B8CDBD', borderRadius: 10, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 12 }, calendarChipText: { color: '#315D4A', fontSize: 12, fontWeight: '800' }, viewSwitcher: { backgroundColor: '#ECE9E3', borderRadius: 12, flexDirection: 'row', marginBottom: 16, padding: 3 }, viewSwitchButton: { alignItems: 'center', borderRadius: 9, flex: 1, paddingVertical: 8 }, viewSwitchButtonSelected: { backgroundColor: '#FFFFFF' }, viewSwitchText: { color: '#817D76', fontSize: 12, fontWeight: '800' }, viewSwitchTextSelected: { color: '#305D4A' }, weekCard: { backgroundColor: '#FFFFFF', borderColor: '#E6E1DA', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 16, padding: 8 }, weekDay: { alignItems: 'center', borderRadius: 10, flex: 1, minHeight: 82, paddingTop: 8 }, weekDaySelected: { backgroundColor: '#E9F2EA' }, weekDayName: { color: '#69645E', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }, weekDayCount: { color: '#303430', fontSize: 18, fontWeight: '800', marginTop: 7 }, weekDots: { flexDirection: 'row', gap: 3, marginTop: 6 }, workDot: { backgroundColor: '#7185DA', borderRadius: 3, height: 6, width: 6 }, personalDot: { backgroundColor: '#E58A5A', borderRadius: 3, height: 6, width: 6 }, monthCard: { backgroundColor: '#FFFFFF', borderColor: '#E6E1DA', borderRadius: 16, borderWidth: 1, marginBottom: 16, padding: 12 }, monthTitle: { color: '#3A403B', fontSize: 15, fontWeight: '800', marginBottom: 10, textAlign: 'center' }, monthWeekdays: { flexDirection: 'row' }, monthWeekday: { color: '#908B84', flex: 1, fontSize: 10, fontWeight: '800', textAlign: 'center' }, monthGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }, monthDay: { alignItems: 'center', borderRadius: 10, height: 43, justifyContent: 'center', marginVertical: 1, width: '14.2857%' }, monthDaySelected: { backgroundColor: '#305D4A' }, monthDayText: { color: '#454944', fontSize: 12, fontWeight: '800' }, monthDayTextSelected: { color: '#FFFFFF' }, monthDayCount: { color: '#5E8A69', fontSize: 9, fontWeight: '800' }, loader: { marginTop: 30 }, selectedDayTitle: { color: '#52705E', fontSize: 13, fontWeight: '800', marginBottom: 9 },
  allDayTitle: { color: '#6953A8', fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: 9, marginTop: 7 }, agendaDivider: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 13, marginTop: 14 }, agendaDividerLine: { backgroundColor: '#D6D1C8', flex: 1, height: 1 }, agendaDividerLabel: { color: '#77736D', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  pastText: { color: '#91918F' }, nowLineRow: { alignItems: 'center', flexDirection: 'row', marginBottom: 10, marginTop: 8 }, nowLineInside: { left: 0, marginBottom: 0, marginTop: 0, position: 'absolute', right: 0, zIndex: 2 }, nowLineLabel: { backgroundColor: '#D94642', borderRadius: 5, color: '#FFFFFF', fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3 }, nowLineStroke: { backgroundColor: '#D94642', flex: 1, height: 2 },
  blockCard: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 8, minHeight: 76, padding: 12 }, workBlockCard: { backgroundColor: '#EEF1FF', borderColor: '#B9C4F2' }, personalBlockCard: { backgroundColor: '#FFF0E7', borderColor: '#F1C8B1' }, googleEventCard: { backgroundColor: '#F1EDFF', borderColor: '#CCC0F3' }, blockCardPressed: { opacity: 0.74 }, blockTime: { alignItems: 'center', width: 47 }, blockTimeText: { fontSize: 14, fontWeight: '800' }, googleEventTime: { color: '#6953A8', fontSize: 12, fontWeight: '800' }, workBlockTimeText: { color: '#3850A3' }, personalBlockTimeText: { color: '#B45F31' }, blockEndText: { color: '#807A72', fontSize: 10, marginTop: 3 }, blockLine: { alignSelf: 'stretch', marginHorizontal: 12, width: 4 }, workBlockLine: { backgroundColor: '#7185DA' }, personalBlockLine: { backgroundColor: '#E58A5A' }, googleEventLine: { backgroundColor: '#9276DB' }, blockContent: { flex: 1 }, blockTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 }, blockTitle: { color: '#303430', flexShrink: 1, fontSize: 15, fontWeight: '800' }, categoryPill: { borderRadius: 7, marginLeft: 'auto', paddingHorizontal: 7, paddingVertical: 3 }, googleEventPill: { backgroundColor: '#E1D7FF', borderRadius: 7, marginLeft: 'auto', paddingHorizontal: 7, paddingVertical: 3 }, googleEventPillText: { color: '#62489F', fontSize: 9, fontWeight: '800' }, workCategoryPill: { backgroundColor: '#D7DEFF' }, personalCategoryPill: { backgroundColor: '#FFE0CF' }, categoryPillText: { fontSize: 9, fontWeight: '800' }, workCategoryPillText: { color: '#3850A3' }, personalCategoryPillText: { color: '#A64E22' }, blockMeta: { color: '#6F6961', fontSize: 11, lineHeight: 16, marginTop: 5 }, completeBlockButton: { alignItems: 'center', backgroundColor: '#FFFFFFAA', borderColor: '#7EA68C', borderRadius: 14, borderWidth: 1, height: 28, justifyContent: 'center', marginLeft: 8, width: 28 }, completeBlockText: { color: '#2F6A49', fontSize: 16, fontWeight: '900' }, reminderButton: { alignItems: 'center', backgroundColor: '#E8F2EA', borderColor: '#B8D1BE', borderRadius: 12, borderWidth: 1, justifyContent: 'center', marginTop: 18, minHeight: 46 }, reminderButtonDisabled: { opacity: 0.5 }, reminderButtonText: { color: '#315D4A', fontSize: 13, fontWeight: '800' }, statsCard: { backgroundColor: '#FFFFFF', borderColor: '#E6E1DA', borderRadius: 16, borderWidth: 1, marginTop: 18, padding: 16 }, statsTitle: { color: '#343934', fontSize: 16, fontWeight: '800', marginBottom: 10 }, statsRow: { flexDirection: 'row', gap: 18, marginTop: 14 }, statItem: { flex: 1 }, workStatValue: { color: '#3850A3', fontSize: 20, fontWeight: '800' }, personalStatValue: { color: '#B45F31', fontSize: 20, fontWeight: '800' }, statLabel: { color: '#817D76', fontSize: 11, lineHeight: 15, marginTop: 3 }, completedStat: { color: '#437455', fontSize: 12, fontWeight: '800', marginTop: 16 }, emptyDay: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, paddingHorizontal: 20, paddingVertical: 26 }, emptyTitle: { color: '#363A36', fontSize: 17, fontWeight: '800', textAlign: 'center' }, emptyCopy: { color: '#817D76', fontSize: 13, marginTop: 7, textAlign: 'center' }, unscheduledCard: { backgroundColor: '#FFF5DE', borderColor: '#F0D9A4', borderRadius: 16, borderWidth: 1, marginTop: 24, padding: 15 }, unscheduledTitle: { color: '#765D00', fontSize: 15, fontWeight: '800' }, unscheduledCopy: { color: '#8B7235', fontSize: 12, lineHeight: 17, marginTop: 4 }, unscheduledTaskRow: { borderTopColor: '#F0D9A4', borderTopWidth: 1, marginTop: 10, paddingTop: 9 }, unscheduledTask: { color: '#685520', fontSize: 13, fontWeight: '700' }, unscheduledReason: { color: '#8B7235', fontSize: 11, lineHeight: 16, marginTop: 3 },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(24, 28, 24, 0.42)', flex: 1, justifyContent: 'center', padding: 20 }, calendarCard: { backgroundColor: '#F8F7F3', borderRadius: 24, maxWidth: 420, padding: 20, width: '100%' }, calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }, calendarArrow: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 }, calendarArrowText: { color: '#305D4A', fontSize: 32, fontWeight: '300', lineHeight: 34 }, calendarTitle: { color: '#292D29', fontSize: 17, fontWeight: '800' }, weekdayRow: { flexDirection: 'row', marginBottom: 6 }, weekday: { color: '#88837C', flex: 1, fontSize: 11, fontWeight: '800', textAlign: 'center' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarDay: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', marginVertical: 2, width: '14.2857%' }, calendarDaySelected: { backgroundColor: '#305D4A' }, calendarDayText: { color: '#383C38', fontSize: 14, fontWeight: '700' }, calendarDayTextSelected: { color: '#FFFFFF' },
  moveOverlay: { backgroundColor: 'rgba(24, 28, 24, 0.38)', flex: 1, justifyContent: 'flex-end' }, moveCard: { backgroundColor: '#F8F7F3', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 38, paddingHorizontal: 22, paddingTop: 10 }, modalHandle: { alignSelf: 'center', backgroundColor: '#D3D0C9', borderRadius: 2, height: 4, marginBottom: 23, width: 38 }, moveTitle: { color: '#292D29', fontSize: 25, fontWeight: '700', letterSpacing: -0.5 }, moveCopy: { color: '#77736D', fontSize: 14, marginTop: 7 }, fieldLabel: { color: '#6C716B', fontSize: 10, fontWeight: '800', letterSpacing: 1.05, marginBottom: 8, marginTop: 18 }, dateButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 }, dateButtonText: { color: '#305D4A', fontSize: 14, fontWeight: '800' }, dateButtonHint: { color: '#77736D', fontSize: 12, fontWeight: '700' }, timeInput: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, color: '#292D29', fontSize: 16, paddingHorizontal: 14, paddingVertical: 13 }, moveHint: { color: '#817D76', fontSize: 12, lineHeight: 18, marginTop: 12 }, saveButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 53 }, saveButtonDisabled: { backgroundColor: '#A8BBAE' }, saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, unlockButton: { alignItems: 'center', marginTop: 13, paddingVertical: 10 }, unlockButtonText: { color: '#765D00', fontSize: 14, fontWeight: '800' },
});
